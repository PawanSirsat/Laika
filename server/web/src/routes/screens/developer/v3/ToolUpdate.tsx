import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getCompatibility } from '../../../../api/developer-updates.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { getAgentVerification, type AgentVerification } from '../../../../api/tool-setup.ts';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { DesignChip } from './DesignChip.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { HintChip } from './StatusLegend.tsx';
import { UpdateCliHelp } from './UpdateCliGuide.tsx';
import { deviceVersionDescription, updateChipDescription } from './status-vocabulary.ts';
import { GUIDE_TITLE, guideFor, versionUnknownHint } from './update-cli.ts';
import {
  AFTER_UPDATE,
  ALLOW_HTTP_WHY,
  boardBehindNote,
  deviceUpdateSummary,
  offersUpdate,
  reportKey,
  reportedHelper,
  updateAnnouncement,
  updateCommand,
  updateManifestOf,
  updateStatus,
  versionChip,
  watchForReport,
  whatsNew,
  worstUpdate,
  type ClientReport,
  type Read,
  type UpdateKey,
  type UpdateManifest,
  type UpdateStatus,
  type Watch,
  type WatchClock,
} from './update-status.ts';
import '../../connect/connect.css';
import './update-status.css';

/**
 * The update statuses on Developer access V3's Devices and Tools tabs
 * (LAI-1065, LAI-1080, plan LAI-1042 §H): a chip on each tool's row, the whole
 * status in its details, a summary in each device's details, and — for an
 * org owner or admin, only when the data shows it — a note that the board is
 * behind. No tab of their own.
 *
 * One provider reads the board's compatibility answer once, and each listed
 * tool's `GET /agents/:id/verification` — **kept whole** (LAI-1080), so the
 * same answer gives the tool's readiness on its row and in its details with
 * no second request. After *Copy update command* the details poll the report,
 * with backoff, until a new one arrives, and the change is announced through
 * the tab's throttled live region.
 */

const REAL_CLOCK: WatchClock = {
  now: () => Date.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface UpdatesValue {
  readonly manifest: Read<UpdateManifest>;
  /** The tool's whole verification answer: its checks as well as its report. */
  readonly verification: (agentId: string) => Read<AgentVerification>;
  readonly report: (agentId: string) => Read<ClientReport | null>;
  readonly status: (agentId: string) => UpdateStatus;
  readonly retry: (agentId: string) => void;
  /** Poll this tool's report until a new one arrives. */
  readonly watch: (agentId: string, label: string) => void;
  readonly watching: (agentId: string) => boolean;
  readonly origin: string;
  readonly now: number;
}

const UpdatesContext = createContext<UpdatesValue | undefined>(undefined);

export interface UpdatesProviderProps {
  /** Active tools on the listed devices: the rows that show a status. */
  readonly agentIds: readonly string[];
  readonly origin: string;
  readonly announce: (message: string) => void;
  readonly children: ReactNode;
}

function aborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export function UpdatesProvider({ agentIds, origin, announce, children }: UpdatesProviderProps) {
  const [manifest, setManifest] = useState<Read<UpdateManifest>>(undefined);
  const [answers, setAnswers] = useState<ReadonlyMap<string, Read<AgentVerification>>>(new Map());
  const [watched, setWatched] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  const watches = useRef(new Map<string, Watch>());
  const manifestRef = useRef<Read<UpdateManifest>>(undefined);
  manifestRef.current = manifest;

  useEffect(() => {
    live.current = true;
    const pending = watches.current;
    return () => {
      live.current = false;
      for (const w of pending.values()) w.cancel();
      pending.clear();
    };
  }, []);

  const loadManifest = useCallback((signal?: AbortSignal): void => {
    setManifest(undefined);
    getCompatibility(signal)
      .then((body) => {
        if (!live.current) return;
        setManifest(updateManifestOf(body) ?? 'failed');
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (aborted(cause) || !live.current) return;
        setManifest('failed');
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadManifest(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadManifest]);

  const put = useCallback((agentId: string, value: Read<AgentVerification>): void => {
    setAnswers((was) => new Map(was).set(agentId, value));
  }, []);

  const readVerification = useCallback(
    (agentId: string): Promise<Read<AgentVerification>> =>
      getAgentVerification(agentId).then(
        (v) => v,
        (): Read<AgentVerification> => 'failed',
      ),
    [],
  );

  const fetchReport = useCallback(
    (agentId: string): void => {
      put(agentId, undefined);
      void readVerification(agentId).then((value) => {
        if (!live.current) return;
        put(agentId, value);
        setNow(Date.now());
      });
    },
    [put, readVerification],
  );

  // Each listed tool's report, once; a tool that appears later is read when it does.
  const idsKey = agentIds.join(',');
  useEffect(() => {
    for (const id of idsKey === '' ? [] : idsKey.split(',')) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      fetchReport(id);
    }
  }, [idsKey, fetchReport]);

  const retry = useCallback(
    (agentId: string): void => {
      if (manifestRef.current === 'failed') loadManifest();
      fetchReport(agentId);
    },
    [fetchReport, loadManifest],
  );

  const answersRef = useRef(answers);
  answersRef.current = answers;

  const watch = useCallback(
    (agentId: string, label: string): void => {
      if (watches.current.has(agentId)) return;
      const was = answersRef.current.get(agentId);
      const before =
        was === undefined || was === 'failed' ? undefined : reportKey(was.client_report);
      setWatched((set) => new Set(set).add(agentId));
      const w = watchForReport<AgentVerification>(
        () =>
          readVerification(agentId).then((value) =>
            value !== 'failed' && value !== undefined && reportKey(value.client_report) !== before
              ? value
              : undefined,
          ),
        REAL_CLOCK,
        (found) => {
          watches.current.delete(agentId);
          if (!live.current) return;
          setWatched((set) => {
            const next = new Set(set);
            next.delete(agentId);
            return next;
          });
          if (found === undefined) return;
          put(agentId, found);
          setNow(Date.now());
          announce(
            updateAnnouncement(label, updateStatus(manifestRef.current, found.client_report)),
          );
        },
      );
      watches.current.set(agentId, w);
    },
    [announce, put, readVerification],
  );

  const value = useMemo<UpdatesValue>(() => {
    const report = (agentId: string): Read<ClientReport | null> => {
      const answer = answers.get(agentId);
      return answer === undefined || answer === 'failed' ? answer : answer.client_report;
    };
    return {
      manifest,
      verification: (agentId) => answers.get(agentId),
      report,
      status: (agentId) => updateStatus(manifest, report(agentId)),
      retry,
      watch,
      watching: (agentId) => watched.has(agentId),
      origin,
      now,
    };
  }, [manifest, answers, retry, watch, watched, origin, now]);

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

function useUpdates(): UpdatesValue | undefined {
  return useContext(UpdatesContext);
}

/**
 * A tool's verification as the provider read it — `undefined` while it is
 * being read, when it failed, or outside a provider. What its readiness is
 * worked out from (`listedStatus`), on its row and in its details alike.
 */
export function useVerification(agentId: string): AgentVerification | undefined {
  const answer = useUpdates()?.verification(agentId);
  return answer === 'failed' ? undefined : answer;
}

/** A tool's helper update status, outside a provider `undefined`. */
export function useUpdateStatus(agentId: string): UpdateStatus | undefined {
  return useUpdates()?.status(agentId);
}

/** The helper version a tool reported — *helper 0.1.0* — for its row's line. */
export function useReportedHelper(agentId: string): string | undefined {
  return reportedHelper(useUpdates()?.report(agentId));
}

/**
 * The version chip on a tool's row (LAI-1083; LAI-1080 showed only the update
 * ones): *Helper up to date*, *Update available*, *Update required*, *Version
 * unknown* or *Could not check*. Its reason and the command are in the tool's
 * details.
 */
export function UpdateChip({
  status,
  label,
}: {
  readonly status: UpdateStatus | undefined;
  /** `<tool> · <device>`: given, the chip explains itself for this row (LAI-1086). */
  readonly label?: string;
}) {
  const chip = versionChip(status?.key);
  if (chip === undefined || status === undefined) return null;
  return (
    <span data-update-chip={chip.key}>
      {label === undefined ? (
        <DesignChip tone={chip.tone}>{chip.word}</DesignChip>
      ) : (
        <HintChip
          word={chip.word}
          tone={chip.tone}
          description={updateChipDescription(label, status)}
        />
      )}
    </span>
  );
}

/**
 * A device row's version chip (LAI-1083): the worst helper status among its
 * active tools, *Helpers up to date* when every one is. The count of each is
 * the device's details (`DeviceUpdate`).
 */
export function DeviceVersionChip({
  agentIds,
  name,
}: {
  readonly agentIds: readonly string[];
  /** The device's name: its chip's description says it (LAI-1086). */
  readonly name: string;
}) {
  const updates = useUpdates();
  if (updates === undefined || agentIds.length === 0) return null;
  const statuses = agentIds.map((id) => updates.status(id));
  const chip = versionChip(worstUpdate(statuses), agentIds.length);
  if (chip === undefined || chip.key === 'checking') return null;
  return (
    <span data-device-version={chip.key}>
      <HintChip
        word={chip.word}
        tone={chip.tone}
        description={deviceVersionDescription(
          name,
          deviceUpdateSummary(statuses) ?? chip.word,
          chip.key,
        )}
      />
    </span>
  );
}

// ------------------------------------------------------------------ one tool

export interface ToolUpdateProps {
  readonly agentId: string;
  /** `<tool> · <device>`, for the controls' names and the announcement. */
  readonly label: string;
}

/**
 * A tool's update status, in its details (LAI-1080): a note whose title is
 * the status word — warm when there is something to update to — with its
 * reason, what the helper reported, and then the command, *What's new*, and
 * what to do after. The section it sits in is labelled *Helper*.
 */
export function ToolUpdate({ agentId, label }: ToolUpdateProps) {
  const updates = useUpdates();
  if (updates === undefined) return null;
  const s = updates.status(agentId);
  const report = updates.report(agentId);
  const known = report !== undefined && report !== 'failed' ? report : null;
  const manifest = updates.manifest;
  const notes =
    manifest !== undefined && manifest !== 'failed' ? whatsNew(manifest, known) : undefined;
  const command = updateCommand(updates.origin);
  const id = `update-${agentId}`;

  return (
    <div className="dv3-update" data-update={s.key} id={id}>
      <NoteBlock tone={offersUpdate(s.key) ? 'warn' : 'neutral'} title={s.word}>
        <p data-update-reason>{s.reason}</p>
        {known !== null && <ReportFacts report={known} now={updates.now} />}
        {s.key === 'unchecked' && (
          <div className="dx-actions">
            <button
              type="button"
              className="dx-btn dx-btn-sm dv3-update-retry"
              aria-label={`Retry the update check for ${label}`}
              onClick={() => {
                updates.retry(agentId);
              }}
            >
              Retry
            </button>
          </div>
        )}

        {offersUpdate(s.key) && (
          <details className="dv3-update-how" data-update-how>
            <summary>How to update {label}</summary>
            <p className="dv3-note">
              On that device, check first, then update. It moves your Laika checkout to the helper
              this board offers; nothing else on the device changes.
            </p>
            <CodeBlock
              label="Terminal"
              labelId={`${id}-command`}
              text={command.text}
              what="the update command"
              onCopied={() => {
                updates.watch(agentId, label);
              }}
            />
            {command.allowHttp && (
              <p className="dv3-note" data-allow-http>
                <strong>Why --allow-http:</strong> {ALLOW_HTTP_WHY}
              </p>
            )}
            <p className="dv3-note" data-too-old-update="">
              If laika update is an unknown command on that device, its CLI is older still:{' '}
              {GUIDE_TITLE}, below, has the steps for it, wherever the old checkout is.
            </p>
            <p className="dv3-note" data-after-update>
              {AFTER_UPDATE}
            </p>
            {updates.watching(agentId) && (
              <p className="dv3-note" data-watching>
                Watching for {label}’s new version report.
              </p>
            )}
          </details>
        )}

        {s.key === 'unknown' && (
          <p className="dv3-note" data-version-unknown-hint="">
            {versionUnknownHint()}
          </p>
        )}
        {guideFor(s.key) && (
          <UpdateCliHelp
            origin={updates.origin}
            place="tool"
            onCopiedUpdate={() => {
              updates.watch(agentId, label);
            }}
          />
        )}

        {notes !== undefined && notes.length > 0 && s.key !== 'checking' && (
          <details className="dv3-update-new" data-whats-new>
            <summary>What’s new</summary>
            <ul className="dv3-update-notes">
              {notes.map((line) => (
                <li key={line.protocol} data-new-for-tool={line.newForTool || undefined}>
                  <span className="dv3-update-protocol">Protocol {line.protocol}</span>
                  {line.newForTool && <span className="dv3-tag">New for this tool</span>}{' '}
                  {line.summary}
                </li>
              ))}
            </ul>
          </details>
        )}
      </NoteBlock>
    </div>
  );
}

/**
 * What the helper said it is — self-reported, so said as it said it.
 *
 * **The time is hidden by the server, not here.** While the organisation has
 * presence off, `GET /agents/:id/verification` answers `reported_at: null`
 * whatever was stored (`getAgentVerification` in
 * `server/src/services/tool-setup.ts`), so a null is drawn as no time at all —
 * never *never*, never a guess.
 */
function ReportFacts({ report, now }: { readonly report: ClientReport; readonly now: number }) {
  const parts: string[] = [];
  if (report.cli_version !== null) parts.push(`laika ${report.cli_version}`);
  if (report.cli_commit !== null) parts.push(report.cli_commit.slice(0, 7));
  if (report.protocol !== null) parts.push(`protocol ${String(report.protocol)}`);
  if (parts.length === 0) return null;
  return (
    <p className="dv3-update-facts" data-report>
      Reported: {parts.join(' · ')}
      {report.reported_at !== null && (
        <span data-reported-at>, {timeLabel(report.reported_at, now).text}</span>
      )}
    </p>
  );
}

// ------------------------------------------------------------------ one device

/**
 * A device's tools' helper statuses, for its details' folded *Helper updates*
 * row (LAI-1100): the worst, and the line {@link DeviceUpdate} shows under it.
 * `undefined` outside a provider, or while nothing is read yet.
 */
export function useDeviceUpdate(
  agentIds: readonly string[],
): { readonly worst: UpdateKey | undefined; readonly line: string } | undefined {
  const updates = useUpdates();
  if (updates === undefined) return undefined;
  const statuses = agentIds.map((id) => updates.status(id));
  const line = deviceUpdateSummary(statuses);
  return line === undefined ? undefined : { worst: worstUpdate(statuses), line };
}

/** A device's line, in its details: its tools' update statuses, worst first. */
export function DeviceUpdate({ agentIds }: { readonly agentIds: readonly string[] }) {
  const updates = useUpdates();
  if (updates === undefined) return null;
  const statuses = agentIds.map((id) => updates.status(id));
  const line = deviceUpdateSummary(statuses);
  if (line === undefined) return null;
  const worst = worstUpdate(statuses);
  return (
    <>
      <p className="dv3-note dv3-update-summary" data-device-update={worst}>
        {line}
      </p>
      {guideFor(worst) && <UpdateCliHelp origin={updates.origin} place="device" />}
    </>
  );
}

// ------------------------------------------------------------------ the board

/** §H *Board update*: owner or admin, and only when a helper is ahead of the board. */
export function BoardUpdateNote({
  orgRole,
  agentIds,
}: {
  readonly orgRole: string | undefined;
  readonly agentIds: readonly string[];
}) {
  const updates = useUpdates();
  if (updates === undefined) return null;
  const note = boardBehindNote(
    orgRole,
    agentIds.map((id) => updates.status(id)),
  );
  if (note === undefined) return null;
  return (
    <div role="note" data-board-update>
      <NoteBlock tone="accent" title="Board update">
        <p>{note}</p>
      </NoteBlock>
    </div>
  );
}

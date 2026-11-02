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
import { getAgentVerification } from '../../../../api/tool-setup.ts';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import {
  AFTER_UPDATE,
  ALLOW_HTTP_WHY,
  boardBehindNote,
  deviceUpdateSummary,
  offersUpdate,
  reportKey,
  updateAnnouncement,
  updateCommand,
  updateManifestOf,
  updateStatus,
  whatsNew,
  worstUpdate,
  type ClientReport,
  type Read,
  type UpdateManifest,
  type UpdateStatus,
} from './update-status.ts';
import '../../connect/connect.css';
import './update-status.css';

/**
 * The update statuses on Developer access V3's Devices tab (LAI-1065, plan
 * LAI-1042 §H): one per tool row, a summary on each device card, and — for an
 * org owner or admin, only when the data shows it — a note that the board is
 * behind. No tab of their own.
 *
 * One provider reads the board's compatibility answer once, and each listed
 * tool's version report from `GET /agents/:id/verification`. After *Copy
 * update command* the row polls its report, with backoff, until a new one
 * arrives, and the change is announced through the tab's throttled live
 * region.
 */

/** First wait after a copy, then doubled up to the cap; given up after the limit. */
export const WATCH_FIRST_MS = 15_000;
export const WATCH_CAP_MS = 120_000;
export const WATCH_LIMIT_MS = 30 * 60_000;

interface UpdatesValue {
  readonly manifest: Read<UpdateManifest>;
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
  const [reports, setReports] = useState<ReadonlyMap<string, Read<ClientReport | null>>>(new Map());
  const [watched, setWatched] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const manifestRef = useRef<Read<UpdateManifest>>(undefined);
  manifestRef.current = manifest;

  useEffect(() => {
    live.current = true;
    const pending = timers.current;
    return () => {
      live.current = false;
      for (const timer of pending.values()) clearTimeout(timer);
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

  const put = useCallback((agentId: string, value: Read<ClientReport | null>): void => {
    setReports((was) => new Map(was).set(agentId, value));
  }, []);

  const readReport = useCallback(
    (agentId: string): Promise<Read<ClientReport | null>> =>
      getAgentVerification(agentId).then(
        (v) => v.client_report,
        (): Read<ClientReport | null> => 'failed',
      ),
    [],
  );

  const fetchReport = useCallback(
    (agentId: string): void => {
      put(agentId, undefined);
      void readReport(agentId).then((value) => {
        if (!live.current) return;
        put(agentId, value);
        setNow(Date.now());
      });
    },
    [put, readReport],
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

  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  const watch = useCallback(
    (agentId: string, label: string): void => {
      if (timers.current.has(agentId)) return;
      const was = reportsRef.current.get(agentId);
      const before = was === undefined || was === 'failed' ? undefined : reportKey(was);
      const started = Date.now();
      setWatched((set) => new Set(set).add(agentId));
      const stop = (): void => {
        timers.current.delete(agentId);
        if (live.current) {
          setWatched((set) => {
            const next = new Set(set);
            next.delete(agentId);
            return next;
          });
        }
      };
      const tick = (wait: number): void => {
        timers.current.set(
          agentId,
          setTimeout(() => {
            void readReport(agentId).then((value) => {
              if (!live.current) return;
              const changed =
                value !== 'failed' && value !== undefined && reportKey(value) !== before;
              if (changed) {
                put(agentId, value);
                setNow(Date.now());
                const m = manifestRef.current;
                announce(updateAnnouncement(label, updateStatus(m, value)));
                stop();
                return;
              }
              if (Date.now() - started >= WATCH_LIMIT_MS) {
                stop();
                return;
              }
              tick(Math.min(wait * 2, WATCH_CAP_MS));
            });
          }, wait),
        );
      };
      tick(WATCH_FIRST_MS);
    },
    [announce, put, readReport],
  );

  const value = useMemo<UpdatesValue>(
    () => ({
      manifest,
      report: (agentId) => reports.get(agentId),
      status: (agentId) => updateStatus(manifest, reports.get(agentId)),
      retry,
      watch,
      watching: (agentId) => watched.has(agentId),
      origin,
      now,
    }),
    [manifest, reports, retry, watch, watched, origin, now],
  );

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

function useUpdates(): UpdatesValue | undefined {
  return useContext(UpdatesContext);
}

// ------------------------------------------------------------------ one tool

export interface ToolUpdateProps {
  readonly agentId: string;
  /** `<tool> · <device>`, for the controls' names and the announcement. */
  readonly label: string;
}

/**
 * A tool row's update status: *Helper* and the status word with its reason,
 * what the helper reported, and — when there is something to update to — the
 * command, *What's new*, and what to do after.
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
      <div className="dv3-update-line">
        <span className="dv3-update-label">Helper</span>
        <StatusChip tone={s.tone} word={s.word} reason={s.reason} />
        {s.key === 'unchecked' && (
          <button
            type="button"
            className="bar-control dv3-update-retry"
            aria-label={`Retry the update check for ${label}`}
            onClick={() => {
              updates.retry(agentId);
            }}
          >
            Retry
          </button>
        )}
      </div>

      {known !== null && <ReportFacts report={known} now={updates.now} />}

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

/** A device card's line: its tools' update statuses, worst first. */
export function DeviceUpdate({ agentIds }: { readonly agentIds: readonly string[] }) {
  const updates = useUpdates();
  if (updates === undefined) return null;
  const statuses = agentIds.map((id) => updates.status(id));
  const line = deviceUpdateSummary(statuses);
  if (line === undefined) return null;
  return (
    <p className="dv3-note dv3-update-summary" data-device-update={worstUpdate(statuses)}>
      {line}
    </p>
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
    <p className="dv3-note dv3-board-update" role="note" data-board-update>
      {note}
    </p>
  );
}

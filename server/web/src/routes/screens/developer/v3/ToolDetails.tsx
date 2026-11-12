import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  getAgent,
  liveToken,
  revokeAgent,
  rotateAgentToken,
  type AgentSession,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import { getAgentCapacity, type CapacityPing } from '../../../../api/capacity.ts';
import { ApiError } from '../../../../api/errors.ts';
import type { MeProfile } from '../../../../api/me.ts';
import type { Project } from '../../../../api/projects.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import type { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { SidePanel } from '../../../../components/SidePanel.tsx';
import { PingButton } from '../../../../components/agent/PingButton.tsx';
import {
  noPingWords,
  pingProjectFor,
  whyNoPing,
  type NoPing,
} from '../../../../components/agent/capacity-derive.ts';
import { autoPickupWords } from '../../../../components/agent/capacity-derive.ts';
import { CheckIcon } from '../../../../components/wizard/CheckIcon.tsx';
import { AccessForm, RenameForm, SecretPanel, grantSummary, useOnceSecret } from '../AgentsTab.tsx';
import { CheckpointConsentSwitch, type ConsentRead } from '../CheckpointConsentSwitch.tsx';
import { cloudExpiry, cloudExpiryProblem, isCloudDevice, rotatableToken } from '../agent-wizard.ts';
import { showsConsent } from '../checkpoint-consent.ts';
import { AutoPickupChip } from './AutoPickupChip.tsx';
import { DesignChip } from './DesignChip.tsx';
import { DetailTiles } from './DetailTiles.tsx';
import { DetailsFold, useFolds } from './DetailsFold.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { pairedDevice } from './add-flow.ts';
import {
  checksSummary,
  consentSummary,
  helperSummary,
  supportsCheckpoints,
  toolNext,
} from './details-sections.ts';
import {
  CLOUD_NOTE,
  chipTone,
  disconnectImpact,
  listedStatus,
  toolAction,
  type ListedTool,
} from './devices-view.ts';
import { catalogTool } from './tool-catalog.ts';
import { checkLines, readiness } from './tool-readiness.ts';
import { ToolUpdate, useUpdateStatus, useVerification } from './ToolUpdate.tsx';

export const TOOL_PANEL_TITLE = 'dv3-tool-panel-title';

export interface ToolDetailsProps {
  /** `undefined` once the list is in and holds no such tool. */
  readonly listed: ListedTool | undefined;
  readonly now: number;
  readonly me: MeProfile | undefined;
  readonly canManage: boolean;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  /** Where Project setup is for this tool: `?tab=projects&tool=<id>`. */
  readonly projectHref: string;
  readonly onNavigate: (href: string) => void;
  readonly onChanged: (agent: RegisteredAgent) => void;
  /** *Reconnect* on a paired device: the Add tool wizard, with a `rotate` exchange. */
  readonly onReconnect: (agent: RegisteredAgent) => void;
  /** The tool was disconnected: the panel closes, as its row leaves the list. */
  readonly onDisconnected: () => void;
  readonly announce: (message: string) => void;
  readonly confirm: ReturnType<typeof useConfirm>;
  readonly onClose: () => void;
  readonly restore: () => HTMLElement | null | undefined;
  /** A ping was answered: the list reads presence again (LAI-1102). */
  readonly onPinged?: (() => void) | undefined;
}

type Form = 'none' | 'rename' | 'access';

type ToolFold =
  'name' | 'checks' | 'helper' | 'projects' | 'credential' | 'checkpoints' | 'launcher' | 'device';

const HELPER_FOLD = `${TOOL_PANEL_TITLE}-helper`;

/**
 * A tool's details (LAI-1080): everything its one-line row on Tools has no
 * room for, at `?tab=tools&agent=<id>` — the address `?agent=` has named a
 * tool by since LAI-537.
 *
 * **The top is short** (LAI-1100, the owner's V3): its status under the
 * title, then the one next action (`toolNext`) — finish setting it up, the
 * steps for a helper the board refuses, a check still missing, or a first
 * project. Every other section is one summary row that opens in place
 * (`DetailsFold`):
 *
 * - **Name**, only for one of a legacy duplicate pair (D-120) — open, as it
 *   needs the owner.
 * - **Checks**, the evidence its status comes from (`checkLines`), out of the
 *   verification the list already read — no second request. *Ready* only
 *   from that evidence; until it is in, the agent's own stamps, which never
 *   say *Ready*.
 * - **Helper**: its update status, *How to update* and *What's new*.
 * - **Projects** it reaches, *Change access* on Project setup, and the same
 *   grants form here.
 * - **Credential** by prefix, and *Reconnect*: an exchange its paired device
 *   redeems, or — for a device with no key, or a tool the helper refuses —
 *   the new credential shown here once.
 * - **Automatic checkpoints**, for its owner, on a tool that can save them
 *   (`supportsCheckpoints`): its row names what the switch read.
 * - **Launcher**: *Auto-pickup* from its presence report, the newest answer
 *   this reader may see, and *Ping* (LAI-1102, D-126).
 * - **Device** it is on, and when it was last seen.
 *
 * **Disconnect tool…** stays at the foot, behind a confirmation naming what
 * stops.
 */
/** The id of the line saying why *Reconnect* is unavailable. */
const RECONNECT_WHY = 'dv3-reconnect-why';

export function ToolDetails({
  listed,
  now,
  me,
  canManage,
  projects,
  projectsError,
  onRetryProjects,
  projectHref,
  onNavigate,
  onChanged,
  onReconnect,
  onDisconnected,
  announce,
  confirm,
  onClose,
  restore,
  onPinged,
}: ToolDetailsProps) {
  if (listed === undefined) {
    return (
      <SidePanel
        title="Tool not found"
        titleId={TOOL_PANEL_TITLE}
        onClose={onClose}
        restore={restore}
        panel="tool"
      >
        <p className="dv3-none">
          No tool of yours has this address. It may have been removed, or the link is not yours.
        </p>
      </SidePanel>
    );
  }
  return (
    <ToolPanel
      key={listed.agent.id}
      listed={listed}
      now={now}
      me={me}
      canManage={canManage}
      projects={projects}
      projectsError={projectsError}
      onRetryProjects={onRetryProjects}
      projectHref={projectHref}
      onNavigate={onNavigate}
      onChanged={onChanged}
      onReconnect={onReconnect}
      onDisconnected={onDisconnected}
      announce={announce}
      confirm={confirm}
      onClose={onClose}
      restore={restore}
      onPinged={onPinged}
    />
  );
}

function ToolPanel({
  listed,
  now,
  me,
  canManage,
  projects,
  projectsError,
  onRetryProjects,
  projectHref,
  onNavigate,
  onChanged,
  onReconnect,
  onDisconnected,
  announce,
  confirm,
  onClose,
  restore,
  onPinged,
}: ToolDetailsProps & { readonly listed: ListedTool }) {
  const { agent, device, label, inConflict } = listed;
  const verification = useVerification(agent.id);
  const status = listedStatus(agent, verification, now);
  const tool = catalogTool(agent.harness);
  const active = agent.status === 'active';
  const cloud = device.kind === 'cloud' || isCloudDevice(agent.device_label);
  // Its device is paired **and** `laika tool add` can set this tool up:
  // *Reconnect* is an exchange the device redeems (LAI-1061), and no secret
  // reaches this page. Otherwise it is the browser-shown rotate.
  const paired = pairedDevice(device) && tool?.cliSetup === true;
  const live = liveToken(agent, now);
  const replaceable = rotatableToken(agent, now);
  const viewer = me?.org_role === 'viewer';
  const update = useUpdateStatus(agent.id);
  const consentShown = active && supportsCheckpoints(tool) && showsConsent(agent, me);
  const [consent, setConsent] = useState<ConsentRead>('reading');
  // A duplicate needs its owner: its Name section starts open.
  const folds = useFolds<ToolFold>(inConflict && active ? ['name'] : []);

  const [form, setForm] = useState<Form>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { held: rotated, hold, retire, forget } = useOnceSecret();
  // A revealed secret stops being shown the moment its tool is revoked — here
  // or by its device's disconnect — as the classic row does (review round 1).
  useEffect(() => {
    if (agent.status !== 'active') retire();
  }, [agent.status, retire]);

  // A credential shown once is gone when the panel closes (LAI-1081, the
  // owner, 2026-11-02): closing it by ×, Escape or the scrim asks first, and
  // reloading or leaving the page meanwhile gets the browser's own warning.
  // The browser's Back is the one way out that cannot be asked about here.
  const showingSecret = rotated !== undefined && rotated.secret !== '';
  useEffect(() => {
    if (!showingSecret) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [showingSecret]);
  const closePanel = (): void => {
    if (!showingSecret) {
      onClose();
      return;
    }
    void confirm({
      title: 'Close without copying the new credential?',
      body: `${label}’s new credential is shown only once, and the old one has already stopped working. Once this closes it cannot be shown again: you would have to reconnect ${label} with another new one.`,
      confirmLabel: 'Close anyway',
      cancelLabel: 'Keep it open',
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      forget();
      onClose();
    });
  };

  // A form closed — saved, cancelled or Escape — hands focus back to the
  // button that opened it, inside the panel, so a second Escape closes the
  // panel rather than landing on nothing.
  const accessButton = useRef<HTMLButtonElement | null>(null);
  const renameButton = useRef<HTMLButtonElement | null>(null);
  const closed = useRef<Form>('none');
  useEffect(() => {
    if (form !== 'none' || closed.current === 'none') return;
    (closed.current === 'access' ? accessButton : renameButton).current?.focus();
    closed.current = 'none';
  }, [form]);

  const closeForm = (): void => {
    closed.current = form;
    setForm('none');
    setError(undefined);
  };

  const rotate = (): void => {
    if (replaceable === undefined) return;
    void confirm({
      title: `Reconnect ${label} with a new credential?`,
      body: cloud
        ? 'A new credential is created, expiring within 24 hours as every Cloud one does, and the current one stops working at once. The tool keeps its project access and history; you give the runner the new credential.'
        : 'A new credential is created and the current one stops working at once. The tool keeps its project access and history; you give it the new credential.',
      confirmLabel: 'Create new credential',
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      setBusy(true);
      setError(undefined);
      rotateAgentToken(agent.id, replaceable.id, cloud ? cloudExpiry(Date.now()) : undefined)
        .then((answer) => {
          hold(answer);
          onChanged(answer.agent);
          announce(`${label} has a new credential. Copy it now; it is not shown again.`);
        })
        .catch((cause: unknown) => {
          setError(cloudExpiryProblem(cause) ?? errorText(cause, 'Could not reconnect that tool.'));
        })
        .finally(() => {
          setBusy(false);
        });
    });
  };

  const disconnect = (): void => {
    setBusy(true);
    setError(undefined);
    getAgent(agent.id)
      .then(
        (detail): readonly AgentSession[] | undefined => detail.sessions,
        () => undefined,
      )
      .then((sessions) => {
        const impact = disconnectImpact(agent, sessions, Date.now());
        return confirm({
          title: `Disconnect ${label}?`,
          body: `${impact.credential} ${impact.sessionsLine} ${impact.claims} It cannot be restored. Your other tools and your own tokens are not touched.`,
          detail:
            impact.sessions.length === 0 ? undefined : (
              <ul className="dv3-dialog-list" data-disconnect-sessions>
                {impact.sessions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ),
          confirmLabel: 'Disconnect tool',
          danger: true,
          icon: 'warning',
        });
      })
      .then((yes) => {
        if (!yes) {
          setBusy(false);
          return;
        }
        revokeAgent(agent.id)
          .then((next) => {
            retire();
            onChanged(next);
            announce(`${label} disconnected.`);
            onDisconnected();
          })
          .catch((cause: unknown) => {
            setError(errorText(cause, 'Could not disconnect that tool.'));
          })
          .finally(() => {
            setBusy(false);
          });
      })
      .catch(() => {
        setBusy(false);
      });
  };

  const lines =
    verification === undefined || tool === undefined || !active
      ? undefined
      : checkLines(verification, tool, device.display_name);
  const versionUnknown =
    verification !== undefined &&
    tool !== undefined &&
    readiness(verification, tool).versionUnknown;
  const follow = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };
  const next = toolNext({
    active,
    status: status.key,
    lines,
    update: active ? update?.key : undefined,
    projects: agent.grants.length,
  });
  const finishInWizard = toolAction(listed, status) === 'finish-in-wizard' && canManage;
  // The helper's steps are its section's: open it, and take focus to its row.
  const showHelper = (): void => {
    folds.setOpen('helper', true);
    document.getElementById(HELPER_FOLD)?.querySelector('summary')?.focus();
  };
  const seen = agent.last_seen_at === null ? undefined : timeLabel(agent.last_seen_at, now);

  return (
    <SidePanel
      title={label}
      titleId={TOOL_PANEL_TITLE}
      subtitle={
        <span
          className="dv3-panel-status"
          data-readiness={status.key}
          data-evidence={status.evidence}
        >
          <DesignChip tone={chipTone(status.tone)}>{status.word}</DesignChip>
          <span className="dv3-panel-reason">{status.reason}</span>
        </span>
      }
      onClose={closePanel}
      restore={restore}
      panel="tool"
      // Busy is `aria-disabled`, never `disabled`: a confirmation hands focus
      // back to the button that asked it, and a disabled one cannot take it.
      footer={
        canManage && active ? (
          <button
            type="button"
            className="dx-btn dx-btn-sm dv3-danger"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) disconnect();
            }}
          >
            Disconnect tool…
          </button>
        ) : undefined
      }
    >
      <div
        className="dv3-tool-details"
        data-agent={agent.id}
        data-status={status.key}
        aria-busy={busy || undefined}
      >
        <div className="dv3-details-top">
          {rotated !== undefined && (
            <div>
              <SecretPanel
                created={rotated}
                label={label}
                title="New credential — copy it now, it is not shown again"
                onDone={forget}
              />
            </div>
          )}

          {next.kind === 'revoked' && (
            <p className="dv3-none" data-next="revoked">
              Revoked: its credentials no longer work, and nothing here can change it.
            </p>
          )}
          {next.kind === 'finish' && (next.check !== undefined || finishInWizard) && (
            <div data-next="finish">
              <NoteBlock tone="warn" title="Finish setup">
                {next.check !== undefined && (
                  <p>
                    <strong>{next.check.label}:</strong> <InlineCode text={next.check.detail} />
                  </p>
                )}
                {finishInWizard && (
                  <div className="dx-actions">
                    <button
                      type="button"
                      className="dx-btn dx-btn-sm dx-btn-primary"
                      aria-label={`Finish setting up ${label}`}
                      aria-disabled={busy || undefined}
                      onClick={() => {
                        if (!busy) onReconnect(agent);
                      }}
                    >
                      Finish setup →
                    </button>
                  </div>
                )}
              </NoteBlock>
            </div>
          )}
          {next.kind === 'update' && update !== undefined && (
            <div data-next="update">
              <NoteBlock tone="warn" title={update.word}>
                <p>{update.reason}</p>
                <div className="dx-actions">
                  <button type="button" className="dx-btn dx-btn-sm" onClick={showHelper}>
                    Show how to update
                  </button>
                </div>
              </NoteBlock>
            </div>
          )}
          {next.kind === 'check' && (
            <div data-next="check">
              <NoteBlock tone="accent" title={`Still missing: ${next.check.label}`}>
                <p>
                  <InlineCode text={next.check.detail} />
                </p>
              </NoteBlock>
            </div>
          )}
          {next.kind === 'project' && (
            <div data-next="project">
              <NoteBlock tone="accent" title="No project yet">
                <p>{label} reaches no project yet: set one up to give it work.</p>
                <div className="dx-actions">
                  <a
                    className="dx-btn dx-btn-sm dx-btn-primary"
                    href={projectHref}
                    aria-label={`Set up a project for ${label}`}
                    onClick={follow(projectHref)}
                  >
                    Set up a project →
                  </a>
                </div>
              </NoteBlock>
            </div>
          )}

          {error !== undefined && (
            <p className="agents-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="dv3-folds">
          {inConflict && active && (
            <DetailsFold
              {...folds.fold('name')}
              title="Name"
              summary="A duplicate: rename to tell them apart"
              hook="rename"
            >
              <p className="dv3-note">
                Another agent of this tool on {device.display_name} is active too, from before one
                agent per tool per device. Both keep working; a name tells them apart.
              </p>
              {form === 'rename' ? (
                <RenameForm
                  agent={agent}
                  onSaved={(saved) => {
                    onChanged(saved);
                    announce(`Renamed to ${saved.display_name}.`);
                    closeForm();
                  }}
                  onCancel={closeForm}
                />
              ) : (
                canManage && (
                  <div className="dx-actions dv3-panel-actions">
                    <button
                      type="button"
                      ref={renameButton}
                      className="dx-btn dx-btn-sm"
                      onClick={() => {
                        setForm('rename');
                      }}
                    >
                      Rename…
                    </button>
                  </div>
                )
              )}
            </DetailsFold>
          )}

          {active && (
            <DetailsFold
              {...folds.fold('checks')}
              title="Checks"
              summary={
                lines !== undefined
                  ? checksSummary(lines)
                  : tool === undefined
                    ? 'None this page can read'
                    : 'Not read yet'
              }
            >
              {lines === undefined ? (
                <p className="dv3-none">
                  {tool === undefined
                    ? 'This kind of tool has no checks this page can read; the status is from its own last request.'
                    : 'Its checks could not be read yet; the status is from its own last request.'}
                </p>
              ) : (
                <ul className="dv3-checks" aria-label={`Checks for ${label}`} data-checks>
                  {lines.map((l) => (
                    <li key={l.id} className="dv3-check" data-check={l.id} data-state={l.state}>
                      <span className="dv3-check-mark" aria-hidden="true">
                        {l.state === 'pass' ? <CheckIcon /> : l.state === 'unsupported' ? '–' : '○'}
                      </span>
                      <span className="dv3-check-text">
                        <span className="dv3-check-label">
                          {l.label}
                          <span className="dv3-check-state">
                            {l.state === 'pass'
                              ? 'Done'
                              : l.state === 'unsupported'
                                ? 'Not supported'
                                : 'Missing'}
                          </span>
                        </span>
                        <span className="dv3-check-detail">
                          <InlineCode text={l.detail} />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {lines !== undefined && tool !== undefined && (
                <p className="dv3-note">
                  {tool.name}’s name for itself is what it reports; Ready means its own credential,
                  announcing itself as {tool.name}.
                  {versionUnknown &&
                    ' Its version is unknown: neither the helper nor the tool said.'}
                </p>
              )}
              {live === undefined && replaceable !== undefined && (
                <p className="dv3-note" data-cloud-expired>
                  {CLOUD_NOTE}
                </p>
              )}
            </DetailsFold>
          )}

          {active && (
            <DetailsFold
              {...folds.fold('helper')}
              id={HELPER_FOLD}
              title="Helper"
              summary={helperSummary(update?.key)}
            >
              <ToolUpdate agentId={agent.id} label={label} />
            </DetailsFold>
          )}

          <DetailsFold
            {...folds.fold('projects')}
            title="Projects"
            summary={grantSummary(agent.grants, projects)}
          >
            <p className="dv3-panel-value" data-projects>
              {grantSummary(agent.grants, projects)}
            </p>
            {active && form !== 'access' && (
              <div className="dx-actions dv3-panel-actions">
                <a className="dx-btn dx-btn-sm" href={projectHref} onClick={follow(projectHref)}>
                  Change access →
                </a>
                {canManage && (
                  <button
                    type="button"
                    ref={accessButton}
                    className="dx-btn dx-btn-sm dx-btn-ghost"
                    onClick={() => {
                      setForm('access');
                    }}
                  >
                    Project access…
                  </button>
                )}
              </div>
            )}
            {form === 'access' && (
              <AccessForm
                agent={agent}
                projects={projects}
                projectsError={projectsError}
                onRetryProjects={onRetryProjects}
                viewer={viewer}
                onSaved={(saved) => {
                  onChanged(saved);
                  announce(`${label}’s project access saved.`);
                  closeForm();
                }}
                onCancel={closeForm}
              />
            )}
          </DetailsFold>

          <DetailsFold
            {...folds.fold('credential')}
            title="Credential"
            summary={live === undefined ? 'None live' : `${live.prefix}…`}
          >
            <p className="dv3-panel-value" data-credential>
              {live === undefined ? 'None live' : <code>{live.prefix}…</code>}
            </p>
            {canManage && active && (
              <div className="dx-actions dv3-panel-actions">
                {paired ? (
                  <button
                    type="button"
                    className="dx-btn dx-btn-sm"
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (!busy) onReconnect(agent);
                    }}
                  >
                    Reconnect (new credential)…
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dx-btn dx-btn-sm"
                    aria-disabled={busy || replaceable === undefined || undefined}
                    aria-describedby={replaceable === undefined ? RECONNECT_WHY : undefined}
                    onClick={() => {
                      if (!busy) rotate();
                    }}
                  >
                    Reconnect (new credential)…
                  </button>
                )}
              </div>
            )}
            {/* Never a button that does nothing without saying why (LAI-1191, the audit's B10). */}
            {canManage && active && !paired && replaceable === undefined && (
              <p className="dv3-note" id={RECONNECT_WHY} data-reconnect-why>
                No live credential to replace — it expired or was revoked. Set this tool up again
                from Connect to give it a new one.
              </p>
            )}
            {cloud && active && <p className="dv3-note">{CLOUD_NOTE}</p>}
          </DetailsFold>

          {consentShown && (
            <DetailsFold
              {...folds.fold('checkpoints')}
              title="Automatic checkpoints"
              summary={consentSummary(consent)}
            >
              <CheckpointConsentSwitch
                agent={agent}
                me={me}
                canManage={canManage}
                now={now}
                onRead={setConsent}
              />
            </DetailsFold>
          )}

          {active && (
            <DetailsFold
              {...folds.fold('launcher')}
              title="Launcher"
              summary={autoPickupWords(agent.launcher, now, device.display_name).word}
              hook="launcher"
            >
              <AutoPickupChip
                launcher={agent.launcher}
                now={now}
                device={device.display_name}
                layout="panel"
              />
              {projects !== undefined && me !== undefined && (
                <ToolPing
                  agentId={agent.id}
                  project={pingProjectFor(agent, projects, me)}
                  why={whyNoPing(agent, projects, me)}
                  target={label}
                  onPinged={onPinged}
                />
              )}
            </DetailsFold>
          )}

          <DetailsFold
            {...folds.fold('device')}
            title="Device"
            summary={`${device.display_name} · ${seen === undefined ? 'never seen' : `seen ${seen.text}`}`}
          >
            <DetailTiles
              items={[
                { label: 'Device', value: device.display_name, id: 'device' },
                {
                  label: 'Last seen',
                  value:
                    seen === undefined ? (
                      'Never'
                    ) : (
                      <time dateTime={seen.iso} title={seen.full}>
                        {seen.text.replace(/^just now$/, 'Just now')}
                      </time>
                    ),
                  id: 'last-seen',
                },
              ]}
            />
          </DetailsFold>
        </div>
      </div>
    </SidePanel>
  );
}

/** Text with `backticked` runs set as code. */
function InlineCode({ text }: { readonly text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

/**
 * The panel's *Ping* (LAI-1102): offered only in a space where the reader
 * may ping this tool (`pingProjectFor`), with the newest answer they may see
 * there until they ask again. The board's `404` for that read is its answer
 * for an agent this reader may not ping, so it says so and offers nothing.
 */
function ToolPing({
  agentId,
  project,
  why,
  target,
  onPinged,
}: {
  readonly agentId: string;
  readonly project: string | undefined;
  /** Why there is no space to ping in — read only when `project` is undefined. */
  readonly why: NoPing;
  readonly target: string;
  readonly onPinged: (() => void) | undefined;
}) {
  const [latest, setLatest] = useState<CapacityPing | null | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (project === undefined) return;
    const controller = new AbortController();
    getAgentCapacity(agentId, project, controller.signal)
      .then((capacity) => {
        setLatest(capacity.latest_answer);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // Anything but the refusal leaves Ping offered, with no earlier answer.
        if (cause instanceof ApiError && cause.status === 404) setRefused(true);
        setLatest(null);
      });
    return () => {
      controller.abort();
    };
  }, [agentId, project]);

  if (project === undefined || refused) {
    return (
      <p className="dv3-note" data-ping-none={refused ? 'refused' : why.kind}>
        {refused
          ? `${target} cannot be pinged here: the board knows no agent of yours by that id with full access to a space.`
          : noPingWords(why, target)}
      </p>
    );
  }
  return (
    <div className="dx-actions dv3-panel-actions">
      <PingButton
        agentId={agentId}
        project={project}
        target={target}
        initial={latest}
        onAnswered={onPinged}
      />
    </div>
  );
}

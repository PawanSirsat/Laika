import { useEffect, useState, type MouseEvent } from 'react';
import {
  getAgent,
  liveToken,
  revokeAgent,
  rotateAgentToken,
  type AgentSession,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import type { MeProfile } from '../../../../api/me.ts';
import type { Project } from '../../../../api/projects.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import type { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { SidePanel } from '../../../../components/SidePanel.tsx';
import { CheckIcon } from '../../../../components/wizard/CheckIcon.tsx';
import { AccessForm, RenameForm, SecretPanel, grantSummary, useOnceSecret } from '../AgentsTab.tsx';
import { CheckpointConsentSwitch } from '../CheckpointConsentSwitch.tsx';
import { cloudExpiry, cloudExpiryProblem, isCloudDevice, rotatableToken } from '../agent-wizard.ts';
import { showsConsent } from '../checkpoint-consent.ts';
import { DesignChip } from './DesignChip.tsx';
import { DetailTiles } from './DetailTiles.tsx';
import { pairedDevice } from './add-flow.ts';
import {
  CLOUD_NOTE,
  chipTone,
  disconnectImpact,
  listedStatus,
  type ListedTool,
} from './devices-view.ts';
import { catalogTool } from './tool-catalog.ts';
import { checkLines, readiness } from './tool-readiness.ts';
import { ToolUpdate, useVerification } from './ToolUpdate.tsx';

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
}

type Form = 'none' | 'rename' | 'access';

/**
 * A tool's details (LAI-1080): everything its one-line row on Tools has no
 * room for, at `?tab=tools&agent=<id>` — the address `?agent=` has named a
 * tool by since LAI-537. What was every tool row's expanded body on Devices
 * (LAI-1054, LAI-1065) moved here unchanged:
 *
 * - **Status**, and the checks it comes from (`checkLines`), out of the
 *   verification the list already read — no second request. *Ready* only
 *   from that evidence; until it is in, the agent's own stamps, which never
 *   say *Ready*.
 * - **Helper**: its update status, *How to update* and *What's new*.
 * - **Projects** it reaches, *Change access* on Project setup, and the same
 *   grants form here.
 * - **Credential** by prefix, and *Reconnect*: an exchange its paired device
 *   redeems, or — for a device with no key, or a tool the helper refuses —
 *   the new credential shown here once.
 * - **Save checkpoints automatically**, for its owner.
 * - **Rename**, only for one of a legacy duplicate pair (D-120).
 * - **Disconnect tool…** at the foot, behind a confirmation naming what stops.
 */
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

  const [form, setForm] = useState<Form>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { held: rotated, hold, retire, forget } = useOnceSecret();
  // A revealed secret stops being shown the moment its tool is revoked — here
  // or by its device's disconnect — as the classic row does (review round 1).
  useEffect(() => {
    if (agent.status !== 'active') retire();
  }, [agent.status, retire]);

  const closeForm = (): void => {
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
      onClose={onClose}
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
        {rotated !== undefined && (
          <div className="side-panel-section">
            <SecretPanel
              created={rotated}
              label={label}
              title="New credential — copy it now, it is not shown again"
              onDone={forget}
            />
          </div>
        )}

        <section className="side-panel-section" aria-labelledby="dv3-tool-status">
          <h3 className="side-panel-label" id="dv3-tool-status">
            Status
          </h3>
          {lines === undefined ? (
            <p className="dv3-none">
              {!active
                ? 'Revoked: its credentials no longer work, and nothing here can change it.'
                : tool === undefined
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
              {versionUnknown && ' Its version is unknown: neither the helper nor the tool said.'}
            </p>
          )}
          {active && live === undefined && replaceable !== undefined && (
            <p className="dv3-note" data-cloud-expired>
              {CLOUD_NOTE}
            </p>
          )}
        </section>

        <section className="side-panel-section" aria-labelledby="dv3-tool-facts">
          <h3 className="side-panel-label" id="dv3-tool-facts">
            Details
          </h3>
          <DetailTiles
            items={[
              { label: 'Device', value: device.display_name, id: 'device' },
              {
                label: 'Last seen',
                value:
                  agent.last_seen_at === null ? (
                    'Never'
                  ) : (
                    <time
                      dateTime={timeLabel(agent.last_seen_at, now).iso}
                      title={timeLabel(agent.last_seen_at, now).full}
                    >
                      {timeLabel(agent.last_seen_at, now).text.replace(/^just now$/, 'Just now')}
                    </time>
                  ),
                id: 'last-seen',
              },
            ]}
          />
        </section>

        {active && (
          <section className="side-panel-section" aria-labelledby="dv3-tool-helper">
            <h3 className="side-panel-label" id="dv3-tool-helper">
              Helper
            </h3>
            <ToolUpdate agentId={agent.id} label={label} />
          </section>
        )}

        <section className="side-panel-section" aria-labelledby="dv3-tool-projects">
          <h3 className="side-panel-label" id="dv3-tool-projects">
            Projects
          </h3>
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
              onSaved={(next) => {
                onChanged(next);
                announce(`${label}’s project access saved.`);
                closeForm();
              }}
              onCancel={closeForm}
            />
          )}
        </section>

        <section className="side-panel-section" aria-labelledby="dv3-tool-credential">
          <h3 className="side-panel-label" id="dv3-tool-credential">
            Credential
          </h3>
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
                  onClick={() => {
                    if (!busy) rotate();
                  }}
                >
                  Reconnect (new credential)…
                </button>
              )}
            </div>
          )}
          {cloud && active && <p className="dv3-note">{CLOUD_NOTE}</p>}
        </section>

        {active && showsConsent(agent, me) && (
          <section className="side-panel-section">
            <CheckpointConsentSwitch agent={agent} me={me} canManage={canManage} now={now} />
          </section>
        )}

        {inConflict && active && (
          <section className="side-panel-section" aria-labelledby="dv3-tool-rename" data-rename>
            <h3 className="side-panel-label" id="dv3-tool-rename">
              Name
            </h3>
            <p className="dv3-note">
              Another agent of this tool on {device.display_name} is active too, from before one
              agent per tool per device. Both keep working; a name tells them apart.
            </p>
            {form === 'rename' ? (
              <RenameForm
                agent={agent}
                onSaved={(next) => {
                  onChanged(next);
                  announce(`Renamed to ${next.display_name}.`);
                  closeForm();
                }}
                onCancel={closeForm}
              />
            ) : (
              canManage && (
                <div className="dx-actions dv3-panel-actions">
                  <button
                    type="button"
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
          </section>
        )}

        {error !== undefined && (
          <p className="agents-error" role="alert">
            {error}
          </p>
        )}
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

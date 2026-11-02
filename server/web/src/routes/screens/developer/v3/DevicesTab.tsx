import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { confirmAgentDevice, revokeAgentDevice } from '../../../../api/agent-devices.ts';
import {
  agentHarness,
  getAgent,
  liveToken,
  revokeAgent,
  rotateAgentToken,
  type AgentSession,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import { listDevices, type Device } from '../../../../api/devices.ts';
import { everyPage } from '../../../../api/every-page.ts';
import type { MeProfile } from '../../../../api/me.ts';
import { useGates } from '../../../../api/permissions.ts';
import { isTombstone, listProjects, type Project } from '../../../../api/projects.ts';
import { agentLabel, twinNames } from '../../../../api/selected-agent.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { EmptyState } from '../../../../components/EmptyState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import {
  OverflowMenu,
  type OverflowMenuItem,
} from '../../../../components/wizard/OverflowMenu.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import {
  AccessForm,
  AgentsTab,
  RenameForm,
  SecretPanel,
  grantSummary,
  useOnceSecret,
} from '../AgentsTab.tsx';
import { CheckpointConsentSwitch } from '../CheckpointConsentSwitch.tsx';
import { cloudExpiry, cloudExpiryProblem, isCloudDevice, rotatableToken } from '../agent-wizard.ts';
import { showsConsent } from '../checkpoint-consent.ts';
import {
  CLAIMS_LAPSE_MANY,
  CLOUD_NOTE,
  VERSION_UNKNOWN,
  deviceCounts,
  deviceLive,
  deviceOf,
  deviceTools,
  devicesSummary,
  disconnectImpact,
  kindWord,
  needsConfirm,
  runningSessions,
  toolRowId,
  toolStatus,
  withAgent,
  withConfirmed,
  withRevokedAgents,
  type Conflict,
} from './devices-view.ts';
import '../../tokens/tokens.css';
import '../agents.css';
import './devices-tab.css';

export interface DevicesTabProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
}

/**
 * Developer access V3 → Devices (LAI-1054, plan LAI-1042 §B.3, §D, §H).
 *
 * **Devices are the thing listed; their tools are rows inside them.** One
 * read, `GET /devices`, gives every device of the reader's with its agents —
 * an agent is one tool on one device — so there is one list, never a second
 * list of agents beside it.
 *
 * - A device says its kind (Cloud with its one-day note), how it got here,
 *   and when it was last seen. One the upgrade **imported** from its tools'
 *   labels, and nobody has claimed, asks *confirm it's yours* — the same
 *   `POST /agents/devices/confirm` as the classic *This is mine*.
 * - A tool row says its status in a word and a reason (`toolStatus`), from
 *   the agent's own credential and last request only. *Ready* is never shown:
 *   it needs per-tool verification, which no API serves yet.
 * - Two active agents of one tool on one device — from before one per pair —
 *   sit in an expandable *Needs your attention* section, both intact.
 * - Revoked tools and devices hide behind *Show revoked*, and no count
 *   includes them.
 *
 * **Not shown, because no API gives it yet:** *Working on LAIKA-n*. An
 * agent's live claims are not served to its owner (`GET /agents/:id` lists
 * sessions, not claims), and a row never guesses one.
 *
 * **Add device / Add tool** still open the classic registration wizard
 * (`?add=device|tool`, `?tool=<id>` to start it on a tool), which asks for
 * the device and the tool together. The V3 wizards replace it in slice D4.
 */
export function DevicesTab({ me, origin, params, setParams }: DevicesTabProps) {
  const gates = useGates(me !== undefined);
  const canManage = gates.org('agent.manage_own');
  const confirm = useConfirm();
  const add = params.get('add');
  const wizard = add === 'device' || add === 'tool';
  const focusAgent = params.get('agent');

  const [devices, setDevices] = useState<readonly Device[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [projects, setProjects] = useState<readonly Project[] | undefined>(undefined);
  const [projectsError, setProjectsError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showRevoked, setShowRevoked] = useState(false);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** The device whose disconnect is under way, from its first read to the answer (review round 1). */
  const [disconnecting, setDisconnecting] = useState<string | undefined>(undefined);
  const disconnectingRef = useRef<string | undefined>(undefined);
  /**
   * Where focus goes once a disconnect took a row away (review round 1): the
   * device's heading, or — when the device left the list with its last tool —
   * the list's own heading. Asked for before the write lands, and done in an
   * effect **after the list that lost the row has committed**: a timer could
   * run first, focus the heading, and see it unmount under it.
   */
  const focusNext = useRef<RefObject<HTMLElement | null> | undefined>(undefined);
  const focusAfterRemoval = useCallback((heading: RefObject<HTMLElement | null>): void => {
    focusNext.current = heading;
  }, []);
  useEffect(() => {
    const heading = focusNext.current;
    if (heading === undefined) return;
    focusNext.current = undefined;
    const own = heading.current;
    const target = own?.isConnected === true ? own : document.getElementById(DEVICES_TITLE);
    target?.focus();
  }, [devices]);
  const [deviceErrors, setDeviceErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [message, announce] = useLiveRegion();
  const addDeviceButton = useRef<HTMLButtonElement | null>(null);
  const addToolButton = useRef<HTMLButtonElement | null>(null);
  const lastAdd = useRef<'device' | 'tool' | undefined>(undefined);
  const readGen = useRef(0);

  const load = useCallback(
    (signal?: AbortSignal): void => {
      readGen.current += 1;
      const gen = readGen.current;
      listDevices(signal)
        .then(({ data }) => {
          if (gen !== readGen.current) return;
          setDevices(data);
          setError(null);
          setNow(Date.now());
          announce(devicesSummary(deviceCounts(data)));
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          if (gen !== readGen.current) return;
          setError(cause);
        });
    },
    [announce],
  );

  /** Unloaded is not empty: nothing that writes grants is enabled until this answers. */
  const loadProjects = useCallback((signal?: AbortSignal): void => {
    setProjectsError(null);
    everyPage((cursor) =>
      listProjects(cursor === undefined ? { limit: 100 } : { limit: 100, cursor }, signal),
    )
      .then(({ items }) => {
        setProjects(items.filter((p): p is Project => !isTombstone(p)));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectsError(cause);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    loadProjects(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load, loadProjects]);

  // `?agent=<id>`: once the list is in, open what hides it and bring the row to focus.
  const focused = useRef(false);
  const [openConflict, setOpenConflict] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (focused.current || devices === undefined || focusAgent === null || focusAgent === '') {
      return;
    }
    focused.current = true;
    const device = deviceOf(devices, focusAgent);
    if (device === undefined) return;
    const agent = device.agents.find((a) => a.id === focusAgent);
    if (agent?.status !== 'active' || !deviceLive(device)) setShowRevoked(true);
    if (deviceTools(device).conflicts.some((c) => c.agents.some((a) => a.id === focusAgent))) {
      setOpenConflict(device.id);
    }
    // After the render that shows it.
    setTimeout(() => {
      const row = document.getElementById(toolRowId(focusAgent));
      row?.scrollIntoView({ block: 'center' });
      row?.focus();
    }, 0);
  }, [devices, focusAgent]);

  const openAdd = (what: 'device' | 'tool'): void => {
    lastAdd.current = what;
    const next = new URLSearchParams(params);
    next.set('add', what);
    setParams(next, { push: true });
  };

  // Focus goes back to the button that opened the wizard, once it is back.
  useEffect(() => {
    if (wizard || lastAdd.current === undefined) return;
    const back = lastAdd.current === 'device' ? addDeviceButton : addToolButton;
    lastAdd.current = undefined;
    back.current?.focus();
  }, [wizard]);

  const put = (agent: RegisteredAgent): void => {
    setDevices((current) => (current === undefined ? current : withAgent(current, agent)));
    setNow(Date.now());
  };

  const recognise = (device: Device): void => {
    setConfirming(device.id);
    setDeviceErrors((errors) => without(errors, device.id));
    confirmAgentDevice(device.device_label)
      .then(() => {
        setDevices((current) =>
          current === undefined ? current : withConfirmed(current, device.id),
        );
        announce(`${device.display_name} confirmed as yours.`);
      })
      .catch((cause: unknown) => {
        setDeviceErrors((errors) =>
          new Map(errors).set(device.id, errorText(cause, 'Could not confirm that device.')),
        );
      })
      .finally(() => {
        setConfirming(undefined);
      });
  };

  const disconnectDevice = (device: Device, heading: RefObject<HTMLElement | null>): void => {
    const targets = device.agents.filter((agent) => agent.status === 'active');
    // One at a time: a second choice while the first is still out does nothing.
    if (targets.length === 0 || disconnectingRef.current !== undefined) return;
    const settle = (): void => {
      disconnectingRef.current = undefined;
      setDisconnecting(undefined);
    };
    disconnectingRef.current = device.id;
    setDisconnecting(device.id);
    setDeviceErrors((errors) => without(errors, device.id));
    void Promise.all(
      targets.map((agent) =>
        getAgent(agent.id).then(
          (detail) => runningSessions(detail.sessions).length,
          () => undefined,
        ),
      ),
    ).then((running) => {
      const twins = twinNames(device.agents);
      const count = targets.length;
      void confirm({
        title: `Disconnect ${device.display_name}?`,
        body: `${count === 1 ? 'This tool stops' : `These ${String(count)} tools stop`} at once: every credential they hold stops working and their running sessions end. ${CLAIMS_LAPSE_MANY} They cannot be restored. Tools on other devices and your own tokens are not touched.`,
        detail: (
          <ul className="dv3-dialog-list" data-disconnect-targets>
            {targets.map((agent, i) => {
              const n = running[i];
              const twin = twins.get(agent.id);
              return (
                <li key={agent.id}>
                  {twin === undefined ? agentLabel(agent) : `${agentLabel(agent)} (${twin})`}
                  {' — '}
                  {n === undefined
                    ? 'its sessions could not be read'
                    : n === 0
                      ? 'no running session'
                      : `${String(n)} running ${n === 1 ? 'session' : 'sessions'} end`}
                </li>
              );
            })}
          </ul>
        ),
        confirmLabel: `Disconnect ${String(count)} ${count === 1 ? 'tool' : 'tools'}`,
        danger: true,
        icon: 'warning',
      }).then((yes) => {
        if (!yes) {
          settle();
          return;
        }
        revokeAgentDevice(device.device_label)
          .then(({ revoked_agent_ids }) => {
            focusAfterRemoval(heading);
            setDevices((current) =>
              current === undefined
                ? current
                : withRevokedAgents(current, revoked_agent_ids, Date.now()),
            );
            announce(
              `${device.display_name} disconnected: ${String(revoked_agent_ids.length)} ${revoked_agent_ids.length === 1 ? 'tool' : 'tools'} revoked.`,
            );
            load();
          })
          .catch((cause: unknown) => {
            setDeviceErrors((errors) =>
              new Map(errors).set(device.id, errorText(cause, 'Could not disconnect that device.')),
            );
          })
          .finally(settle);
      });
    });
  };

  const counts = devices === undefined ? undefined : deviceCounts(devices);
  const listed =
    devices === undefined ? [] : devices.filter((device) => showRevoked || deviceLive(device));

  return (
    <div className="dev-body">
      <LiveRegion message={message} />
      {wizard && (
        // Slice D4 replaces this with the V3 Add device and Add tool wizards.
        <AgentsTab
          me={me}
          origin={origin}
          openWizard
          wizardOnly
          initialGuide={params.get('tool') ?? undefined}
          onWizardClosed={() => {
            lastAdd.current ??= add === 'device' ? 'device' : 'tool';
            const next = new URLSearchParams(params);
            next.delete('add');
            next.delete('tool');
            setParams(next);
            load();
          }}
        />
      )}

      <section className="dev-card dv3-devices" aria-labelledby={DEVICES_TITLE}>
        <div className="dev-card-head dv3-devices-head">
          <h2 className="dev-card-title" id={DEVICES_TITLE} tabIndex={-1}>
            Your devices
          </h2>
          {counts !== undefined && (
            <span className="conn-chip conn-chip-scope" data-counts>
              {counts.devices} {counts.devices === 1 ? 'device' : 'devices'} · {counts.tools}{' '}
              {counts.tools === 1 ? 'tool' : 'tools'}
            </span>
          )}
          {canManage && !wizard && (
            <div className="dv3-devices-actions">
              <button
                type="button"
                ref={addDeviceButton}
                className="bar-control"
                onClick={() => {
                  openAdd('device');
                }}
              >
                + Add device
              </button>
              <button
                type="button"
                ref={addToolButton}
                className="bar-control bar-control-primary"
                onClick={() => {
                  openAdd('tool');
                }}
              >
                + Add tool
              </button>
            </div>
          )}
        </div>

        <p className="dv3-intro">
          Each device holds the coding tools you connected on it. A tool acts as you, through a
          credential of its own, and never reaches more than you do.
        </p>

        {!canManage && gates.settled && (
          <p className="agents-note" role="note">
            Changing devices and tools needs a signed-in browser session. This one is not allowed to
            — the list below is read only.
          </p>
        )}

        {error !== null ? (
          <ApiErrorState
            error={error}
            resource="your devices"
            scope="organisation"
            onRetry={() => {
              setError(null);
              load();
            }}
          />
        ) : devices === undefined ? (
          <LoadingState shape="row" count={3} label="Loading your devices" />
        ) : listed.length === 0 && (counts?.revoked ?? 0) === 0 ? (
          <EmptyState
            headline="No devices yet"
            body="Add a device, then the coding tools you use on it."
            {...(canManage && !wizard
              ? {
                  action: {
                    label: 'Add a device',
                    onClick: () => {
                      openAdd('device');
                    },
                  },
                }
              : {})}
          />
        ) : (
          <>
            {listed.length === 0 ? (
              <p className="dv3-none" role="note">
                Every device and tool of yours is revoked.
              </p>
            ) : (
              <ul className="dv3-device-list" aria-labelledby={DEVICES_TITLE}>
                {listed.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    now={now}
                    me={me}
                    canManage={canManage}
                    showRevoked={showRevoked}
                    conflictsOpen={openConflict === device.id}
                    projects={projects}
                    projectsError={projectsError}
                    onRetryProjects={() => {
                      loadProjects();
                    }}
                    confirming={confirming === device.id}
                    disconnecting={disconnecting === device.id}
                    error={deviceErrors.get(device.id)}
                    onRecognise={() => {
                      recognise(device);
                    }}
                    onDisconnect={(heading) => {
                      disconnectDevice(device, heading);
                    }}
                    onChanged={put}
                    onRemoved={focusAfterRemoval}
                    announce={announce}
                    confirm={confirm}
                  />
                ))}
              </ul>
            )}
            {counts !== undefined && counts.revoked > 0 && (
              <button
                type="button"
                className="bar-control dv3-revoked-toggle"
                aria-pressed={showRevoked}
                onClick={() => {
                  setShowRevoked((on) => !on);
                }}
              >
                {showRevoked ? 'Hide revoked' : `Show revoked (${String(counts.revoked)})`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ one device

interface DeviceCardProps {
  readonly device: Device;
  readonly now: number;
  readonly me: MeProfile | undefined;
  readonly canManage: boolean;
  readonly showRevoked: boolean;
  readonly conflictsOpen: boolean;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  readonly confirming: boolean;
  /** Its disconnect is under way: the menu item says so and does nothing. */
  readonly disconnecting: boolean;
  readonly error: string | undefined;
  readonly onRecognise: () => void;
  readonly onDisconnect: (heading: RefObject<HTMLElement | null>) => void;
  readonly onChanged: (agent: RegisteredAgent) => void;
  /** A disconnect is about to take a row away: say where focus goes after. */
  readonly onRemoved: (heading: RefObject<HTMLElement | null>) => void;
  readonly announce: (message: string) => void;
  readonly confirm: ReturnType<typeof useConfirm>;
}

function DeviceCard({
  device,
  now,
  me,
  canManage,
  showRevoked,
  conflictsOpen,
  projects,
  projectsError,
  onRetryProjects,
  confirming,
  disconnecting,
  error,
  onRecognise,
  onDisconnect,
  onChanged,
  onRemoved,
  announce,
  confirm,
}: DeviceCardProps) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const { tools, conflicts, revoked } = deviceTools(device);
  const twins = twinNames(device.agents);
  const cloud = device.kind === 'cloud';
  const live = device.status === 'active';
  const conflictCount = conflicts.length;
  const row = (agent: RegisteredAgent, inConflict: boolean): ReactNode => (
    <ToolRow
      key={agent.id}
      agent={agent}
      label={
        twins.get(agent.id) === undefined
          ? agentLabel(agent)
          : `${agentLabel(agent)} (${twins.get(agent.id) ?? ''})`
      }
      cloud={cloud || isCloudDevice(agent.device_label)}
      inConflict={inConflict}
      now={now}
      me={me}
      canManage={canManage}
      projects={projects}
      projectsError={projectsError}
      onRetryProjects={onRetryProjects}
      onChanged={onChanged}
      onRemoved={onRemoved}
      announce={announce}
      confirm={confirm}
      heading={heading}
    />
  );

  const menu: OverflowMenuItem[] = [
    {
      id: 'disconnect',
      label: 'Disconnect device…',
      danger: true,
      disabled: device.active_count === 0 || disconnecting,
      onSelect: () => {
        onDisconnect(heading);
      },
    },
  ];

  return (
    <li
      className="dv3-device"
      data-device={device.id}
      data-kind={device.kind}
      data-origin={device.origin}
      data-status={device.status}
      data-confirmed={device.confirmed}
    >
      <div className="dv3-device-head">
        <h3 className="dv3-device-name" ref={heading} tabIndex={-1}>
          {device.display_name}
        </h3>
        <span className="dv3-tag" data-kind-tag>
          {kindWord(device)}
        </span>
        <span className="dv3-tag dv3-tag-quiet">
          {device.origin === 'paired' ? 'Paired' : 'Imported'}
        </span>
        {!live && <StatusChip tone="neutral" word="Revoked" reason="Its tools no longer work" />}
        <LastSeen at={device.last_seen_at} now={now} />
        {canManage && live && (
          <span className="dv3-device-menu">
            <OverflowMenu label={`More actions for ${device.display_name}`} items={menu} />
          </span>
        )}
      </div>

      {cloud && live && <p className="dv3-note">{CLOUD_NOTE}</p>}
      {device.key_fingerprint !== null && (
        <p className="dv3-note">
          Key fingerprint <code>{device.key_fingerprint}</code>
        </p>
      )}

      {needsConfirm(device) && (
        <div className="dv3-imported" role="note" data-imported>
          <p>
            <strong>Imported device — confirm it’s yours.</strong> Laika made this device from the
            name your tools reported when they were registered. Confirm it if you recognise it;
            disconnect it if you do not.
          </p>
          {canManage && (
            <button
              type="button"
              className="bar-control"
              disabled={confirming}
              aria-busy={confirming}
              aria-label={`Confirm ${device.display_name} is yours`}
              onClick={onRecognise}
            >
              Confirm it’s mine
            </button>
          )}
        </div>
      )}

      {tools.length > 0 && (
        <ul className="dv3-tools" aria-label={`Tools on ${device.display_name}`}>
          {tools.map((agent) => row(agent, false))}
        </ul>
      )}
      {tools.length === 0 && conflictCount === 0 && live && (
        <p className="dv3-none">No tools on this device yet.</p>
      )}

      {conflictCount > 0 && (
        <details className="dv3-conflicts" data-conflicts open={conflictsOpen || undefined}>
          <summary>
            Needs your attention: {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
          </summary>
          <p className="dv3-note">
            These were registered before one agent per tool per device. Each keeps working and
            nothing here revokes either: disconnect the one you do not want, or rename them to tell
            them apart.
          </p>
          {conflicts.map((conflict: Conflict) => (
            <div key={conflict.harness} className="dv3-conflict" data-conflict={conflict.harness}>
              <h4 className="dv3-conflict-title">
                {conflict.label}: {conflict.agents.length} active
              </h4>
              <ul
                className="dv3-tools"
                aria-label={`${conflict.label}, ${String(conflict.agents.length)} active`}
              >
                {conflict.agents.map((agent) => row(agent, true))}
              </ul>
            </div>
          ))}
        </details>
      )}

      {showRevoked && revoked.length > 0 && (
        <ul
          className="dv3-tools dv3-tools-revoked"
          aria-label={`Revoked tools on ${device.display_name}`}
        >
          {revoked.map((agent) => row(agent, false))}
        </ul>
      )}

      {error !== undefined && (
        <p className="agents-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ one tool

interface ToolRowProps {
  readonly agent: RegisteredAgent;
  /** `<tool> · <device>`, marked where another of the device's agents shares it. */
  readonly label: string;
  readonly cloud: boolean;
  /** One of a legacy duplicate pair: the only place *Rename* is offered (D-120). */
  readonly inConflict: boolean;
  readonly now: number;
  readonly me: MeProfile | undefined;
  readonly canManage: boolean;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  readonly onChanged: (agent: RegisteredAgent) => void;
  /** A disconnect is about to take a row away: say where focus goes after. */
  readonly onRemoved: (heading: RefObject<HTMLElement | null>) => void;
  readonly announce: (message: string) => void;
  readonly confirm: ReturnType<typeof useConfirm>;
  /** The device's heading — where focus goes when this row leaves the list. */
  readonly heading: RefObject<HTMLElement | null>;
}

type Panel = 'none' | 'rename' | 'access';

function ToolRow({
  agent,
  label,
  cloud,
  inConflict,
  now,
  me,
  canManage,
  projects,
  projectsError,
  onRetryProjects,
  onChanged,
  onRemoved,
  announce,
  confirm,
  heading,
}: ToolRowProps) {
  const status = toolStatus(agent, now);
  const active = agent.status === 'active';
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { held: rotated, hold, retire, forget } = useOnceSecret();
  // A revealed secret stops being shown the moment its tool is revoked — here
  // or by its device's disconnect — as the classic row does (review round 1).
  useEffect(() => {
    if (agent.status !== 'active') retire();
  }, [agent.status, retire]);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const live = liveToken(agent, now);
  const replaceable = rotatableToken(agent, now);
  const viewer = me?.org_role === 'viewer';

  /** Back to this row's ⋯ — where every panel and secret on it was opened from. */
  const backToMenu = (): void => {
    queueMicrotask(() => {
      rowRef.current?.querySelector<HTMLButtonElement>('.overflow-menu-button')?.focus();
    });
  };

  const closePanel = (): void => {
    setPanel('none');
    setError(undefined);
    backToMenu();
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
            onRemoved(heading);
            onChanged(next);
            announce(`${label} disconnected.`);
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

  const items: OverflowMenuItem[] = [
    ...(inConflict
      ? [
          {
            id: 'rename',
            label: 'Rename…',
            onSelect: () => {
              setPanel('rename');
            },
          },
        ]
      : []),
    {
      id: 'access',
      label: 'Project access…',
      onSelect: () => {
        setPanel('access');
      },
    },
    {
      id: 'reconnect',
      label: 'Reconnect (new credential)…',
      disabled: busy || replaceable === undefined,
      onSelect: rotate,
    },
    {
      id: 'disconnect',
      label: 'Disconnect tool…',
      danger: true,
      disabled: busy,
      onSelect: disconnect,
    },
  ];

  return (
    <li
      className="dv3-tool"
      id={toolRowId(agent.id)}
      tabIndex={-1}
      ref={rowRef}
      data-agent={agent.id}
      data-status={status.key}
      aria-busy={busy || undefined}
    >
      <div className="dv3-tool-main">
        <span className="dv3-tool-name">
          <AgentMark client={agentHarness(agent)} size="sm" />
          <span>{label}</span>
        </span>
        <StatusChip tone={status.tone} word={status.word} reason={status.reason} />
        {active && <span className="dv3-tag dv3-tag-quiet">{VERSION_UNKNOWN}</span>}
        {canManage && active && (
          <span className="dv3-tool-menu">
            <OverflowMenu label={`More actions for ${label}`} items={items} />
          </span>
        )}
      </div>

      {active && live === undefined && replaceable !== undefined && (
        <p className="dv3-note" data-cloud-expired>
          {CLOUD_NOTE}
        </p>
      )}

      <dl className="dv3-facts">
        <div>
          <dt>Last seen</dt>
          <dd>
            {agent.last_seen_at === null
              ? 'Never'
              : timeLabel(agent.last_seen_at, now).text.replace(/^just now$/, 'Just now')}
          </dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd>{grantSummary(agent.grants, projects)}</dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>{live === undefined ? 'None live' : <code>{live.prefix}…</code>}</dd>
        </div>
      </dl>

      {active && showsConsent(agent, me) && (
        <CheckpointConsentSwitch agent={agent} me={me} canManage={canManage} now={now} />
      )}

      {panel === 'rename' && (
        <RenameForm
          agent={agent}
          onSaved={(next) => {
            onChanged(next);
            announce(`Renamed to ${next.display_name}.`);
            closePanel();
          }}
          onCancel={closePanel}
        />
      )}
      {panel === 'access' && (
        <AccessForm
          agent={agent}
          projects={projects}
          projectsError={projectsError}
          onRetryProjects={onRetryProjects}
          viewer={viewer}
          onSaved={(next) => {
            onChanged(next);
            announce(`${label}’s project access saved.`);
            closePanel();
          }}
          onCancel={closePanel}
        />
      )}
      {rotated !== undefined && (
        <SecretPanel
          created={rotated}
          label={label}
          title="New credential — copy it now, it is not shown again"
          onDone={() => {
            forget();
            backToMenu();
          }}
        />
      )}
      {error !== undefined && (
        <p className="agents-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** *Last seen 2 min ago*, the exact time on hover and in its accessible name. */
function LastSeen({ at, now }: { readonly at: number | null; readonly now: number }) {
  if (at === null) return <span className="dv3-seen">Never seen</span>;
  const label = timeLabel(at, now);
  return (
    <span className="dv3-seen">
      Last seen{' '}
      <time dateTime={label.iso} title={label.full}>
        {label.text}
      </time>
    </span>
  );
}

const DEVICES_TITLE = 'dv3-devices-title';

function without(errors: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!errors.has(key)) return errors;
  const next = new Map(errors);
  next.delete(key);
  return next;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

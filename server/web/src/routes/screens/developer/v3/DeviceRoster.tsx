import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmAgentDevice, revokeAgentDevice } from '../../../../api/agent-devices.ts';
import { getAgent, type RegisteredAgent } from '../../../../api/agents.ts';
import { listDevices, type Device } from '../../../../api/devices.ts';
import { everyPage } from '../../../../api/every-page.ts';
import type { MeProfile } from '../../../../api/me.ts';
import { useGates } from '../../../../api/permissions.ts';
import { isTombstone, listProjects, type Project } from '../../../../api/projects.ts';
import { agentLabel, twinNames } from '../../../../api/selected-agent.ts';
import { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import { AddDeviceWizard } from './AddDeviceWizard.tsx';
import { AddToolWizard } from './AddToolWizard.tsx';
import { DeviceDetails } from './DeviceDetails.tsx';
import { DEVICES_TITLE, DevicesTab } from './DevicesTab.tsx';
import { ToolDetails } from './ToolDetails.tsx';
import { TOOLS_TITLE, ToolsTab } from './ToolsTab.tsx';
import { UpdatesProvider } from './ToolUpdate.tsx';
import {
  CLAIMS_LAPSE_MANY,
  deviceCounts,
  deviceLive,
  devicesSummary,
  findTool,
  runningSessions,
  withAgent,
  withConfirmed,
  withDevice,
  withRevokedAgents,
  type ListedTool,
} from './devices-view.ts';
import '../../tokens/tokens.css';
import '../agents.css';
import './devices-tab.css';

/** The two tabs this hosts: the devices, and the coding tools on them. */
export type RosterTab = 'devices' | 'tools';

export interface DeviceRosterProps {
  readonly tab: RosterTab;
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  /**
   * Preview mode: Project setup's new flow is `?setup=v3` on the Projects tab
   * (LAI-1052), so *Set up a project* carries it.
   */
  readonly preview?: boolean;
}

/** Every address parameter the two wizards read; closing one drops them all. */
const WIZARD_PARAMS = ['add', 'pairing', 'device', 'tool', 'exchange', 'reconnect'] as const;

/** Each tab's details panel, by the parameter that names what it shows. */
const PANEL_PARAM: Readonly<Record<RosterTab, string>> = { devices: 'device', tools: 'agent' };

/**
 * The history entry a details panel was opened on, from this page: closing it
 * then goes Back, so Back and × agree. One opened from a pasted link has no
 * mark, and closing it replaces the address instead — Back would leave.
 */
const PANEL_MARK = 'laikaDetails';

function panelMarked(key: string): boolean {
  const state: unknown = window.history.state;
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Readonly<Record<string, unknown>>)[PANEL_MARK] === key
  );
}

function present(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value;
}

/**
 * Developer access V3 → Devices and Tools (LAI-1054, LAI-1061, LAI-1065; two
 * tabs since LAI-1080, in the owner's design).
 *
 * **One read for both tabs**: `GET /devices` gives every device of the
 * reader's with its agents — an agent is one tool on one device — so Devices
 * lists the devices and Tools lists their agents, from the same answer, and
 * the two never disagree. Switching between them keeps it: this one component
 * hosts both, with what both share — the read, the projects a grant names,
 * each tool's verification (`UpdatesProvider`), the live region, and every
 * write with what it changes.
 *
 * - **A row is one line**, and opens a side panel addressed by the URL
 *   — `?tab=devices&device=<id>`, `?tab=tools&agent=<id>` — so a link can
 *   name it and Back closes it. Opening pushes; closing goes Back when this
 *   page opened it, and otherwise replaces.
 * - **Add device** is Devices' (`?add=device`: `&pairing=<id>` resumes one,
 *   `&device=<id>` pairs an imported one); **Add tool** is Tools' (`?add=tool`:
 *   `&device=`, `&tool=<slug>`, `&exchange=<id>` resumes, `&reconnect=<agent>`
 *   gives a tool a new credential on its own device). A hand-off from one to
 *   the other switches tab. The browser never holds a tool's secret in either.
 *
 * **Not shown, because no API gives it yet:** *Working on LAIKA-n*. An
 * agent's live claims are not served to its owner (`GET /agents/:id` lists
 * sessions, not claims), and a row never guesses one.
 */
export function DeviceRoster({
  tab,
  me,
  origin,
  params,
  setParams,
  preview = false,
}: DeviceRosterProps) {
  const gates = useGates(me !== undefined);
  const canManage = gates.org('agent.manage_own');
  const confirm = useConfirm();
  const add = params.get('add');
  const deviceWizard = tab === 'devices' && add === 'device';
  const toolWizard = tab === 'tools' && add === 'tool';
  const wizard = deviceWizard || toolWizard;
  const panelId = add === null ? present(params.get(PANEL_PARAM[tab])) : undefined;
  const panelKey = panelId === undefined ? undefined : `${tab}:${panelId}`;

  const [devices, setDevices] = useState<readonly Device[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [projects, setProjects] = useState<readonly Project[] | undefined>(undefined);
  const [projectsError, setProjectsError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showRevokedDevices, setShowRevokedDevices] = useState(false);
  const [showRevokedTools, setShowRevokedTools] = useState(false);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** The device whose disconnect is under way, from its first read to the answer (review round 1). */
  const [disconnecting, setDisconnecting] = useState<string | undefined>(undefined);
  const disconnectingRef = useRef<string | undefined>(undefined);
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

  // A panel named by the address for something *Show revoked* hides: show
  // the revoked too, so its row is there for focus to come back to. Once per
  // panel, as it opens — a tool revoked from its own panel leaves the list.
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (panelId === undefined) revealed.current = undefined;
    if (devices === undefined || panelId === undefined) return;
    if (revealed.current === `${tab}:${panelId}`) return;
    revealed.current = `${tab}:${panelId}`;
    if (tab === 'tools') {
      const found = findTool(devices, panelId);
      if (found !== undefined && (found.agent.status !== 'active' || !deviceLive(found.device))) {
        setShowRevokedTools(true);
      }
    } else {
      const device = devices.find((d) => d.id === panelId);
      if (device !== undefined && !deviceLive(device)) setShowRevokedDevices(true);
    }
  }, [devices, panelId, tab]);

  // ------------------------------------------------------------------ addresses

  /** Where Project setup is for one tool. */
  const projectHref = (agentId: string): string => {
    const next = new URLSearchParams({ tab: 'projects', tool: agentId });
    if (preview) next.set('setup', 'v3');
    return `/developer?${next.toString()}`;
  };

  const navigate = (href: string): void => {
    setParams(new URLSearchParams(href.slice(href.indexOf('?') + 1)), { push: true });
  };

  /** The address with the wizards' parameters replaced by `set`, on tab `to`. */
  const wizardParams = (
    to: RosterTab,
    set: Readonly<Record<string, string | undefined>>,
  ): URLSearchParams => {
    const next = new URLSearchParams(params);
    for (const key of WIZARD_PARAMS) {
      if (key in set) next.delete(key);
    }
    next.delete('agent');
    next.set('tab', to);
    for (const [key, value] of Object.entries(set)) {
      if (value !== undefined) next.set(key, value);
    }
    return next;
  };

  const openAdd = (what: 'device' | 'tool', extra: Readonly<Record<string, string>> = {}): void => {
    lastAdd.current = what;
    const to: RosterTab = what === 'device' ? 'devices' : 'tools';
    const next = wizardParams(to, {
      add: what,
      pairing: undefined,
      device: undefined,
      tool: undefined,
      exchange: undefined,
      reconnect: undefined,
      ...extra,
    });
    setParams(next, { push: true });
  };

  const closeWizard = (changed: boolean, extra: Readonly<Record<string, string>> = {}): void => {
    lastAdd.current ??= add === 'device' ? 'device' : 'tool';
    const next = new URLSearchParams(params);
    for (const key of WIZARD_PARAMS) next.delete(key);
    for (const [key, value] of Object.entries(extra)) next.set(key, value);
    setParams(next);
    if (changed) load();
  };

  const reconnect = (agent: RegisteredAgent): void => {
    openAdd('tool', { reconnect: agent.id });
  };

  // Focus goes back to the button that opened the wizard, once it is back.
  useEffect(() => {
    if (wizard || lastAdd.current === undefined) return;
    const back = lastAdd.current === 'device' ? addDeviceButton : addToolButton;
    lastAdd.current = undefined;
    (
      back.current ?? document.getElementById(tab === 'devices' ? DEVICES_TITLE : TOOLS_TITLE)
    )?.focus();
  }, [wizard, tab]);

  /** Open a details panel: a history entry, marked as this page's own. */
  const openDetails = (to: RosterTab, id: string): void => {
    const next = new URLSearchParams(params);
    for (const key of WIZARD_PARAMS) next.delete(key);
    next.delete('agent');
    next.set('tab', to);
    next.set(PANEL_PARAM[to], id);
    setParams(next, { push: true });
    window.history.replaceState({ [PANEL_MARK]: `${to}:${id}` }, '', window.location.href);
  };

  const closeDetails = (): void => {
    if (panelKey === undefined || panelId === undefined) return;
    // Closed already — by Back, or by × while a disconnect was still out.
    const here = new URLSearchParams(window.location.search);
    if (here.get('tab') !== tab || here.get(PANEL_PARAM[tab]) !== panelId) return;
    if (panelMarked(panelKey)) {
      window.history.back();
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(PANEL_PARAM[tab]);
    setParams(next);
  };

  /** Focus after a panel closes: its row, or the list's heading when the row went. */
  const restoreFor = (key: string) => (): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-details="${CSS.escape(key)}"]`) ??
    document.getElementById(key.startsWith('devices:') ? DEVICES_TITLE : TOOLS_TITLE);

  // ------------------------------------------------------------------ writes

  const put = (agent: RegisteredAgent): void => {
    setDevices((current) => (current === undefined ? current : withAgent(current, agent)));
    setNow(Date.now());
  };

  /** A device renamed (LAI-1095): the server's answer, its tools relabelled, replaces it. */
  const renamed = (device: Device): void => {
    setDevices((current) => (current === undefined ? current : withDevice(current, device)));
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

  const disconnectDevice = (device: Device): void => {
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
            setDevices((current) =>
              current === undefined
                ? current
                : withRevokedAgents(current, revoked_agent_ids, Date.now()),
            );
            announce(
              `${device.display_name} disconnected: ${String(revoked_agent_ids.length)} ${revoked_agent_ids.length === 1 ? 'tool' : 'tools'} revoked.`,
            );
            closeDetails();
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

  // ------------------------------------------------------------------ what shows

  const counts = devices === undefined ? undefined : deviceCounts(devices);
  // Every active tool on an active device: its verification is read once, for
  // its readiness on Tools and its helper's update status (LAI-1065).
  const updateIds =
    devices === undefined
      ? []
      : devices
          .filter((device) => device.status === 'active')
          .flatMap((device) => device.agents.filter((agent) => agent.status === 'active'))
          .map((agent) => agent.id);
  const readOnly = !canManage && gates.settled;
  const panelDevice =
    tab === 'devices' && panelId !== undefined && devices !== undefined
      ? { device: devices.find((d) => d.id === panelId) }
      : undefined;
  const panelTool: { readonly listed: ListedTool | undefined } | undefined =
    tab === 'tools' && panelId !== undefined && devices !== undefined
      ? { listed: findTool(devices, panelId) }
      : undefined;

  const lists = (
    <>
      {tab === 'devices' ? (
        <DevicesTab
          devices={devices}
          counts={counts}
          error={error}
          onRetry={() => {
            setError(null);
            load();
          }}
          now={now}
          canManage={canManage}
          readOnly={readOnly}
          wizard={wizard}
          orgRole={me?.org_role}
          updateIds={updateIds}
          showRevoked={showRevokedDevices}
          onToggleRevoked={() => {
            setShowRevokedDevices((on) => !on);
          }}
          addButton={addDeviceButton}
          onAddDevice={() => {
            openAdd('device');
          }}
          onAddTool={(deviceId) => {
            openAdd('tool', { device: deviceId });
          }}
          onDetails={(deviceId) => {
            openDetails('devices', deviceId);
          }}
        />
      ) : (
        <ToolsTab
          devices={devices}
          counts={counts}
          error={error}
          onRetry={() => {
            setError(null);
            load();
          }}
          now={now}
          canManage={canManage}
          readOnly={readOnly}
          wizard={wizard}
          showRevoked={showRevokedTools}
          onToggleRevoked={() => {
            setShowRevokedTools((on) => !on);
          }}
          addButton={addToolButton}
          onAddTool={() => {
            openAdd('tool');
          }}
          onAddDevice={() => {
            openAdd('device');
          }}
          onDetails={(agentId) => {
            openDetails('tools', agentId);
          }}
          onFinish={(listed) => {
            reconnect(listed.agent);
          }}
          projectHref={projectHref}
          onNavigate={navigate}
        />
      )}
      {panelDevice !== undefined && panelKey !== undefined && (
        <DeviceDetails
          key={panelKey}
          device={panelDevice.device}
          now={now}
          canManage={canManage}
          confirming={confirming === panelId}
          disconnecting={disconnecting === panelId}
          error={panelId === undefined ? undefined : deviceErrors.get(panelId)}
          onRecognise={() => {
            if (panelDevice.device !== undefined) recognise(panelDevice.device);
          }}
          onDisconnect={() => {
            if (panelDevice.device !== undefined) disconnectDevice(panelDevice.device);
          }}
          onOpenTool={(agentId) => {
            openDetails('tools', agentId);
          }}
          onAddTool={() => {
            if (panelId !== undefined) openAdd('tool', { device: panelId });
          }}
          onChanged={put}
          onRenamed={renamed}
          announce={announce}
          onClose={closeDetails}
          restore={restoreFor(panelKey)}
        />
      )}
      {panelTool !== undefined && panelKey !== undefined && (
        <ToolDetails
          key={panelKey}
          listed={panelTool.listed}
          now={now}
          me={me}
          canManage={canManage}
          projects={projects}
          projectsError={projectsError}
          onRetryProjects={() => {
            loadProjects();
          }}
          projectHref={projectHref(panelId ?? '')}
          onNavigate={navigate}
          onChanged={put}
          onReconnect={reconnect}
          onDisconnected={closeDetails}
          announce={announce}
          confirm={confirm}
          onClose={closeDetails}
          restore={restoreFor(panelKey)}
        />
      )}
    </>
  );

  return (
    <div className="dx dv3-roster" data-roster={tab}>
      <LiveRegion message={message} />
      {deviceWizard && (
        <AddDeviceWizard
          key="device"
          devices={devices}
          resumeId={params.get('pairing') ?? undefined}
          initialDeviceId={params.get('device') ?? undefined}
          onRequest={(id) => {
            setParams(wizardParams('devices', { pairing: id }));
          }}
          onAddTool={(deviceId) => {
            lastAdd.current = 'tool';
            setParams(
              wizardParams('tools', {
                add: 'tool',
                device: deviceId,
                pairing: undefined,
                tool: undefined,
              }),
            );
            load();
          }}
          onClose={closeWizard}
        />
      )}
      {toolWizard && (
        <AddToolWizard
          key={`tool-${params.get('reconnect') ?? ''}`}
          devices={devices}
          canManage={canManage}
          initialDeviceId={params.get('device') ?? undefined}
          initialTool={params.get('tool') ?? undefined}
          reconnectId={params.get('reconnect') ?? undefined}
          resumeExchange={params.get('exchange') ?? undefined}
          onExchange={(id) => {
            setParams(wizardParams('tools', { exchange: id }));
          }}
          onAddDevice={(deviceId, tool) => {
            lastAdd.current = 'device';
            setParams(
              wizardParams('devices', {
                add: 'device',
                device: deviceId,
                tool,
                exchange: undefined,
                reconnect: undefined,
              }),
            );
          }}
          onResolveConflict={(agentId) => {
            closeWizard(false, { agent: agentId });
          }}
          onOpenAdvanced={() => {
            setParams(new URLSearchParams({ tab: 'advanced' }), { push: true });
          }}
          onSetUpProject={(agentId) => {
            navigate(projectHref(agentId));
          }}
          onOpenDetails={(agentId) => {
            closeWizard(true, { agent: agentId });
            // Focus goes into the panel that opens, not back to + Add tool.
            lastAdd.current = undefined;
          }}
          onClose={closeWizard}
        />
      )}
      {/* An open wizard stands in place of its list, as the owner's design
          draws it (LAI-1081); its *Back to …* and *Cancel* bring the list back.
          The provider stays mounted under it, so a wizard opened and closed
          asks nothing of the board again (review round 1). */}
      {devices === undefined ? (
        wizard ? null : (
          lists
        )
      ) : (
        <UpdatesProvider agentIds={updateIds} origin={origin} announce={announce}>
          {wizard ? null : lists}
        </UpdatesProvider>
      )}
    </div>
  );
}

function without(errors: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!errors.has(key)) return errors;
  const next = new Map(errors);
  next.delete(key);
  return next;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

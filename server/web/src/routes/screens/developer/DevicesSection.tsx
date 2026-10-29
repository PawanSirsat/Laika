import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import {
  confirmAgentDevice,
  deviceKey,
  listAgentDevices,
  revokeAgentDevice,
  revokedOnly,
  revokeTargets,
  withRecognised,
  withRevoked,
  type AgentDevice,
} from '../../../api/agent-devices.ts';
import { AGENT_STATE_LABELS, agentHarness, agentState } from '../../../api/agents.ts';
import { agentLabel } from '../../../api/selected-agent.ts';
import { timeLabel } from '../../../api/time-label.ts';
import './devices.css';

export interface DevicesSectionProps {
  /** §3.1 `agent.manage_own`, as the server reports it: confirm and revoke need it. */
  readonly canManage: boolean;
  /**
   * Bumped by the Agents tab after it changed an agent itself — a register,
   * rename or revoke there moves a device too, so the list is read again.
   */
  readonly generation: number;
  /** Told after a device was revoked here, so the tab's own list catches up. */
  readonly onRevoked: () => void;
}

/**
 * Developer access → Agents → *Your devices* (LAI-591; API by LAI-590).
 *
 * The reader's agents grouped by the device they run on, answering *what is
 * running on which machine, and is any of it not mine?* Every name, count and
 * time here is `GET /agents/devices`'s; nothing is filled in.
 *
 * - **Not recognised** is a word, never only a colour, and *This is mine*
 *   clears it only after the server confirmed.
 * - **Revoke device** asks first, naming every agent it will end, and keeps
 *   its question open with the server's refusal when the call fails — so a
 *   failure changes nothing on screen.
 * - A device with nothing left running collapses to one muted row.
 */
export function DevicesSection({ canManage, generation, onRevoked }: DevicesSectionProps) {
  const [devices, setDevices] = useState<readonly AgentDevice[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState<AgentDevice | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [rowError, setRowError] = useState<{ key: string; text: string } | undefined>(undefined);
  /** A device whose revoke button went away with the revoke: its heading takes focus. */
  const [refocus, setRefocus] = useState<string | undefined>(undefined);
  const headings = useRef(new Map<string, HTMLElement>());
  // An older read never overwrites a newer one, nor a write made since it began.
  const readGen = useRef(0);

  const reload = useCallback((signal?: AbortSignal): void => {
    readGen.current += 1;
    const gen = readGen.current;
    listAgentDevices(signal)
      .then(({ data }) => {
        if (gen !== readGen.current) return;
        setDevices(data);
        setLoadError(null);
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (gen !== readGen.current) return;
        setLoadError(cause);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reload, generation]);

  useEffect(() => {
    if (refocus === undefined || asking !== undefined) return;
    setRefocus(undefined);
    headings.current.get(refocus)?.focus();
  }, [refocus, asking, devices]);

  const recognise = (device: AgentDevice): void => {
    const key = deviceKey(device);
    setConfirming(key);
    setRowError(undefined);
    confirmAgentDevice(device.device_label)
      .then(() => {
        // A write invalidates any read still in flight, which predates it.
        readGen.current += 1;
        setDevices((current) =>
          current === undefined ? current : withRecognised(current, device.device_label),
        );
      })
      .catch((cause: unknown) => {
        setRowError({ key, text: errorText(cause, 'Could not confirm that device.') });
      })
      .finally(() => {
        setConfirming(undefined);
      });
  };

  const revoke = (device: AgentDevice): void => {
    setBusy(true);
    setRevokeError(undefined);
    revokeAgentDevice(device.device_label)
      .then(({ revoked_agent_ids }) => {
        readGen.current += 1;
        setDevices((current) =>
          current === undefined ? current : withRevoked(current, revoked_agent_ids, Date.now()),
        );
        setNow(Date.now());
        setAsking(undefined);
        setRefocus(deviceKey(device));
        onRevoked();
      })
      .catch((cause: unknown) => {
        setRevokeError(errorText(cause, 'Could not revoke that device. Nothing was changed.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section
      className="devices"
      aria-labelledby="devices-title"
      data-testid="devices-section"
      data-loaded={devices !== undefined}
    >
      <div className="devices-head">
        <h3 className="devices-title" id="devices-title">
          Your devices
        </h3>
        {devices !== undefined && devices.length > 0 && (
          <span className="conn-chip conn-chip-scope">
            {devices.length} {devices.length === 1 ? 'device' : 'devices'}
          </span>
        )}
      </div>
      <p className="devices-intro">
        Your agents, grouped by the device each one says it runs on. The name is what the agent
        reported; <em>Not recognised</em> means you have not yet said a device is yours.
      </p>

      {loadError !== null ? (
        <ApiErrorState
          error={loadError}
          resource="your devices"
          scope="organisation"
          onRetry={() => {
            setLoadError(null);
            reload();
          }}
        />
      ) : devices === undefined ? (
        <LoadingState shape="row" count={2} label="Loading your devices" />
      ) : devices.length === 0 ? (
        <EmptyState
          headline="No devices yet"
          body="A device appears here once you register an agent on it."
        />
      ) : (
        <ul className="devices-list" aria-labelledby="devices-title">
          {devices.map((device) => {
            const key = deviceKey(device);
            return (
              <DeviceGroup
                key={key}
                device={device}
                now={now}
                canManage={canManage}
                confirming={confirming === key}
                error={rowError?.key === key ? rowError.text : undefined}
                headingRef={(el) => {
                  if (el === null) headings.current.delete(key);
                  else headings.current.set(key, el);
                }}
                onRecognise={() => {
                  recognise(device);
                }}
                onRevoke={() => {
                  setRevokeError(undefined);
                  setAsking(device);
                }}
              />
            );
          })}
        </ul>
      )}

      {asking !== undefined && (
        <RevokeDeviceDialog
          device={asking}
          busy={busy}
          error={revokeError}
          onConfirm={() => {
            revoke(asking);
          }}
          onClose={() => {
            setAsking(undefined);
            setRevokeError(undefined);
          }}
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ one device

interface DeviceGroupProps {
  readonly device: AgentDevice;
  readonly now: number;
  readonly canManage: boolean;
  readonly confirming: boolean;
  readonly error: string | undefined;
  readonly headingRef: (el: HTMLElement | null) => void;
  readonly onRecognise: () => void;
  readonly onRevoke: () => void;
}

function DeviceGroup({
  device,
  now,
  canManage,
  confirming,
  error,
  headingRef,
  onRecognise,
  onRevoke,
}: DeviceGroupProps) {
  const muted = revokedOnly(device);
  const head = (
    <div className="devices-group-head">
      <span className="devices-name" ref={headingRef} tabIndex={-1}>
        {device.display_name}
      </span>
      {!device.recognised && (
        <span className="devices-unrecognised" data-unrecognised>
          Not recognised
        </span>
      )}
      <span className="devices-facts">
        <LastSeen at={device.last_seen_at} now={now} />
        <span>
          {device.active_count} active
          {device.revoked_count > 0 && ` · ${String(device.revoked_count)} revoked`}
        </span>
      </span>
    </div>
  );

  const agents = (
    <ul className="devices-agents" aria-label={`Agents on ${device.display_name}`}>
      {device.agents.map((agent) => {
        const state = agentState(agent, now);
        return (
          <li key={agent.id} className="devices-agent" data-agent={agent.id} data-state={state}>
            <AgentMark client={agentHarness(agent)} />
            <span className="devices-agent-name">{agentLabel(agent)}</span>
            <span className="agents-state" data-state={state}>
              {AGENT_STATE_LABELS[state]}
            </span>
          </li>
        );
      })}
    </ul>
  );

  const actions = canManage && (!device.recognised || !muted) && (
    <div className="devices-actions">
      {!device.recognised && (
        <button
          type="button"
          className="bar-control"
          disabled={confirming}
          aria-busy={confirming}
          aria-label={`This is mine: ${device.display_name}`}
          onClick={onRecognise}
        >
          {confirming && <Spinner size="sm" />}
          This is mine
        </button>
      )}
      {!muted && (
        <button
          type="button"
          className="bar-control agents-danger"
          aria-label={`Revoke device: ${device.display_name}`}
          onClick={onRevoke}
        >
          Revoke device
        </button>
      )}
    </div>
  );

  return (
    <li
      className={muted ? 'devices-group devices-group-muted' : 'devices-group'}
      data-device={deviceKey(device)}
      data-recognised={device.recognised}
    >
      {muted ? (
        <details className="devices-collapsed">
          <summary>{head}</summary>
          {agents}
        </details>
      ) : (
        <>
          {head}
          {agents}
        </>
      )}
      {actions}
      {error !== undefined && (
        <p className="agents-error devices-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * *Last seen 2 min ago*, with the exact time on hover **and** on keyboard
 * focus: a `title` alone shows only to a mouse, so the time takes focus and
 * shows the same words beside it while it has it.
 */
function LastSeen({ at, now }: { readonly at: number | null; readonly now: number }) {
  if (at === null) return <span>Never seen</span>;
  const label = timeLabel(at, now);
  return (
    <span className="devices-seen">
      Last seen{' '}
      <time
        dateTime={label.iso}
        title={label.full}
        tabIndex={0}
        aria-label={`${label.text}, ${label.full}`}
        className="devices-seen-time"
      >
        {label.text}
      </time>
      <span className="devices-seen-exact" aria-hidden="true">
        {label.full}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ the question

function RevokeDeviceDialog({
  device,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  readonly device: AgentDevice;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  const targets = revokeTargets(device);
  const count = targets.length;
  return (
    <ConfirmDialog
      title={`Revoke every agent on ${device.display_name}?`}
      confirmLabel={`Revoke ${String(count)} ${count === 1 ? 'agent' : 'agents'}`}
      danger
      icon="warning"
      busy={busy}
      error={error}
      detail={
        <ul className="devices-dialog-list" data-revoke-targets>
          {targets.map((agent) => (
            <li key={agent.id}>{agentLabel(agent)}</li>
          ))}
        </ul>
      }
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {count === 1 ? 'This agent stops' : `These ${String(count)} agents stop`} at once: every token
      they hold stops working and their running sessions end. They cannot be restored. Agents on
      other devices and your own tokens are not touched.
    </ConfirmDialog>
  );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

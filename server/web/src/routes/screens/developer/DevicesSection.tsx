import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  harnessRows,
  withRevoked,
  type AgentDevice,
} from '../../../api/agent-devices.ts';
import {
  AGENT_STATE_LABELS,
  agentAnchor,
  agentHarness,
  agentState,
  type RegisteredAgent,
} from '../../../api/agents.ts';
import { agentLabel, twinNames } from '../../../api/selected-agent.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { goToAgent } from './go-to-agent.ts';
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
 * - **One row per harness** under each device (D-120). Two active agents of
 *   one harness on one device are a legacy duplicate: flagged in words, told
 *   apart by LAI-583's marks, each linked to its row to revoke one.
 */
export function DevicesSection({ canManage, generation, onRevoked }: DevicesSectionProps) {
  const [devices, setDevices] = useState<readonly AgentDevice[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState<AgentDevice | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);
  /** Devices with a *This is mine* in flight, each its own: one answer never clears another. */
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** A device whose revoke button went away with the revoke: its heading takes focus. */
  const [refocus, setRefocus] = useState<string | undefined>(undefined);
  const headings = useRef(new Map<string, HTMLElement>());
  /**
   * **The newest read wins** (LAI-591 review round 1). Every read is numbered
   * and only the latest one asked may land; an older answer is dropped. Every
   * write here starts a fresh read once it answers — a write invalidates the
   * shared GET cache, so that read is a new request, never one already in
   * flight — and the Agents tab's own writes start one through `generation`.
   * So whatever lands last was asked after the last change the screen knows
   * of. (Dropping a read without asking again is the defect this replaced: a
   * confirm that answered mid-refresh left the list from before a revoke.)
   */
  const readGen = useRef(0);
  /**
   * Reads settled, applied or dropped — on the section as
   * `data-reads-settled`, so a test waits for a late answer to have been
   * *handled* rather than for a fixed time (the Agents tab's instrument).
   */
  const [readsSettled, setReadsSettled] = useState(0);

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
      })
      .finally(() => {
        setReadsSettled((n) => n + 1);
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
    setConfirming((current) => new Set(current).add(key));
    setRowErrors((current) => without(current, key));
    confirmAgentDevice(device.device_label)
      .then(() => {
        setDevices((current) =>
          current === undefined ? current : withRecognised(current, device.device_label),
        );
        reload();
      })
      .catch((cause: unknown) => {
        setRowErrors((current) =>
          new Map(current).set(key, errorText(cause, 'Could not confirm that device.')),
        );
      })
      .finally(() => {
        setConfirming((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  };

  const revoke = (device: AgentDevice): void => {
    setBusy(true);
    setRevokeError(undefined);
    revokeAgentDevice(device.device_label)
      .then(({ revoked_agent_ids }) => {
        setDevices((current) =>
          current === undefined ? current : withRevoked(current, revoked_agent_ids, Date.now()),
        );
        reload();
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
      data-reads-settled={readsSettled}
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
                confirming={confirming.has(key)}
                error={rowErrors.get(key)}
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

  // One row per harness (D-120). A harness with one agent is that agent's
  // row; one with more lists them under it, told apart by LAI-583's marks —
  // which only a legacy duplicate or a revoked predecessor still needs.
  const twins = twinNames(device.agents);
  const nameOf = (agent: RegisteredAgent): string => {
    const twin = twins.get(agent.id);
    return twin === undefined ? agentLabel(agent) : `${agentLabel(agent)} (${twin})`;
  };
  const agentLine = (agent: RegisteredAgent, duplicate: boolean) => {
    const state = agentState(agent, now);
    return (
      <>
        <AgentMark client={agentHarness(agent)} />
        <span className="devices-agent-name">{nameOf(agent)}</span>
        <span className="agents-state" data-state={state}>
          {AGENT_STATE_LABELS[state]}
        </span>
        {duplicate && agent.status === 'active' && (
          <a
            className="devices-agent-link"
            href={`#${agentAnchor(agent.id)}`}
            onClick={(event) => {
              if (goToAgent(agent.id)) event.preventDefault();
            }}
          >
            Go to it<span className="visually-hidden">: {nameOf(agent)}</span>
          </a>
        )}
      </>
    );
  };
  const agents = (
    <ul className="devices-agents" aria-label={`Agents on ${device.display_name}`}>
      {harnessRows(device).map((row) => {
        const [only] = row.agents;
        if (row.agents.length === 1 && only !== undefined) {
          const state = agentState(only, now);
          return (
            <li
              key={row.harness}
              className="devices-harness devices-agent"
              data-harness={row.harness}
              data-agent={only.id}
              data-state={state}
            >
              {agentLine(only, false)}
            </li>
          );
        }
        const first = row.agents[0];
        return (
          <li
            key={row.harness}
            className="devices-harness"
            data-harness={row.harness}
            data-duplicate={row.duplicate || undefined}
          >
            <div className="devices-harness-head">
              <span className="devices-harness-name">
                {first === undefined ? '' : agentLabel(first)}
              </span>
              {row.duplicate ? (
                <span className="devices-duplicate" data-duplicate-flag>
                  Duplicate: {row.active} active
                </span>
              ) : (
                <span className="devices-harness-count">
                  {row.agents.length} {row.agents.length === 1 ? 'agent' : 'agents'}
                </span>
              )}
            </div>
            {row.duplicate && (
              <p className="devices-duplicate-note">
                Registered before one agent per harness per device. Both keep working; revoke the
                one you do not want.
              </p>
            )}
            <ul className="devices-harness-agents">
              {row.agents.map((agent) => (
                <li
                  key={agent.id}
                  className="devices-agent"
                  data-agent={agent.id}
                  data-state={agentState(agent, now)}
                >
                  {agentLine(agent, row.duplicate)}
                </li>
              ))}
            </ul>
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
  const twins = twinNames(device.agents);
  const count = targets.length;
  /**
   * **Focus never leaves a pending revoke** (review round 1, APG modal
   * dialog). While the call is out the dialog disables both its buttons, which
   * drops focus out of the modal — Tab then reached the page behind it, and
   * after a failure Escape did nothing because nothing inside had focus. So
   * while busy this status line takes focus and is the dialog's one Tab stop;
   * when a failure ends the wait, focus goes to Cancel, from which Escape or
   * Cancel closes the dialog and the dialog returns focus to *Revoke device*.
   */
  const holder = useRef<HTMLParagraphElement | null>(null);
  const wasBusy = useRef(false);
  useLayoutEffect(() => {
    if (busy) {
      holder.current?.focus();
    } else if (wasBusy.current) {
      holder.current
        ?.closest('[data-confirm-dialog]')
        ?.querySelector<HTMLElement>('[data-confirm-cancel] button')
        ?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);
  return (
    <ConfirmDialog
      title={`Revoke every agent on ${device.display_name}?`}
      confirmLabel={`Revoke ${String(count)} ${count === 1 ? 'agent' : 'agents'}`}
      danger
      icon="warning"
      busy={busy}
      error={error}
      detail={
        <>
          <ul className="devices-dialog-list" data-revoke-targets>
            {targets.map((agent) => {
              const twin = twins.get(agent.id);
              return (
                <li key={agent.id}>
                  {twin === undefined ? agentLabel(agent) : `${agentLabel(agent)} (${twin})`}
                </li>
              );
            })}
          </ul>
          <p
            ref={holder}
            className="devices-dialog-pending"
            role="status"
            tabIndex={busy ? 0 : -1}
            data-revoke-pending
          >
            {busy && (
              <>
                <Spinner size="sm" />
                Revoking {count === 1 ? 'this agent' : `these ${String(count)} agents`}
              </>
            )}
          </p>
        </>
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

function without(errors: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!errors.has(key)) return errors;
  const next = new Map(errors);
  next.delete(key);
  return next;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

import { useState } from 'react';
import { agentHarness, type RegisteredAgent } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { SidePanel } from '../../../../components/SidePanel.tsx';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { RenameForm } from '../AgentsTab.tsx';
import { DesignChip } from './DesignChip.tsx';
import { DetailTiles } from './DetailTiles.tsx';
import { pairedDevice } from './add-flow.ts';
import {
  CLOUD_NOTE,
  chipTone,
  deviceChip,
  deviceTools,
  kindName,
  listedStatus,
  needsConfirm,
  toolLabel,
  type Conflict,
} from './devices-view.ts';
import { DeviceUpdate, useVerification } from './ToolUpdate.tsx';

export const DEVICE_PANEL_TITLE = 'dv3-device-panel-title';

export interface DeviceDetailsProps {
  /** `undefined` once the list is in and holds no such device. */
  readonly device: Device | undefined;
  readonly now: number;
  readonly canManage: boolean;
  readonly confirming: boolean;
  /** Its disconnect is under way: the button says so and does nothing. */
  readonly disconnecting: boolean;
  readonly error: string | undefined;
  readonly onRecognise: () => void;
  readonly onDisconnect: () => void;
  /** One of its tools: that tool's details, on Tools. */
  readonly onOpenTool: (agentId: string) => void;
  /** *Add a tool* on a paired device with no active tool: the tool wizard on it. */
  readonly onAddTool: () => void;
  readonly onChanged: (agent: RegisteredAgent) => void;
  readonly announce: (message: string) => void;
  readonly onClose: () => void;
  readonly restore: () => HTMLElement | null | undefined;
}

/**
 * A device's details (LAI-1080), at `?tab=devices&device=<id>`: what its
 * one-line row on Devices has no room for — and what the device card said
 * before (LAI-1054, LAI-1065), moved here unchanged.
 *
 * - Its kind, how it got here, when it was last seen, and its key's
 *   fingerprint; a Cloud runner's one-day note.
 * - Its tools' helper updates, summarised, worst first.
 * - An imported device nobody claimed asks *confirm it's yours*, through the
 *   same `POST /agents/devices/confirm` as before.
 * - Its tools, each opening that tool's details; revoked ones after them.
 * - Two active agents of one tool on it — from before one per pair — under
 *   *Needs your attention*, both intact, each with *Rename*.
 * - **Disconnect device…** at the foot: every tool on it, behind a
 *   confirmation naming each.
 */
export function DeviceDetails({
  device,
  now,
  canManage,
  confirming,
  disconnecting,
  error,
  onRecognise,
  onDisconnect,
  onOpenTool,
  onAddTool,
  onChanged,
  announce,
  onClose,
  restore,
}: DeviceDetailsProps) {
  const [renaming, setRenaming] = useState<string | undefined>(undefined);

  if (device === undefined) {
    return (
      <SidePanel
        title="Device not found"
        titleId={DEVICE_PANEL_TITLE}
        onClose={onClose}
        restore={restore}
        panel="device"
      >
        <p className="dv3-none">
          No device of yours has this address. It may have been removed, or the link is not yours.
        </p>
      </SidePanel>
    );
  }

  const { tools, conflicts, revoked } = deviceTools(device);
  const live = device.status === 'active';
  const cloud = device.kind === 'cloud';
  const chip = deviceChip(device);
  const activeIds = [...tools, ...conflicts.flatMap((c) => c.agents)].map((a) => a.id);
  const conflictCount = conflicts.length;
  const seen = device.last_seen_at === null ? undefined : timeLabel(device.last_seen_at, now);

  const toolButton = (agent: RegisteredAgent) => (
    <PanelTool key={agent.id} device={device} agent={agent} now={now} onOpen={onOpenTool} />
  );

  return (
    <SidePanel
      title={device.display_name}
      titleId={DEVICE_PANEL_TITLE}
      subtitle={
        <>
          <DesignChip tone={chip.tone}>{chip.word}</DesignChip>
          <span>{kindName(device)}</span>
        </>
      }
      onClose={onClose}
      restore={restore}
      panel="device"
      footer={
        canManage && live ? (
          <button
            type="button"
            className="dx-btn dx-btn-sm dv3-danger"
            aria-disabled={device.active_count === 0 || disconnecting || undefined}
            onClick={() => {
              if (device.active_count === 0 || disconnecting) return;
              onDisconnect();
            }}
          >
            Disconnect device…
          </button>
        ) : undefined
      }
    >
      <div
        className="dv3-device-details"
        data-device={device.id}
        data-kind={device.kind}
        data-origin={device.origin}
        data-status={device.status}
        data-confirmed={device.confirmed}
      >
        <section className="side-panel-section" aria-labelledby="dv3-device-facts">
          <h3 className="side-panel-label" id="dv3-device-facts">
            Device
          </h3>
          <DetailTiles
            items={[
              { label: 'Kind', value: kindName(device), id: 'kind' },
              {
                label: 'Origin',
                value: device.origin === 'paired' ? 'Paired' : 'Imported',
                id: 'origin',
              },
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
              ...(device.key_fingerprint === null
                ? []
                : [
                    {
                      label: 'Key fingerprint',
                      value: <code>{device.key_fingerprint}</code>,
                      id: 'fingerprint',
                    },
                  ]),
            ]}
          />
          {cloud && live && <p className="dv3-note">{CLOUD_NOTE}</p>}
          {live && <DeviceUpdate agentIds={activeIds} />}
        </section>

        {needsConfirm(device) && (
          <section className="side-panel-section">
            <div className="dv3-imported" role="note" data-imported>
              <p>
                <strong>Imported device — confirm it’s yours.</strong> Laika made this device from
                the name your tools reported when they were registered. Confirm it if you recognise
                it; disconnect it if you do not.
              </p>
              {canManage && (
                <button
                  type="button"
                  className="dx-btn dx-btn-sm"
                  disabled={confirming}
                  aria-busy={confirming}
                  aria-label={`Confirm ${device.display_name} is yours`}
                  onClick={onRecognise}
                >
                  Confirm it’s mine
                </button>
              )}
            </div>
          </section>
        )}

        <section className="side-panel-section" aria-labelledby="dv3-device-tools">
          <h3 className="side-panel-label" id="dv3-device-tools">
            Tools
          </h3>
          {tools.length > 0 && (
            <ul className="dv3-panel-tools" aria-label={`Tools on ${device.display_name}`}>
              {tools.map(toolButton)}
            </ul>
          )}
          {tools.length === 0 && conflictCount === 0 && (
            <p className="dv3-none">
              {live ? 'No tools yet' : 'None active'}
              {live && canManage && pairedDevice(device) && (
                <>
                  {' — '}
                  <button type="button" className="conn-link-button" onClick={onAddTool}>
                    Add a tool
                  </button>
                </>
              )}
            </p>
          )}
          {revoked.length > 0 && (
            <>
              <h4 className="dv3-panel-sub">Revoked</h4>
              <ul
                className="dv3-panel-tools"
                aria-label={`Revoked tools on ${device.display_name}`}
              >
                {revoked.map(toolButton)}
              </ul>
            </>
          )}
        </section>

        {conflictCount > 0 && (
          <section
            className="side-panel-section"
            aria-labelledby="dv3-device-conflicts"
            data-conflicts
          >
            <h3 className="dv3-panel-sub dv3-attention" id="dv3-device-conflicts">
              Needs your attention: {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
            </h3>
            <p className="dv3-note">
              These were registered before one agent per tool per device. Each keeps working and
              nothing here revokes either: disconnect the one you do not want, or rename them to
              tell them apart.
            </p>
            {conflicts.map((conflict: Conflict) => (
              <div key={conflict.harness} className="dv3-conflict" data-conflict={conflict.harness}>
                <h4 className="dv3-panel-sub">
                  {conflict.label}: {conflict.agents.length} active
                </h4>
                <ul
                  className="dv3-panel-tools"
                  aria-label={`${conflict.label}, ${String(conflict.agents.length)} active`}
                >
                  {conflict.agents.map((agent) => (
                    <li key={agent.id} className="dv3-panel-conflict" data-agent={agent.id}>
                      {renaming === agent.id ? (
                        <RenameForm
                          agent={agent}
                          onSaved={(next) => {
                            onChanged(next);
                            announce(`Renamed to ${next.display_name}.`);
                            setRenaming(undefined);
                          }}
                          onCancel={() => {
                            setRenaming(undefined);
                          }}
                        />
                      ) : (
                        <div className="dv3-panel-conflict-row">
                          <AgentMark client={agentHarness(agent)} size="sm" />
                          <span className="dv3-panel-tool-name">{toolLabel(device, agent)}</span>
                          <span className="dx-actions">
                            {canManage && (
                              <button
                                type="button"
                                className="dx-btn dx-btn-sm"
                                aria-label={`Rename ${toolLabel(device, agent)}`}
                                onClick={() => {
                                  setRenaming(agent.id);
                                }}
                              >
                                Rename…
                              </button>
                            )}
                            <button
                              type="button"
                              className="dx-btn dx-btn-sm dx-btn-ghost"
                              data-details={`tools:${agent.id}`}
                              aria-label={`${toolLabel(device, agent)}: details`}
                              onClick={() => {
                                onOpenTool(agent.id);
                              }}
                            >
                              Details
                            </button>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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

/** One of the device's tools: its status in a word, and its details a click away. */
function PanelTool({
  device,
  agent,
  now,
  onOpen,
}: {
  readonly device: Device;
  readonly agent: RegisteredAgent;
  readonly now: number;
  readonly onOpen: (agentId: string) => void;
}) {
  const label = toolLabel(device, agent);
  const status = listedStatus(agent, useVerification(agent.id), now);
  return (
    <li className="dv3-panel-tool" data-agent={agent.id}>
      <button
        type="button"
        className="dv3-panel-tool-button"
        data-details={`tools:${agent.id}`}
        aria-label={`${label}: ${status.word}. Details`}
        onClick={() => {
          onOpen(agent.id);
        }}
      >
        <AgentMark client={agentHarness(agent)} size="sm" />
        <span className="dv3-panel-tool-name">{label}</span>
        <DesignChip tone={chipTone(status.tone)}>{status.word}</DesignChip>
        <span className="dv3-panel-tool-go" aria-hidden="true">
          →
        </span>
      </button>
    </li>
  );
}

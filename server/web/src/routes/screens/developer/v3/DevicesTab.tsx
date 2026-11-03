import type { Ref } from 'react';
import type { Device } from '../../../../api/devices.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { DxIcon } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import { pairedDevice } from './add-flow.ts';
import {
  conflictsToReview,
  deviceChip,
  deviceLine,
  deviceLive,
  everyDeviceRevoked,
  needsConfirm,
  revokedDevice,
  type DeviceCounts,
} from './devices-view.ts';
import { HintChip, StatusLegendLink } from './StatusLegend.tsx';
import { BoardUpdateNote, DeviceVersionChip, useUpdateStatus } from './ToolUpdate.tsx';
import { RowChevron, RowOpen } from './ToolsTab.tsx';
import { deviceChipDescription, deviceChipKey, rowShowsUpdate } from './status-vocabulary.ts';

export const DEVICES_TITLE = 'dv3-devices-title';

export interface DevicesTabProps {
  readonly devices: readonly Device[] | undefined;
  readonly counts: DeviceCounts | undefined;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly now: number;
  readonly canManage: boolean;
  /** The gates answered and this session may not change devices: said once, above the list. */
  readonly readOnly: boolean;
  /** A wizard is open above the list: its *Add* buttons step aside. */
  readonly wizard: boolean;
  readonly orgRole: string | undefined;
  /** Active tools on the listed devices, for the board-update note. */
  readonly updateIds: readonly string[];
  readonly showRevoked: boolean;
  readonly onToggleRevoked: () => void;
  readonly addButton: Ref<HTMLButtonElement>;
  readonly onAddDevice: () => void;
  readonly onAddTool: (deviceId: string) => void;
  readonly onDetails: (deviceId: string) => void;
}

/**
 * Developer access V3 → Devices (LAI-1054; one line a device since LAI-1080,
 * in the owner's design). **A device is the computer**: paired once, then its
 * coding tools are added on Tools. Each row says its kind, how many tools it
 * holds and when it was last seen, a chip for how it got here — *Paired*,
 * *Imported — confirm it's yours*, *Revoked* — a helper chip only when one of
 * its tools has something to do, and *Add tool →* on a paired one. **The row
 * itself opens its details panel** (LAI-1097), which has everything else.
 *
 * Above the list, only what needs the reader: the board-update note for an
 * owner or admin, and legacy duplicate pairs to resolve, each a click from the
 * device's details. Revoked devices hide behind *Show revoked*, in no count.
 */
export function DevicesTab({
  devices,
  counts,
  error,
  onRetry,
  now,
  canManage,
  readOnly,
  wizard,
  orgRole,
  updateIds,
  showRevoked,
  onToggleRevoked,
  addButton,
  onAddDevice,
  onAddTool,
  onDetails,
}: DevicesTabProps) {
  const listed =
    devices === undefined
      ? []
      : devices.filter((device) => deviceLive(device) || (showRevoked && revokedDevice(device)));
  const review = devices === undefined ? undefined : conflictsToReview(devices);
  const hidden = counts?.revokedDevices ?? 0;
  const empty = devices !== undefined && listed.length === 0 && hidden === 0;

  return (
    <section className="dv3-list" aria-labelledby={DEVICES_TITLE}>
      <SectionTitle
        title="Devices"
        titleId={DEVICES_TITLE}
        sub="A device is your computer. Add it once; then add its coding tools."
        actions={
          <>
            <StatusLegendLink from="devices" />
            {canManage && !wizard && (
              <button
                type="button"
                ref={addButton}
                className="dx-btn dx-btn-primary"
                onClick={onAddDevice}
              >
                + Add device
              </button>
            )}
          </>
        }
      />

      {readOnly && (
        <NoteBlock note="read-only">
          <p>
            Changing devices and tools needs a signed-in browser session. This one is not allowed to
            — the list below is read only.
          </p>
        </NoteBlock>
      )}

      {error !== null ? (
        <ApiErrorState
          error={error}
          resource="your devices"
          scope="organisation"
          onRetry={onRetry}
        />
      ) : devices === undefined ? (
        <LoadingState shape="row" count={3} label="Loading your devices" />
      ) : empty ? (
        <div className="dx-card">
          <div className="dx-empty">
            <div className="dx-empty-icon">
              <DxIcon name="device" size={22} />
            </div>
            <h3 className="dx-empty-title">No devices yet</h3>
            <p className="dx-empty-body">
              Pair your computer first. You won’t be asked to choose Claude Code or any other tool
              here.
            </p>
            {canManage && !wizard && (
              <button type="button" className="dx-btn dx-btn-primary" onClick={onAddDevice}>
                Add device
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <BoardUpdateNote orgRole={orgRole} agentIds={updateIds} />
          {review !== undefined && review.count > 0 && (
            <div data-conflicts-note>
              <NoteBlock
                tone="warn"
                title={`Needs your attention: ${String(review.count)} ${review.count === 1 ? 'conflict' : 'conflicts'}`}
              >
                <p>
                  Two agents of one tool on one device, from before one per tool per device. Both
                  keep working; open the device to rename or disconnect one.
                </p>
                <div className="dx-actions">
                  {review.devices.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      className="dx-btn dx-btn-sm"
                      onClick={() => {
                        onDetails(device.id);
                      }}
                    >
                      Review {device.display_name}
                    </button>
                  ))}
                </div>
              </NoteBlock>
            </div>
          )}
          {listed.length === 0 ? (
            <p className="dv3-none" role="note">
              {everyDeviceRevoked(devices)
                ? 'Every device and tool of yours is revoked.'
                : 'Nothing active to show. Show revoked to see the rest.'}
            </p>
          ) : (
            <div className="dx-card">
              <ul className="dx-records" aria-labelledby={DEVICES_TITLE}>
                {listed.map((device) => (
                  <DeviceRecord
                    key={device.id}
                    device={device}
                    now={now}
                    canManage={canManage && !wizard}
                    onAddTool={onAddTool}
                    onDetails={onDetails}
                  />
                ))}
              </ul>
            </div>
          )}
          {hidden > 0 && (
            <button
              type="button"
              className="dx-btn dx-btn-sm dx-btn-ghost dv3-revoked-toggle"
              aria-pressed={showRevoked}
              onClick={onToggleRevoked}
            >
              {showRevoked ? 'Hide revoked' : `Show revoked (${String(hidden)})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DeviceRecord({
  device,
  now,
  canManage,
  onAddTool,
  onDetails,
}: {
  readonly device: Device;
  readonly now: number;
  readonly canManage: boolean;
  readonly onAddTool: (deviceId: string) => void;
  readonly onDetails: (deviceId: string) => void;
}) {
  const chip = deviceChip(device);
  return (
    <li
      className="dx-record dv3-device dv3-row"
      data-device={device.id}
      data-kind={device.kind}
      data-origin={device.origin}
      data-status={device.status}
      data-confirmed={device.confirmed}
    >
      <span className="dx-icon">
        <DxIcon name={device.kind === 'cloud' ? 'cloud' : 'device'} />
      </span>
      <div className="dx-record-main">
        <RowOpen
          details={`devices:${device.id}`}
          label={device.display_name}
          onOpen={() => {
            onDetails(device.id);
          }}
        />
        <span className="dx-record-sub" data-line>
          {deviceLine(device, now)}
        </span>
      </div>
      <div className="dx-record-end">
        <span data-device-chip={deviceChipKey(device, needsConfirm(device))}>
          <HintChip
            word={chip.word}
            tone={chip.tone}
            description={deviceChipDescription(
              device,
              deviceChipKey(device, needsConfirm(device)),
              now,
            )}
          />
        </span>
        {device.status === 'active' && (
          <DeviceUpdateChip
            name={device.display_name}
            agentIds={device.agents
              .filter((agent) => agent.status === 'active')
              .map((agent) => agent.id)}
          />
        )}
        {canManage && pairedDevice(device) && (
          <button
            type="button"
            className="dx-btn dx-btn-sm"
            aria-label={`Add a tool to ${device.display_name}`}
            onClick={() => {
              onAddTool(device.id);
            }}
          >
            Add tool →
          </button>
        )}
      </div>
      <RowChevron />
    </li>
  );
}

/**
 * A device row's helper chip — the worst among its tools, as
 * `DeviceVersionChip` draws it — only when one of them has something to do
 * (`rowShowsUpdate`). Each tool's status is a hook call, so the tools are read
 * one component apiece, down the list, carrying whether any needs the chip.
 */
function DeviceUpdateChip({
  name,
  agentIds,
  index = 0,
  any = false,
}: {
  readonly name: string;
  readonly agentIds: readonly string[];
  readonly index?: number;
  readonly any?: boolean;
}) {
  const key = useUpdateStatus(agentIds[index] ?? '')?.key;
  const shows = any || (index < agentIds.length && rowShowsUpdate(key));
  if (index + 1 < agentIds.length) {
    return <DeviceUpdateChip name={name} agentIds={agentIds} index={index + 1} any={shows} />;
  }
  return shows ? <DeviceVersionChip name={name} agentIds={agentIds} /> : null;
}

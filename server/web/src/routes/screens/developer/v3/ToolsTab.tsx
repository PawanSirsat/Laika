import type { MouseEvent, Ref } from 'react';
import { agentHarness } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { DesignChip } from './DesignChip.tsx';
import { DxIcon } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import {
  anyPaired,
  chipTone,
  listedStatus,
  listedTools,
  toolAction,
  toolLine,
  toolRowId,
  type DeviceCounts,
  type ListedTool,
} from './devices-view.ts';
import { UpdateChip, useUpdateStatus, useVerification } from './ToolUpdate.tsx';

export const TOOLS_TITLE = 'dv3-tools-title';

export interface ToolsTabProps {
  readonly devices: readonly Device[] | undefined;
  readonly counts: DeviceCounts | undefined;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly now: number;
  readonly canManage: boolean;
  readonly readOnly: boolean;
  readonly wizard: boolean;
  readonly showRevoked: boolean;
  readonly onToggleRevoked: () => void;
  readonly addButton: Ref<HTMLButtonElement>;
  readonly onAddTool: () => void;
  /** No paired device yet: *Add a device first*, on Devices. */
  readonly onAddDevice: () => void;
  readonly onDetails: (agentId: string) => void;
  /** *Finish setup →* on a paired device: the Add tool wizard's reconnect. */
  readonly onFinish: (listed: ListedTool) => void;
  /** Where Project setup is for one tool. */
  readonly projectHref: (agentId: string) => string;
  readonly onNavigate: (href: string) => void;
}

/**
 * Developer access V3 → Tools (LAI-1080, the owner's design): **one line a
 * coding tool**, across every device — each its own Laika credential, so the
 * board can tell which tool did what and one can be disconnected without the
 * others. The same `GET /devices` read Devices draws from, so the two tabs'
 * numbers agree.
 *
 * A row says the tool and its device, how many projects it reaches and when
 * it was last seen, its status — *Ready* only from its own verification
 * (`listedStatus`) — and, when there is something to update to, a small
 * update chip. Its action is the next step: *Set up project →*, or *Finish
 * setup →* while it needs setup. Everything else is in its details panel,
 * which hosts what every tool row on Devices used to expand to.
 */
export function ToolsTab({
  devices,
  counts,
  error,
  onRetry,
  now,
  canManage,
  readOnly,
  wizard,
  showRevoked,
  onToggleRevoked,
  addButton,
  onAddTool,
  onAddDevice,
  onDetails,
  onFinish,
  projectHref,
  onNavigate,
}: ToolsTabProps) {
  const listed = devices === undefined ? [] : listedTools(devices, showRevoked);
  const revoked = counts?.revokedTools ?? 0;
  const noDevice = devices !== undefined && !anyPaired(devices) && listed.length === 0;

  // The design's first run: nothing to add a tool to, so the one next step.
  if (noDevice && revoked === 0 && error === null) {
    return (
      <section className="dv3-list" aria-labelledby={TOOLS_TITLE}>
        <div className="dx-card">
          <div className="dx-empty">
            <div className="dx-empty-icon">
              <DxIcon name="device" size={22} />
            </div>
            <h2 className="dx-empty-title" id={TOOLS_TITLE} tabIndex={-1}>
              Add a device first
            </h2>
            <p className="dx-empty-body">
              Pair your computer before adding coding tools. You will not need to pair it again for
              each tool.
            </p>
            {canManage && !wizard && (
              <button type="button" className="dx-btn dx-btn-primary" onClick={onAddDevice}>
                Add device →
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="dv3-list" aria-labelledby={TOOLS_TITLE}>
      <SectionTitle
        title="Connected tools"
        titleId={TOOLS_TITLE}
        sub="Each coding tool has its own Laika credential, so you can see which tool did what and disconnect one without touching the others."
        actions={
          canManage && !wizard ? (
            <button
              type="button"
              ref={addButton}
              className="dx-btn dx-btn-primary"
              onClick={onAddTool}
            >
              + Add tool
            </button>
          ) : undefined
        }
      />

      {readOnly && (
        <NoteBlock note="read-only">
          <p>
            Changing tools needs a signed-in browser session. This one is not allowed to — the list
            below is read only.
          </p>
        </NoteBlock>
      )}

      {error !== null ? (
        <ApiErrorState error={error} resource="your tools" scope="organisation" onRetry={onRetry} />
      ) : devices === undefined ? (
        <LoadingState shape="row" count={3} label="Loading your tools" />
      ) : (
        <>
          {listed.length === 0 ? (
            <div className="dx-card">
              <div className="dx-empty">
                <div className="dx-empty-icon">
                  <DxIcon name="tool" size={22} />
                </div>
                <h3 className="dx-empty-title">No tools connected</h3>
                <p className="dx-empty-body">
                  Add Claude Code, Codex or another coding tool to a device you have already paired.
                </p>
                {canManage && !wizard && (
                  <button type="button" className="dx-btn dx-btn-primary" onClick={onAddTool}>
                    Add first tool
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="dx-card">
              <ul className="dx-records" aria-labelledby={TOOLS_TITLE}>
                {listed.map((row) => (
                  <ToolRecord
                    key={row.agent.id}
                    listed={row}
                    now={now}
                    canManage={canManage && !wizard}
                    onDetails={onDetails}
                    onFinish={onFinish}
                    projectHref={projectHref(row.agent.id)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          )}
          {revoked > 0 && (
            <button
              type="button"
              className="dx-btn dx-btn-sm dx-btn-ghost dv3-revoked-toggle"
              aria-pressed={showRevoked}
              onClick={onToggleRevoked}
            >
              {showRevoked ? 'Hide revoked' : `Show revoked (${String(revoked)})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ToolRecord({
  listed,
  now,
  canManage,
  onDetails,
  onFinish,
  projectHref,
  onNavigate,
}: {
  readonly listed: ListedTool;
  readonly now: number;
  readonly canManage: boolean;
  readonly onDetails: (agentId: string) => void;
  readonly onFinish: (listed: ListedTool) => void;
  readonly projectHref: string;
  readonly onNavigate: (href: string) => void;
}) {
  const { agent, label, inConflict } = listed;
  const status = listedStatus(agent, useVerification(agent.id), now);
  const update = useUpdateStatus(agent.id);
  const action = toolAction(listed, status);
  const active = agent.status === 'active';
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(projectHref);
  };
  return (
    <li
      className="dx-record dv3-tool"
      id={toolRowId(agent.id)}
      data-agent={agent.id}
      data-status={status.key}
      data-update={active ? update?.key : undefined}
    >
      <span className="dx-icon">
        <AgentMark client={agentHarness(agent)} size="sm" />
      </span>
      <div className="dx-record-main">
        <strong className="dx-record-title">{label}</strong>
        <span className="dx-record-sub" data-line>
          {toolLine(agent, now)}
        </span>
      </div>
      <div className="dx-record-end">
        <span data-readiness={status.key} data-evidence={status.evidence}>
          <DesignChip tone={chipTone(status.tone)}>{status.word}</DesignChip>
        </span>
        {active && <UpdateChip status={update} />}
        {inConflict && <DesignChip tone="warn">Duplicate</DesignChip>}
        {action === 'set-up-project' && (
          <a
            className="dx-btn dx-btn-sm"
            href={projectHref}
            aria-label={`Set up a project for ${label}`}
            onClick={follow}
          >
            Set up project →
          </a>
        )}
        {action === 'finish-in-wizard' && canManage && (
          <button
            type="button"
            className="dx-btn dx-btn-sm"
            aria-label={`Finish setting up ${label}`}
            onClick={() => {
              onFinish(listed);
            }}
          >
            Finish setup →
          </button>
        )}
        {action === 'finish-in-details' && (
          <button
            type="button"
            className="dx-btn dx-btn-sm"
            aria-label={`Finish setting up ${label}`}
            onClick={() => {
              onDetails(agent.id);
            }}
          >
            Finish setup →
          </button>
        )}
        <button
          type="button"
          className="dx-btn dx-btn-sm dx-btn-ghost"
          data-details={`tools:${agent.id}`}
          aria-label={`Details for ${label}`}
          onClick={() => {
            onDetails(agent.id);
          }}
        >
          Details
        </button>
      </div>
    </li>
  );
}

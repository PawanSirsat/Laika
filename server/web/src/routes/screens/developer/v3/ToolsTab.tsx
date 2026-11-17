import type { MouseEvent, ReactNode, Ref } from 'react';
import { agentHarness } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../../components/EmptyState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { AutoPickupChip } from './AutoPickupChip.tsx';
import { DxIcon } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import {
  anyPaired,
  chipTone,
  groupLine,
  groupStatusDescription,
  lineDevice,
  listedStatus,
  listedTools,
  singleRow,
  toolAction,
  toolGroups,
  toolLine,
  toolRowId,
  type DeviceCounts,
  type ListedTool,
  type ToolGroup,
} from './devices-view.ts';
import { HintChip, StatusLegendLink } from './StatusLegend.tsx';
import {
  UpdateChip,
  useReportedHelper,
  useUpdateStatus,
  useVerification,
  useVerificationOf,
} from './ToolUpdate.tsx';
import {
  DUPLICATE,
  TOOL_STATUS,
  duplicateDescription,
  rowShowsUpdate,
  toolChipDescription,
} from './status-vocabulary.ts';
import { catalogTool } from './tool-catalog.ts';
import './tool-groups.css';
import { Icon } from '../../../../components/icon/Icon.tsx';

export const TOOLS_TITLE = 'dv3-tools-title';

/** A group header's id, which its list of device lines is labelled by. */
function toolGroupTitle(client: string): string {
  return `dv3-tool-group-${client}`;
}

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
 * Developer access V3 → Tools (LAI-1080, the owner's design): **one row a
 * coding tool**, across every device — each agent its own Laika credential,
 * so the board can tell which tool did what and one can be disconnected
 * without the others. The same `GET /devices` read Devices draws from, so the
 * two tabs' numbers agree.
 *
 * **A tool on more than one device is one row with a line a device**
 * (LAI-321, `toolGroups`): a header with the tool, how many devices, and the
 * worst of their statuses, then each device's line, which is the agent's own
 * — its status, chips, next step and details. A tool on one device is one
 * row, `<tool> · <device>`, as before (`singleRow`).
 *
 * A line says its device, how many projects it reaches and when
 * it was last seen, its status — *Ready* only from its own verification
 * (`listedStatus`) — and a helper chip only when there is something to do
 * (`rowShowsUpdate`). Its action is the next step: *Set up project →*, or
 * *Finish setup →* while it needs setup. **The row itself opens its details
 * panel** (LAI-1097), which hosts everything else.
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
  const verificationOf = useVerificationOf();
  const listed = devices === undefined ? [] : listedTools(devices, showRevoked);
  const groups = toolGroups(listed, (row) =>
    listedStatus(row.agent, verificationOf(row.agent.id), now),
  );
  const revoked = counts?.revokedTools ?? 0;
  const noDevice = devices !== undefined && !anyPaired(devices) && listed.length === 0;

  // The design's first run: nothing to add a tool to, so the one next step.
  if (noDevice && revoked === 0 && error === null) {
    return (
      <section className="dv3-list" aria-labelledby={TOOLS_TITLE}>
        <div className="dx-card">
          <EmptyState
            headline="Add a device first"
            headingLevel={2}
            headingId={TOOLS_TITLE}
            body="Pair your computer before adding coding tools. You will not need to pair it again for each tool."
            {...(canManage && !wizard
              ? { action: { label: 'Add device →', onClick: onAddDevice } }
              : {})}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="dv3-list" aria-labelledby={TOOLS_TITLE}>
      <SectionTitle
        title="Connected tools"
        titleId={TOOLS_TITLE}
        sub="Each coding tool has its own Laika credential: you see which one did what, and can disconnect it alone."
        actions={
          <>
            <StatusLegendLink from="tools" />
            {canManage && !wizard && (
              <button
                type="button"
                ref={addButton}
                className="dx-btn dx-btn-primary"
                onClick={onAddTool}
              >
                + Add tool
              </button>
            )}
          </>
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
              <EmptyState
                headline="No tools connected"
                headingLevel={3}
                body="Add Claude Code, Codex or another coding tool to a device you have already paired."
                {...(canManage && !wizard
                  ? { action: { label: 'Add first tool', onClick: onAddTool } }
                  : {})}
              />
            </div>
          ) : (
            <div className="dx-card">
              <ul className="dx-records" aria-labelledby={TOOLS_TITLE}>
                {groups.map((group) => {
                  const record = (row: ListedTool, line: boolean) => (
                    <ToolRecord
                      key={row.agent.id}
                      listed={row}
                      line={line}
                      now={now}
                      canManage={canManage && !wizard}
                      onDetails={onDetails}
                      onFinish={onFinish}
                      projectHref={projectHref(row.agent.id)}
                      onNavigate={onNavigate}
                    />
                  );
                  const [only] = group.lines;
                  return singleRow(group) && only !== undefined ? (
                    record(only.listed, false)
                  ) : (
                    <ToolGroupRecord key={`group-${group.client}`} group={group}>
                      {group.lines.map((l) => record(l.listed, true))}
                    </ToolGroupRecord>
                  );
                })}
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

/**
 * A tool on more than one device (LAI-321): its header — the product, how
 * many devices, the worst of their statuses — over a list of its device
 * lines. The header opens nothing: there is no one agent to open, and each
 * line is its own.
 */
function ToolGroupRecord({
  group,
  children,
}: {
  readonly group: ToolGroup;
  readonly children: ReactNode;
}) {
  const titleId = toolGroupTitle(group.client);
  return (
    <li
      className="dv3-tool-group"
      data-tool-group={group.client}
      data-devices={group.devices}
      data-status={group.status.key}
    >
      <div className="dx-record dv3-tool-group-head">
        <span className="dx-icon">
          <AgentMark client={group.client} size="sm" />
        </span>
        <div className="dx-record-main">
          <h3 className="dx-record-title dv3-tool-group-title" id={titleId}>
            {group.product}
          </h3>
          <span className="dx-record-sub" data-group-line>
            {groupLine(group)}
          </span>
        </div>
        <div className="dx-record-end">
          <span data-group-status={group.status.key}>
            <HintChip
              word={TOOL_STATUS[group.status.key].word}
              tone={chipTone(group.status.tone)}
              description={groupStatusDescription(group)}
            />
          </span>
        </div>
      </div>
      <ul className="dv3-tool-lines" aria-labelledby={titleId}>
        {children}
      </ul>
    </li>
  );
}

/**
 * One agent: a row of its own (`line` false — a tool on one device, named
 * `<tool> · <device>`) or a device's line under its tool's header (`line`
 * true, named by its device). Either way the same chips and next step, and
 * the whole of it opens that agent's details.
 */
function ToolRecord({
  listed,
  line,
  now,
  canManage,
  onDetails,
  onFinish,
  projectHref,
  onNavigate,
}: {
  readonly listed: ListedTool;
  readonly line: boolean;
  readonly now: number;
  readonly canManage: boolean;
  readonly onDetails: (agentId: string) => void;
  readonly onFinish: (listed: ListedTool) => void;
  readonly projectHref: string;
  readonly onNavigate: (href: string) => void;
}) {
  const { agent, label, inConflict } = listed;
  const verification = useVerification(agent.id);
  const status = listedStatus(agent, verification, now);
  const update = useUpdateStatus(agent.id);
  const helper = useReportedHelper(agent.id);
  const action = toolAction(listed, status);
  const active = agent.status === 'active';
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(projectHref);
  };
  return (
    <li
      className={`dx-record dv3-tool dv3-row${line ? ' dv3-tool-line' : ''}`}
      id={toolRowId(agent.id)}
      data-agent={agent.id}
      data-status={status.key}
      data-update={active ? update?.key : undefined}
    >
      <span className="dx-icon">
        {line ? (
          <DxIcon name={listed.device.kind === 'cloud' ? 'cloud' : 'device'} />
        ) : (
          <AgentMark client={agentHarness(agent)} size="sm" />
        )}
      </span>
      <div className="dx-record-main">
        <RowOpen
          details={`tools:${agent.id}`}
          label={label}
          title={line ? lineDevice(listed) : undefined}
          onOpen={() => {
            onDetails(agent.id);
          }}
        />
        <span className="dx-record-sub" data-line>
          {toolLine(agent, now)}
          {active && helper !== undefined && ` · ${helper}`}
        </span>
      </div>
      <div className="dx-record-end">
        <span data-readiness={status.key} data-evidence={status.evidence}>
          <HintChip
            word={TOOL_STATUS[status.key].word}
            tone={chipTone(status.tone)}
            description={toolChipDescription({
              label,
              status,
              agent,
              verification,
              tool: catalogTool(agent.harness),
              deviceName: listed.device.display_name,
              now,
            })}
          />
        </span>
        {active && rowShowsUpdate(update?.key) && <UpdateChip status={update} label={label} />}
        {active && (
          <AutoPickupChip launcher={agent.launcher} now={now} device={listed.device.display_name} />
        )}
        {inConflict && (
          <span data-duplicate="">
            <HintChip
              word={DUPLICATE.word}
              tone={DUPLICATE.tone}
              description={duplicateDescription(label)}
            />
          </span>
        )}
        {action === 'set-up-project' && (
          <a
            className="dx-btn dx-btn-sm"
            href={projectHref}
            aria-label={`Set up a project for ${label}`}
            onClick={follow}
          >
            Set up project
            <Icon name="arrow-right" size="tiny" />
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
            Finish setup
            <Icon name="arrow-right" size="tiny" />
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
            Finish setup
            <Icon name="arrow-right" size="tiny" />
          </button>
        )}
      </div>
      <RowChevron />
    </li>
  );
}

/**
 * A Tools or Devices row's name, as the button that opens its details
 * (LAI-1097: the owner's rows have one chip and one action, and no *Details*
 * button). `devices-tab.css` stretches it over the whole row, under the
 * chips and the row's action, which keep their own clicks. `data-details`
 * is where focus comes back to when the panel closes (`DeviceRoster`).
 *
 * `title` is what it shows when that is less than `label` — a device's line
 * under its tool shows *Belka* (LAI-321) — and its name is still the whole
 * label, so a screen reader hears what it opens.
 */
export function RowOpen({
  details,
  label,
  title,
  onOpen,
}: {
  readonly details: string;
  readonly label: string;
  readonly title?: string | undefined;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="dv3-row-open"
      data-details={details}
      aria-label={`Details for ${label}`}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <strong className="dx-record-title">{title ?? label}</strong>
    </button>
  );
}

/** The row's end: it opens, so it says so. Decoration only — the name is the button. */
export function RowChevron() {
  return (
    <span className="dv3-row-chevron" aria-hidden="true">
      <Icon name="chevron" size="small" />
    </span>
  );
}

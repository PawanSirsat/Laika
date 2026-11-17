import type { KeyboardEvent } from 'react';
import { roundAgentName, type ReviewQueueItem } from '../../../api/review.ts';
import { formatAgeCompact } from '../../../api/duration.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { Chip } from '../../../components/chip/Chip.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { ProjectMark } from '../../../components/ProjectMark.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { typingIn } from '../../../components/typing-in.ts';
import { pageState, toggleOne, togglePage } from '../list/list-select.ts';
import { evidenceState, isStale, listCommand, type SpaceGroup } from './review-derive.ts';

export interface ReviewGroupsProps {
  readonly groups: readonly SpaceGroup[];
  /** The clock the waiting labels count to. */
  readonly now: number;
  /** The task ids ticked — only ever rows the reader may decide. */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (next: ReadonlySet<string>) => void;
  /** A bulk run is under way: the boxes and the row actions hold still. */
  readonly busy: boolean;
  /** The row open in the Review dialog, if any — tinted so the place is kept. */
  readonly open: string | null;
  /** A row's line was pressed: open it in the dialog (LAI-1169). */
  readonly onOpen: (item: ReviewQueueItem) => void;
  /** The row's own Accept, or `a` on it — the same call as the dialog's. */
  readonly onAccept: (item: ReviewQueueItem) => void;
  /** The row's own Send back…, or `s` on it: the dialog's reason box. */
  readonly onSendBack: (item: ReviewQueueItem, from: HTMLElement) => void;
  /** The task ids whose decision is in flight: their actions wait. */
  readonly deciding: ReadonlySet<string>;
}

/** Every row's line, in the order the page draws them. */
function lines(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.rev-line')];
}

/**
 * The queue by space (D-146, LAI-1168): a heading per space with its count
 * and a select-all box, then the rows — a checkbox beside the line for a row
 * the reader may decide, an empty cell for one they may not, so the lines
 * align whichever view is open.
 *
 * **The checkbox and the row's actions are outside the row button.** The line
 * is a button that opens the Review dialog (LAI-1169); a box or a button
 * inside it would be a control inside a control, and a near miss on a 16px
 * box must tick, not open.
 *
 * **A row says one thing about its proof** (LAI-1222): one quiet status chip,
 * the most urgent fact first, with the reason on its tooltip — where it drew
 * a pill per kind of proof and a loud `no proof` on every bare row. The age
 * is `12d 2h`, with the moment it entered review on hover, and is coloured
 * only once it has waited two days.
 *
 * **The rows answer the dialog's keys** (LAI-1222): `j` / `k` move between
 * them, `a` accepts the focused row and `s` sends it back, Enter opens it.
 * The Accept and Send back… beside a decidable row show on hover and focus.
 */
export function ReviewGroups({
  groups,
  now,
  selected,
  onSelect,
  busy,
  open,
  onOpen,
  onAccept,
  onSendBack,
  deciding,
}: ReviewGroupsProps) {
  const byId = new Map<string, ReviewQueueItem>();
  for (const group of groups) for (const item of group.items) byId.set(item.task.id, item);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.rev-row');
    if (row === null) return;
    const command = listCommand(event, typingIn(target));
    if (command === null) return;
    const all = lines(event.currentTarget);
    const line = row.querySelector<HTMLElement>('.rev-line');
    const at = line === null ? -1 : all.indexOf(line);
    if (command === 'next' || command === 'prev') {
      const to = all[command === 'next' ? at + 1 : at - 1];
      if (to === undefined) return;
      event.preventDefault();
      to.focus();
      return;
    }
    const item = byId.get(row.dataset.id ?? '');
    if (item === undefined || !item.can_decide || busy || deciding.has(item.task.id)) return;
    event.preventDefault();
    if (command === 'accept') onAccept(item);
    else onSendBack(item, line ?? row);
  };

  return (
    <div className="rev-groups" onKeyDown={onKeyDown}>
      {groups.map((group) => {
        const headState = pageState(selected, group.decidable);
        const headingId = `rev-group-${group.project.id}`;
        return (
          <section
            key={group.project.id}
            className="rev-group"
            data-space={group.project.slug}
            aria-labelledby={headingId}
          >
            <header className="rev-group-head">
              <span className="rev-cell">
                {group.decidable.length > 0 && (
                  <input
                    type="checkbox"
                    className="checkbox-input rev-check"
                    aria-label={`Select every task in ${group.project.name}`}
                    checked={headState === 'all'}
                    disabled={busy}
                    // `indeterminate` is a property, not an attribute, so React
                    // has no prop for it; the ref sets it on every render.
                    ref={(box) => {
                      if (box !== null) box.indeterminate = headState === 'some';
                    }}
                    onChange={() => {
                      onSelect(togglePage(selected, group.decidable));
                    }}
                  />
                )}
              </span>
              <span className="rev-group-name">
                <ProjectMark project={group.project} size="sm" />
                {/* Focusable, not in the Tab order: where focus lands when the
                    dialog closes on a row that has since left the queue. */}
                <h3 className="rev-group-title" id={headingId} tabIndex={-1}>
                  {group.project.name}
                </h3>
              </span>
              <span className="rev-group-count">
                {group.items.length}
                <span className="visually-hidden"> waiting</span>
              </span>
            </header>
            <ul
              className="rev-list"
              aria-label={`Tasks waiting for review in ${group.project.name}`}
            >
              {group.items.map((item) => {
                const opened = open === item.task.id;
                const ticked = selected.has(item.task.id);
                const evidence = evidenceState(item);
                const agent = item.round === null ? null : roundAgentName(item.round);
                const waited = now - item.waiting_since;
                const entered = timeLabel(item.waiting_since, now);
                const stale = isStale(waited);
                const held = busy || deciding.has(item.task.id);
                return (
                  <li
                    key={item.task.id}
                    className={[
                      'rev-row',
                      opened ? 'rev-row-open' : '',
                      ticked ? 'rev-row-selected' : '',
                      item.can_decide ? 'rev-row-decidable' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    data-task={item.task.key}
                    data-id={item.task.id}
                  >
                    <span className="rev-cell">
                      {item.can_decide && (
                        <input
                          type="checkbox"
                          className="checkbox-input rev-check"
                          aria-label={`Select ${item.task.key}`}
                          checked={ticked}
                          disabled={busy}
                          onChange={() => {
                            onSelect(toggleOne(selected, item.task.id));
                          }}
                        />
                      )}
                    </span>
                    <button
                      type="button"
                      className="rev-line"
                      aria-haspopup="dialog"
                      aria-keyshortcuts={item.can_decide ? 'j k a s' : 'j k'}
                      onClick={() => {
                        onOpen(item);
                      }}
                    >
                      <span className="rev-key">{item.task.key}</span>
                      <span className="rev-title">{item.task.title}</span>
                      <span className="rev-meta">
                        <span>{item.assignee_name ?? 'Unassigned'}</span>
                        {agent !== null && <span className="rev-agent">{agent}</span>}
                        {item.round !== null && item.round.number > 1 && (
                          <span>round {item.round.number}</span>
                        )}
                      </span>
                      <span className="rev-proof">
                        <Chip
                          variant="status"
                          tone={evidence.tone}
                          mark={evidence.mark}
                          title={evidence.hint}
                          className="rev-evidence"
                          data={{ 'data-evidence': evidence.kind }}
                        >
                          {evidence.label}
                        </Chip>
                      </span>
                      <Tooltip content={`In review since ${entered.full}`} lazy>
                        <time
                          className={stale ? 'rev-wait rev-wait-stale' : 'rev-wait'}
                          dateTime={entered.iso}
                          data-stale={stale ? 'true' : undefined}
                        >
                          <span className="visually-hidden">waiting </span>
                          {formatAgeCompact(waited)}
                        </time>
                      </Tooltip>
                    </button>
                    <span className="rev-actions">
                      {item.can_decide && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Accept ${item.task.key}`}
                            disabled={held}
                            onClick={() => {
                              onAccept(item);
                            }}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Send ${item.task.key} back`}
                            disabled={held}
                            onClick={(event) => {
                              onSendBack(item, event.currentTarget);
                            }}
                          >
                            Send back…
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

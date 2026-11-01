import type { DragEvent } from 'react';
import type { TimeDraft, TimeEntry } from '../../../api/time.ts';
import { kindLabel } from './entry-kinds.ts';
import { duration } from './format.ts';
import { endTrayDrag, startTrayDrag } from './tray-drag.ts';

export interface UntimedTrayProps {
  readonly drafts: readonly TimeDraft[];
  readonly entries: readonly TimeEntry[];
  readonly selected: string | undefined;
  readonly onPick: (item: { readonly kind: 'draft' | 'entry'; readonly id: string }) => void;
  /** Somebody else's day (LAI-959): nothing here can be given a time. */
  readonly readOnly?: boolean;
  /**
   * Items may be dragged onto the Timeline to be given a time (the owner's
   * design, LAI-512): on a desktop, on the person's own day.
   */
  readonly draggable?: boolean;
}

/**
 * *No set time* (the owner's design, D-110 item 8, LAI-505; LAI-514): the
 * day's blocks with a length and no place on the Timeline, each a chip — a
 * grip, how long, what, its kind. Tapping one opens it in the drawer, where
 * its time is set; on a desktop it can also be dragged onto the Timeline
 * (LAI-512 takes the drop). The hint says which, by the width, in CSS.
 */
export function UntimedTray({
  drafts,
  entries,
  selected,
  onPick,
  readOnly = false,
  draggable = false,
}: UntimedTrayProps) {
  const items = [
    ...drafts
      .filter((d) => d.started_at === null)
      .map((d) => ({
        kind: 'draft' as const,
        id: d.id,
        minutes: d.minutes,
        title: d.task?.key ?? d.project?.name ?? 'General',
        sub: null,
      })),
    ...entries
      .filter((e) => e.started_at === null)
      .map((e) => ({
        kind: 'entry' as const,
        id: e.id,
        minutes: e.minutes,
        title: e.title ?? e.task?.key ?? e.project?.name ?? 'General',
        sub: e.kind === undefined || e.kind === null ? null : kindLabel(e.kind),
      })),
  ];
  if (items.length === 0) return null;
  return (
    <section className="myday-card myday-tray" aria-labelledby="myday-tray-title" data-untimed-tray>
      <div className="myday-tray-words">
        <h2 className="myday-card-title" id="myday-tray-title">
          No set time
        </h2>
        {readOnly ? (
          <span className="myday-quiet">Added without a time</span>
        ) : (
          <>
            <span className="myday-quiet myday-tray-hint-desk">
              Drag onto the Timeline to give it a time
            </span>
            <span className="myday-quiet myday-tray-hint-phone">Tap to set a time</span>
          </>
        )}
      </div>
      <ul className="myday-tray-items">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                selected === item.id
                  ? 'myday-tray-item myday-tray-item-selected'
                  : 'myday-tray-item'
              }
              data-tray-item={item.id}
              data-tray-kind={item.kind}
              data-tray-minutes={item.minutes}
              data-tray-draggable={draggable ? 'true' : undefined}
              aria-pressed={selected === item.id}
              draggable={draggable}
              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                if (!draggable) return;
                startTrayDrag({
                  kind: item.kind,
                  id: item.id,
                  minutes: item.minutes,
                  label: item.title,
                });
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={endTrayDrag}
              onClick={() => {
                onPick({ kind: item.kind, id: item.id });
              }}
            >
              <span className="myday-tray-grip" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="myday-tray-length">{duration(item.minutes)}</span>
              <span className="myday-tray-title">{item.title}</span>
              {item.sub !== null && <span className="myday-tray-kind">{item.sub}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

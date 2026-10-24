import type { TimeDraft, TimeEntry } from '../../../api/time.ts';
import { kindLabel } from './entry-kinds.ts';
import { duration } from './format.ts';

export interface UntimedTrayProps {
  readonly drafts: readonly TimeDraft[];
  readonly entries: readonly TimeEntry[];
  readonly selected: string | undefined;
  readonly onPick: (item: { readonly kind: 'draft' | 'entry'; readonly id: string }) => void;
}

/**
 * *No set time* (the owner's design, D-110 item 8, LAI-505): the day's blocks
 * with a length and no place on the Timeline, each a chip — how long, what,
 * its kind. Tapping one opens it beside the lists, where its time is set.
 */
export function UntimedTray({ drafts, entries, selected, onPick }: UntimedTrayProps) {
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
        <span className="myday-quiet">Tap to set a time</span>
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
              aria-pressed={selected === item.id}
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

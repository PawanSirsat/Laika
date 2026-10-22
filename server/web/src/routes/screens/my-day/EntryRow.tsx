import type { TimeEntry } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { folderOf } from './folder.ts';
import { duration, span } from './format.ts';

export interface EntryRowProps {
  readonly entry: TimeEntry;
  /** Its place in the day's confirmed list, 1-based, and how many there are. */
  readonly position: number;
  readonly count: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onNavigate: (to: string) => void;
}

const SOURCES: Readonly<Record<TimeEntry['source'], string>> = {
  draft: 'From draft',
  manual: 'Typed',
  import: 'Solidtime',
};

/**
 * One confirmed entry (LAI-787; the owner's design, LAI-831): when, how long,
 * its card — a link to it — or General, its note, where it came from and its
 * revision. **The row selects it**: Delete, its card, its length and its
 * history are in the inspector, every change a revision kept beside it.
 */
export function EntryRow({
  entry,
  position,
  count,
  selected,
  onSelect,
  onNavigate,
}: EntryRowProps) {
  const when =
    entry.started_at === null || entry.ended_at === null
      ? 'No set time'
      : span(entry.started_at, entry.ended_at, entry.tz);
  const name =
    when === 'No set time'
      ? `entry ${String(position)} of ${String(count)}, no set time, ${duration(entry.minutes)}`
      : when;
  const label = entry.task?.key ?? entry.project?.name ?? 'General';

  return (
    <li
      className={selected ? 'myday-ledger-row myday-row-selected' : 'myday-ledger-row'}
      data-ledger-row={entry.id}
      data-entry={entry.id}
      onClick={(event) => {
        const from = event.target as HTMLElement;
        if (from.closest('a, input, button') === null) onSelect();
      }}
    >
      <span className="myday-ledger-mark" aria-hidden="true" />
      <span className="myday-swatch myday-swatch-confirmed" aria-hidden="true" />
      <button
        type="button"
        className="myday-row-select"
        data-select={entry.id}
        aria-pressed={selected}
        aria-label={`Review ${name}, ${label}, ${duration(entry.minutes)}`}
        onClick={onSelect}
      >
        <span className="myday-row-time">{when}</span>
        <span className="myday-row-minutes">{duration(entry.minutes)}</span>
      </button>
      <span className="myday-row-target">
        <span className="myday-row-key">
          {entry.task === null ? (
            label
          ) : (
            <CardLink task={entry.task} slug={entry.project?.slug} onNavigate={onNavigate} />
          )}
          {entry.note !== null && <span className="myday-row-note"> · {entry.note}</span>}
        </span>
        {folderOf(entry) !== undefined && (
          <span className="myday-row-line" data-entry-folder>
            {folderOf(entry)}
          </span>
        )}
      </span>
      <span className="myday-source">{SOURCES[entry.source]}</span>
      <span className="myday-rev">rev {String(entry.revision)}</span>
    </li>
  );
}

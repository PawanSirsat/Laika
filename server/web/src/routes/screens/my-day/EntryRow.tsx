import type { TimeEntry } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { kindLabel } from './entry-kinds.ts';
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

/** The source pill, as the design names it: where the entry came from. */
const SOURCES: Readonly<Record<TimeEntry['source'], string>> = {
  draft: 'From draft',
  manual: 'You added',
  import: 'Solidtime',
};

/**
 * One confirmed entry (LAI-787; the owner's design, LAI-514): a swatch,
 * when, how long, its card — a link to it — or its kind on General, with its
 * title or note beside it, and where it came from as a pill at the right.
 * **The row selects it**: Delete, its card, its length and its history are in
 * the editor, every change a revision kept there.
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
  // On General the kind is the label, as the design draws it; the title or
  // the note is the line beside.
  const kind = entry.kind === undefined || entry.kind === null ? undefined : kindLabel(entry.kind);
  const label = entry.task?.key ?? entry.project?.name ?? kind ?? 'General';
  const mono = entry.task !== null;
  const folder = folderOf(entry);
  const line =
    entry.task?.title ??
    entry.title ??
    entry.note ??
    (entry.project === null ? '' : 'A space, no card');

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
        <span className={mono ? 'myday-row-key myday-row-key-mono' : 'myday-row-key'}>
          {entry.task === null ? (
            label
          ) : (
            <CardLink task={entry.task} slug={entry.project?.slug} onNavigate={onNavigate} />
          )}
        </span>
        {line !== '' && <span className="myday-row-line">{line}</span>}
        {/* The name the person gave the folder (D-098, LAI-866). */}
        {folder !== undefined && (
          <span className="myday-row-line myday-row-folder" data-entry-folder>
            {folder}
          </span>
        )}
      </span>
      <span className={`myday-source myday-source-${entry.source}`}>{SOURCES[entry.source]}</span>
    </li>
  );
}

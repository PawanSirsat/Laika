import type { ChangeEvent } from 'react';
import type { TimeDraft } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { folderOf, needsACard } from './folder.ts';
import { duration, span } from './format.ts';

export interface DraftRowProps {
  readonly draft: TimeDraft;
  /** Its place in the day's drafted list, 1-based, and how many there are. */
  readonly position: number;
  readonly count: number;
  readonly busy: boolean;
  /** Ticked for a bulk action (LAI-810). */
  readonly checked: boolean;
  /** False on a day read rather than kept (LAI-959): no box to tick. */
  readonly checkable?: boolean;
  /** `range`: the click held Shift, so every row since the last one follows. */
  readonly onCheck: (on: boolean, range: boolean) => void;
  /** The one in the inspector. */
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onNavigate: (to: string) => void;
}

/** Whether a checkbox's change came from a Shift-click — React's change is the click. */
function shifted(event: ChangeEvent<HTMLInputElement>): boolean {
  const native = event.nativeEvent as Partial<MouseEvent>;
  return native.shiftKey === true;
}

/**
 * What a block is on: its key, General, a space, or *No task yet* — and the
 * words beside it, on the same line as the design draws them. A block from a
 * folder the person named says the name (D-098).
 */
function target(draft: TimeDraft): {
  readonly label: string;
  readonly line: string;
  readonly ready: boolean;
  readonly mono: boolean;
} {
  const folder = folderOf(draft);
  if (draft.task !== null)
    return { label: draft.task.key, line: draft.task.title, ready: true, mono: true };
  if (draft.project !== null)
    return {
      label: draft.project.name,
      line: folder === undefined ? 'A space, no card' : `A space, no card · ${folder}`,
      ready: true,
      mono: false,
    };
  if (draft.general)
    return { label: 'General', line: 'No card, on purpose', ready: true, mono: false };
  return {
    label: needsACard(draft),
    line:
      draft.task_key !== null
        ? `${draft.task_key} was named — a card you can’t read`
        : draft.folder !== undefined && draft.folder !== null
          ? 'Pick a card, or General'
          : 'Nothing named a card',
    ready: false,
    mono: false,
  };
}

/** The source pill, as the design names it: where the block came from. */
const SOURCES: Readonly<Record<TimeDraft['source'], string>> = {
  collector: 'Collector',
  agent: 'Agent',
};

/**
 * One block still to review (LAI-810; the owner's design, LAI-514): a box to
 * tick it for a bulk action, a swatch, when, how long, what it is on — its
 * card a link to it — with the words beside it, and where it came from as a
 * pill at the right. On a phone the time and length move under the label.
 * **The row selects the block**; what to do with it is in the editor, and
 * the keys.
 */
export function DraftRow({
  draft,
  position,
  count,
  busy,
  checkable = true,
  checked,
  onCheck,
  selected,
  onSelect,
  onNavigate,
}: DraftRowProps) {
  const when =
    draft.started_at === null || draft.ended_at === null
      ? 'No set time'
      : span(draft.started_at, draft.ended_at, draft.tz);
  const on = target(draft);
  // Its accessible name: the time, or — with none to tell two apart — which
  // block of the day it is, and how long.
  const name =
    when === 'No set time'
      ? `block ${String(position)} of ${String(count)}, no set time, ${duration(draft.minutes)}`
      : when;

  return (
    <li
      className={[
        'myday-settle-row',
        on.ready ? '' : 'myday-settle-untied',
        selected ? 'myday-row-selected' : '',
        checked ? 'myday-row-checked' : '',
      ]
        .filter((c) => c !== '')
        .join(' ')}
      data-settle-row={draft.id}
      data-draft={draft.id}
      onClick={(event) => {
        // The whole row selects, as the design has it — but a box or a link
        // keeps its own click.
        const from = event.target as HTMLElement;
        if (from.closest('a, input, button') === null) onSelect();
      }}
    >
      {checkable && (
        <input
          type="checkbox"
          className="myday-check"
          checked={checked}
          disabled={busy}
          aria-label={`Select ${name}, ${draft.task === null ? on.label : `${draft.task.key} ${draft.task.title}`}`}
          onChange={(event) => {
            onCheck(event.target.checked, shifted(event));
          }}
        />
      )}
      <span
        className={on.ready ? 'myday-swatch' : 'myday-swatch myday-swatch-needs'}
        aria-hidden="true"
      />
      <button
        type="button"
        className="myday-row-select"
        data-select={draft.id}
        aria-pressed={selected}
        aria-label={`Review ${name}, ${on.label}, ${duration(draft.minutes)}`}
        onClick={onSelect}
      >
        <span className="myday-row-time">{when}</span>
        <span className="myday-row-minutes">{duration(draft.minutes)}</span>
      </button>
      <span className="myday-row-target">
        <span
          className={[
            'myday-row-key',
            on.mono ? 'myday-row-key-mono' : '',
            on.ready ? '' : 'myday-row-needs',
          ]
            .filter((c) => c !== '')
            .join(' ')}
        >
          {draft.task === null ? (
            on.label
          ) : (
            <CardLink task={draft.task} slug={draft.project?.slug} onNavigate={onNavigate} />
          )}
        </span>
        <span className="myday-row-line">{on.line}</span>
      </span>
      <span className={`myday-source myday-source-${draft.source}`}>{SOURCES[draft.source]}</span>
    </li>
  );
}

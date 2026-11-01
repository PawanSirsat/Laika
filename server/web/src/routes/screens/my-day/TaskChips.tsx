import type { CardChip } from './card-chips.ts';

export interface TaskChipsProps {
  /** The key of the card the block is on, if any. */
  readonly current: string | undefined;
  readonly general: boolean;
  readonly chips: readonly CardChip[];
  readonly busy: boolean;
  /** A card's key, or `general`. */
  readonly onPick: (card: string) => void;
}

/**
 * The suggestion chips under the task search (the owner's design, LAI-515):
 * the block's own card, the cards in progress and the day's other cards, each
 * with the reason it is offered — and *General*, for no task on purpose.
 */
export function TaskChips({ current, general, chips, busy, onPick }: TaskChipsProps) {
  return (
    <div className="editor-chips" data-task-chips>
      {chips.map((chip) => (
        <button
          key={chip.task.key}
          type="button"
          className="editor-chip"
          data-card={chip.task.key}
          aria-pressed={current === chip.task.key}
          title={chip.task.title}
          disabled={busy}
          onClick={() => {
            if (current !== chip.task.key) onPick(chip.task.key);
          }}
        >
          {chip.task.key}
          {chip.why !== undefined && <span className="editor-chip-why">{chip.why}</span>}
        </button>
      ))}
      <button
        type="button"
        className="editor-chip editor-chip-words"
        data-card="general"
        aria-pressed={general}
        title="No task, on purpose"
        disabled={busy}
        onClick={() => {
          if (!general) onPick('general');
        }}
      >
        General
      </button>
    </div>
  );
}

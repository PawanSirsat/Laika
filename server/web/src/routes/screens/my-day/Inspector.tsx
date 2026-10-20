import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getRevisions,
  type MyDay,
  type TaskRef,
  type TimeDraft,
  type TimeEntry,
  type TimeRevision,
} from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { CardLink } from './CardLink.tsx';
import { clock, duration, span } from './format.ts';
import { canChange, dayIn, dayLabel } from './my-day-derive.ts';
import type { Selection } from './Timeline.tsx';
import {
  instantOf,
  splitPoint,
  type DayLine,
  type LaneBlock,
  type Span,
} from './timeline-derive.ts';

/** A draft or an entry — the two things −/+ and the card chips act on. */
export type Held =
  | { readonly kind: 'draft'; readonly draft: TimeDraft }
  | { readonly kind: 'entry'; readonly entry: TimeEntry };

export interface InspectorActions {
  readonly confirm: (draft: TimeDraft) => void;
  readonly dismiss: (draft: TimeDraft) => void;
  /** A card's key, or `general`. */
  readonly setCard: (held: Held, card: string) => void;
  readonly step: (held: Held, by: number) => void;
  readonly split: (draft: TimeDraft) => void;
  readonly remove: (entry: TimeEntry) => void;
  readonly saveNote: (entry: TimeEntry, note: string) => void;
  readonly fill: (gap: Span) => void;
  readonly markBreak: (gap: Span) => void;
  readonly unbreak: (id: string) => void;
}

export interface InspectorProps {
  readonly view: MyDay;
  readonly line: DayLine;
  readonly selection: Selection | undefined;
  /** The chips for a block whose own card is `own`. */
  readonly chipsFor: (own: TaskRef | null) => readonly TaskRef[];
  readonly pending: string | undefined;
  readonly actions: InspectorActions;
  readonly onNavigate: (to: string) => void;
}

const COUNTS = ['prompts', 'sessions', 'commits', 'marks'] as const;

const SOURCES: Readonly<Record<TimeEntry['source'], string>> = {
  draft: 'From a draft',
  manual: 'Typed by you',
  import: 'From Solidtime',
};

const CHANGES: Readonly<Record<TimeRevision['change'], string>> = {
  created: 'Created',
  edited: 'Edited',
  deleted: 'Deleted',
};

type History =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly revisions: readonly TimeRevision[] }
  | { readonly kind: 'error'; readonly message: string };

/** The card chips, General, and a key typed for any other card. */
function CardPicker({
  current,
  general,
  chips,
  busy,
  onPick,
}: {
  readonly current: string | undefined;
  readonly general: boolean;
  readonly chips: readonly TaskRef[];
  readonly busy: boolean;
  readonly onPick: (card: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [key, setKey] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const typed = key.trim();
    if (typed === '') return;
    onPick(typed);
    setTyping(false);
    setKey('');
  };
  return (
    <>
      <div className="inspector-chips">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="myday-cardchip"
            data-card={chip.key}
            aria-pressed={current === chip.key}
            title={chip.title}
            disabled={busy}
            onClick={() => {
              if (current !== chip.key) onPick(chip.key);
            }}
          >
            {chip.key}
          </button>
        ))}
        <button
          type="button"
          className="myday-cardchip"
          data-card="general"
          aria-pressed={general}
          title="No card, on purpose"
          disabled={busy}
          onClick={() => {
            if (!general) onPick('general');
          }}
        >
          General
        </button>
        {!typing && (
          <button
            type="button"
            className="myday-linkish"
            disabled={busy}
            onClick={() => {
              setTyping(true);
            }}
          >
            Other card…
          </button>
        )}
      </div>
      {typing && (
        <form className="inspector-other" onSubmit={submit}>
          <input
            className="input"
            value={key}
            placeholder="LAI-42"
            aria-label="Another card’s key"
            // Opened by the reader's own click, so the field is where focus goes.
            autoFocus
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
          <button type="submit" className="myday-chip myday-chip-primary" disabled={busy}>
            Put it there
          </button>
          <button
            type="button"
            className="myday-chip"
            onClick={() => {
              setTyping(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </>
  );
}

function Stepper({
  minutes,
  canShorten,
  canLengthen,
  busy,
  onStep,
}: {
  readonly minutes: number;
  readonly canShorten: boolean;
  readonly canLengthen: boolean;
  readonly busy: boolean;
  readonly onStep: (by: number) => void;
}) {
  return (
    <div className="inspector-stepper">
      <button
        type="button"
        aria-label="Shorter by 5 minutes"
        disabled={busy || !canShorten}
        onClick={() => {
          onStep(-5);
        }}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span className="inspector-length" aria-live="polite">
        {duration(minutes)}
      </span>
      <button
        type="button"
        aria-label="Longer by 5 minutes"
        disabled={busy || !canLengthen}
        onClick={() => {
          onStep(5);
        }}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/**
 * The selected block, in full (LAI-831, the owner's design): beside the day
 * and its lists, everything there is to do to one block in one place.
 *
 * - **Drafted**: when, where it came from, *Not work* and *Confirm length* —
 *   which reads *Needs a card* and does nothing until a card or General is
 *   chosen; the card, with a warning when nothing named one or the named one
 *   is a card the reader cannot read; its length, −/+ in five minutes, and
 *   *Split in two*; and **the counts it was drafted from — never what was
 *   typed, a file name or a commit message**, which the server never has.
 * - **Confirmed**: when, from where, its revision; *Delete*, its card and its
 *   length, every edit kept as a revision (one from Solidtime is changed
 *   there).
 * - **A gap**: add time into it, or mark it a break (CHIEF's addition D).
 * - **A break**: not time, and not a gap; *Not a break* counts it again.
 */
export function Inspector({
  view,
  line,
  selection,
  chipsFor,
  pending,
  actions,
  onNavigate,
}: InspectorProps) {
  const [history, setHistory] = useState<History>({ kind: 'closed' });
  const [note, setNote] = useState<{ id: string; text: string } | undefined>(undefined);
  const busy = pending !== undefined;
  const at = (m: number): number => (line.midnight === undefined ? 0 : instantOf(line.midnight, m));
  const placed = (id: string): LaneBlock | undefined => line.blocks.find((b) => b.id === id);
  const whenOf = (item: TimeDraft | TimeEntry): string =>
    item.started_at === null || item.ended_at === null
      ? 'No set time'
      : span(item.started_at, item.ended_at, item.tz);

  if (selection?.kind === 'draft') {
    const draft = view.drafts.find((d) => d.id === selection.id);
    if (draft !== undefined) {
      const block = placed(draft.id);
      const ready = draft.task !== null || draft.project !== null || draft.general;
      const held: Held = { kind: 'draft', draft };
      const step = block === undefined ? draft.minutes : block.end - block.start;
      return (
        <section
          className="myday-card inspector"
          data-inspector="draft"
          data-inspector-for={draft.id}
          tabIndex={-1}
          aria-label="The selected drafted block"
        >
          <header className="inspector-head">
            <span className="inspector-kind inspector-kind-drafted">Drafted</span>
            <span className="inspector-range">{whenOf(draft)}</span>
            <span className="inspector-source">
              {draft.source === 'agent' ? 'Proposed by an agent' : 'From your collector'}
              {draft.note !== null && ` · “${draft.note}”`}
            </span>
            <span className="inspector-head-gap" />
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                actions.dismiss(draft);
              }}
            >
              Not work
            </button>
            <button
              type="button"
              className="myday-chip myday-chip-primary inspector-confirm"
              data-inspector-confirm
              disabled={busy || !ready}
              onClick={() => {
                actions.confirm(draft);
              }}
            >
              {pending === `confirm:${draft.id}` && <Spinner size="sm" label="Confirming" />}
              {ready ? `Confirm ${duration(draft.minutes)}` : 'Needs a card'}
            </button>
          </header>
          <div className="inspector-parts">
            <div className="inspector-part">
              <h3 className="inspector-label">Card</h3>
              {!ready && (
                <p className="inspector-warn" data-card-warning>
                  {draft.task_key === null
                    ? 'Nothing named a card. Pick one, or General if it was general work.'
                    : `${draft.task_key} was named, but it is a card you can’t read. Pick one of yours, or General.`}
                </p>
              )}
              {draft.task !== null && (
                <p className="inspector-card">
                  <CardLink task={draft.task} slug={draft.project?.slug} onNavigate={onNavigate} />
                </p>
              )}
              {draft.task === null && draft.project !== null && (
                <p className="inspector-card">{draft.project.name}</p>
              )}
              <CardPicker
                current={draft.task?.key}
                general={draft.general}
                chips={chipsFor(draft.task)}
                busy={busy}
                onPick={(card) => {
                  actions.setCard(held, card);
                }}
              />
            </div>
            <div className="inspector-part">
              <h3 className="inspector-label">Length</h3>
              <div className="inspector-row">
                <Stepper
                  minutes={draft.minutes}
                  canShorten={draft.minutes > 5 && step > 5}
                  canLengthen={block === undefined || block.end + 5 <= line.length}
                  busy={busy}
                  onStep={(by) => {
                    actions.step(held, by);
                  }}
                />
                <button
                  type="button"
                  className="myday-chip"
                  disabled={busy || block === undefined || splitPoint(block) === undefined}
                  onClick={() => {
                    actions.split(draft);
                  }}
                >
                  Split in two
                </button>
              </div>
              <p className="inspector-note">
                5-minute steps. Confirming makes this visible to your organisation.
              </p>
            </div>
            <div className="inspector-part">
              <h3 className="inspector-label">Drafted from</h3>
              <dl className="inspector-counts">
                {COUNTS.map((kind) => (
                  <div key={kind} className="inspector-count">
                    <dd data-count={kind}>{String(draft.signals[kind])}</dd>
                    <dt>{kind}</dt>
                  </div>
                ))}
              </dl>
              <p className="inspector-note">
                Counts only — never what you typed, file names or commit messages.
              </p>
            </div>
          </div>
          <p className="inspector-keys">
            <kbd className="myday-kbd">↵</kbd> confirm <kbd className="myday-kbd">G</kbd> general{' '}
            <kbd className="myday-kbd">X</kbd> not work <kbd className="myday-kbd">J</kbd>{' '}
            <kbd className="myday-kbd">K</kbd> next / prev <kbd className="myday-kbd">?</kbd> all
            keys
          </p>
        </section>
      );
    }
  }

  if (selection?.kind === 'entry') {
    const entry = view.entries.find((e) => e.id === selection.id);
    if (entry !== undefined) {
      const block = placed(entry.id);
      const changeable = canChange(entry);
      const held: Held = { kind: 'entry', entry };
      const typed = note?.id === entry.id ? note.text : (entry.note ?? '');
      const span5 = block === undefined ? entry.minutes : block.end - block.start;
      const toggleHistory = (): void => {
        if (history.kind !== 'closed') {
          setHistory({ kind: 'closed' });
          return;
        }
        setHistory({ kind: 'loading' });
        getRevisions(entry.id)
          .then(({ revisions }) => {
            setHistory({ kind: 'ready', revisions });
          })
          .catch((cause: unknown) => {
            setHistory({
              kind: 'error',
              message: cause instanceof ApiError ? cause.message : 'The history could not be read.',
            });
          });
      };
      return (
        <section
          className="myday-card inspector"
          data-inspector="entry"
          data-inspector-for={entry.id}
          tabIndex={-1}
          aria-label="The selected confirmed entry"
        >
          <header className="inspector-head">
            <span className="inspector-kind inspector-kind-confirmed">Confirmed</span>
            <span className="inspector-range">{whenOf(entry)}</span>
            <span className="inspector-source">
              {SOURCES[entry.source]} · rev {String(entry.revision)}
              {!changeable && ' · change it in Solidtime'}
            </span>
            <span className="inspector-head-gap" />
            {changeable && (
              <button
                type="button"
                className="myday-chip myday-chip-danger"
                disabled={busy}
                onClick={() => {
                  actions.remove(entry);
                }}
              >
                Delete
              </button>
            )}
          </header>
          <div className="inspector-parts">
            <div className="inspector-part">
              <h3 className="inspector-label">Card</h3>
              <p className="inspector-card">
                {entry.task !== null ? (
                  <CardLink task={entry.task} slug={entry.project?.slug} onNavigate={onNavigate} />
                ) : (
                  (entry.project?.name ?? 'General')
                )}
              </p>
              {changeable && (
                <CardPicker
                  current={entry.task?.key}
                  general={entry.task === null && entry.project === null}
                  chips={chipsFor(entry.task)}
                  busy={busy}
                  onPick={(card) => {
                    actions.setCard(held, card);
                  }}
                />
              )}
            </div>
            <div className="inspector-part">
              <h3 className="inspector-label">Length</h3>
              {changeable ? (
                <Stepper
                  minutes={entry.minutes}
                  canShorten={entry.minutes > 5 && span5 > 5}
                  canLengthen={block === undefined || block.end + 5 <= line.length}
                  busy={busy}
                  onStep={(by) => {
                    actions.step(held, by);
                  }}
                />
              ) : (
                <p className="inspector-length">{duration(entry.minutes)}</p>
              )}
              <p className="inspector-note">
                Every edit is kept as a revision.{' '}
                <button
                  type="button"
                  className="myday-linkish"
                  aria-expanded={history.kind !== 'closed'}
                  onClick={toggleHistory}
                >
                  {history.kind === 'closed' ? 'History' : 'Hide history'}
                </button>
              </p>
              {history.kind === 'loading' && <Spinner size="sm" label="Reading the history" />}
              {history.kind === 'error' && <p className="myday-error">{history.message}</p>}
              {history.kind === 'ready' && (
                <ol className="myday-history" aria-label="Revisions">
                  {history.revisions.map((r) => (
                    <li key={r.revision}>
                      <span className="myday-history-n">{String(r.revision)}</span>
                      {CHANGES[r.change]} · {duration(r.minutes)} ·{' '}
                      <time dateTime={new Date(r.created_at).toISOString()}>
                        {dayLabel(dayIn(view.tz, r.created_at))} {clock(r.created_at, view.tz)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {changeable && (
              <form
                className="inspector-part"
                onSubmit={(event) => {
                  event.preventDefault();
                  actions.saveNote(entry, typed);
                }}
              >
                <h3 className="inspector-label">
                  <label htmlFor="inspector-note-field">Note</label>
                </h3>
                <input
                  id="inspector-note-field"
                  className="input"
                  value={typed}
                  maxLength={280}
                  placeholder="A note on it"
                  onChange={(event) => {
                    setNote({ id: entry.id, text: event.target.value });
                  }}
                />
                <div className="inspector-row">
                  <button
                    type="submit"
                    className="myday-chip"
                    disabled={busy || typed.trim() === (entry.note ?? '')}
                  >
                    Save note
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      );
    }
  }

  if (selection?.kind === 'gap') {
    const gap: Span = { start: selection.start, end: selection.end };
    return (
      <section
        className="myday-card inspector"
        data-inspector="gap"
        data-inspector-for={`gap-${String(gap.start)}`}
        tabIndex={-1}
        aria-label="The picked gap"
      >
        <header className="inspector-head">
          <span className="inspector-kind inspector-kind-gap">Gap</span>
          <span className="inspector-range">{span(at(gap.start), at(gap.end), view.tz)}</span>
          <span className="inspector-source">
            {duration(gap.end - gap.start)} nothing on your day covers
          </span>
          <span className="inspector-head-gap" />
          <button
            type="button"
            className="myday-chip"
            disabled={busy}
            onClick={() => {
              actions.markBreak(gap);
            }}
          >
            Mark as break
          </button>
          <button
            type="button"
            className="myday-chip myday-chip-primary"
            onClick={() => {
              actions.fill(gap);
            }}
          >
            Add time here
          </button>
        </header>
        <p className="inspector-note inspector-pad">
          Say what it was under Add time, or mark it a break: a break is not time, and stops
          counting as a gap.
        </p>
      </section>
    );
  }

  if (selection?.kind === 'break') {
    const b = line.breaks.find((x) => x.id === selection.id);
    if (b !== undefined) {
      return (
        <section
          className="myday-card inspector"
          data-inspector="break"
          data-inspector-for={b.id}
          tabIndex={-1}
          aria-label="The picked break"
        >
          <header className="inspector-head">
            <span className="inspector-kind inspector-kind-break">Break</span>
            <span className="inspector-range">{span(at(b.start), at(b.end), view.tz)}</span>
            <span className="inspector-source">not time, and not a gap</span>
            <span className="inspector-head-gap" />
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                actions.unbreak(b.id);
              }}
            >
              Not a break
            </button>
          </header>
        </section>
      );
    }
  }

  return (
    <section className="myday-card inspector" data-inspector="none" aria-label="Nothing selected">
      <p className="inspector-empty">
        <strong>Nothing selected</strong>{' '}
        <span className="myday-quiet">
          Pick a block on the day, or a row below, to review it here.
        </span>
      </p>
    </section>
  );
}

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
import { folderOf, needsACard } from './folder.ts';
import { agentDuration, clock, duration, span } from './format.ts';
import { canChange, dayIn, dayLabel, minutesUnderstood, parseMinutes } from './my-day-derive.ts';
import type { Selection } from './Timeline.tsx';
import {
  instantOf,
  limitsIn,
  splitPoint,
  stepEnd,
  stepMinutes,
  type DayLine,
  type LaneBlock,
  type Span,
} from './timeline-derive.ts';
import { Understood } from './Understood.tsx';

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
  /** A length typed for the block (review round 1, LAI-830's parser). */
  readonly setLength: (held: Held, minutes: number) => void;
  readonly split: (draft: TimeDraft) => void;
  readonly remove: (entry: TimeEntry) => void;
  readonly saveNote: (entry: TimeEntry, note: string) => void;
  readonly fill: (gap: Span) => void;
  readonly markBreak: (gap: Span) => void;
  readonly unbreak: (id: string) => void;
}

/** How long the agent worked inside a span, and on how many runs (LAI-883). */
export interface AgentsIn {
  readonly seconds: number;
  readonly onCardSeconds: number;
  readonly runs: number;
}

export interface InspectorProps {
  readonly view: MyDay;
  readonly line: DayLine;
  readonly selection: Selection | undefined;
  /** The chips for a block whose own card is `own`. */
  readonly chipsFor: (own: TaskRef | null) => readonly TaskRef[];
  /** The AGENTS lane inside a span — the editor's fourth tile and its line. */
  readonly agentsIn?: (span: Span) => AgentsIn;
  readonly pending: string | undefined;
  readonly actions: InspectorActions;
  readonly onNavigate: (to: string) => void;
}

/** The tiles under *Drafted from*, in the design's order; *agents* is the lane's. */
const COUNTS = ['prompts', 'commits', 'marks'] as const;

/** The design's glyph for each kind, as the Timeline draws it. */
const ICONS = { drafted: '✎', needs: '?', confirmed: '✓', gap: '+', break: '‖' } as const;

const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** What the agent did inside a block, in one line — minutes, never what it typed. */
function agentLine(during: AgentsIn | undefined): string {
  if (during === undefined || during.runs === 0) {
    return 'No agent ran in this time. Counts only, never what you typed.';
  }
  const worked = agentDuration(agentMinutes(during.seconds));
  const onCard =
    during.onCardSeconds > 0
      ? `, ${agentDuration(agentMinutes(during.onCardSeconds))} of it on a card`
      : ', on no card';
  return `During this time an agent worked ${worked}${onCard}. Counts only, never what you typed.`;
}

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

/**
 * A length typed for the block (review round 1): LAI-830's parser — `45`,
 * `45m`, `1h 30m`, `1:30` — and its *Reads as …* line under the field before
 * anything is saved. Enter sets it.
 */
function LengthField({
  minutes,
  busy,
  onSet,
}: {
  readonly minutes: number;
  readonly busy: boolean;
  readonly onSet: (minutes: number) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      className="inspector-length-form"
      onSubmit={(event) => {
        event.preventDefault();
        const read = parseMinutes(text);
        if (read === undefined) {
          setError('A length as 45, 45m, 1h 30m or 1:30 — up to a day.');
          return;
        }
        setError(undefined);
        if (read !== minutes) onSet(read);
        setText('');
      }}
    >
      <input
        className="input inspector-length-input"
        value={text}
        placeholder={duration(minutes)}
        aria-label="Length, typed"
        disabled={busy}
        onChange={(event) => {
          setText(event.target.value);
          setError(undefined);
        }}
      />
      <button type="submit" className="myday-chip" disabled={busy || text.trim() === ''}>
        Set
      </button>
      <Understood text={minutesUnderstood(text)} />
      {error !== undefined && (
        <p className="myday-error" role="alert">
          {error}
        </p>
      )}
    </form>
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
  agentsIn,
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
      // −/+ only where there is room: a step of span, and never into confirmed time.
      const hi = block === undefined ? undefined : limitsIn(line, block).hi;
      return (
        <section
          className="myday-card inspector"
          data-inspector="draft"
          data-inspector-for={draft.id}
          tabIndex={-1}
          aria-label="The selected drafted block"
        >
          <header className="inspector-head">
            <span
              className={
                ready
                  ? 'inspector-kind inspector-kind-drafted'
                  : 'inspector-kind inspector-kind-needs'
              }
            >
              <span className="inspector-kind-icon" aria-hidden="true">
                {ready ? ICONS.drafted : ICONS.needs}
              </span>
              {ready ? 'Drafted' : 'Needs a card'}
            </span>
            <span className="inspector-range">{whenOf(draft)}</span>
            <span className="inspector-source">
              {draft.source === 'agent' ? 'Proposed by an agent' : 'From your collector'} · only you
              see it
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
                  {draft.task_key !== null
                    ? `${draft.task_key} was named, but it is a card you can’t read. Pick one of yours, or General.`
                    : draft.folder !== undefined && draft.folder !== null
                      ? `${needsACard(draft)}. Pick one, or General if it was general work.`
                      : 'Nothing named a card. Pick one, or General if it was general work.'}
                </p>
              )}
              {draft.task !== null && (
                <p className="inspector-card">
                  <CardLink task={draft.task} slug={draft.project?.slug} onNavigate={onNavigate} />
                </p>
              )}
              {draft.task === null && draft.project !== null && (
                <p className="inspector-card">
                  {draft.project.name}
                  {draft.folder !== undefined && draft.folder !== null && ` · ${draft.folder}`}
                </p>
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
                  canShorten={
                    block === undefined
                      ? stepMinutes(draft.minutes, -5) !== undefined
                      : stepEnd(block, -5) !== undefined
                  }
                  canLengthen={
                    block === undefined
                      ? stepMinutes(draft.minutes, 5) !== undefined
                      : stepEnd(block, 5, hi) !== undefined
                  }
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
              <LengthField
                minutes={draft.minutes}
                busy={busy}
                onSet={(minutes) => {
                  actions.setLength(held, minutes);
                }}
              />
              <p className="inspector-note">
                5-minute steps, or type a length. Confirming makes this visible to your
                organisation.
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
                <div className="inspector-count">
                  <dd data-count="agents">
                    {String(block === undefined ? 0 : (agentsIn?.(block).runs ?? 0))}
                  </dd>
                  <dt>agents</dt>
                </div>
              </dl>
              {folderOf(draft) !== undefined && (
                <p className="inspector-card" data-drafted-folder>
                  {folderOf(draft)}
                </p>
              )}
              <p className="inspector-note" data-agent-line>
                {agentLine(block === undefined ? undefined : agentsIn?.(block))}
              </p>
              <p className="inspector-note">
                {folderOf(draft) === undefined
                  ? 'Counts only — never what you typed, file names or commit messages.'
                  : draft.branch !== undefined && draft.branch !== null
                    ? 'Counts, the name you gave this folder and its branch — never what you typed, file names or commit messages.'
                    : 'Counts and the name you gave this folder — never what you typed, file names or commit messages.'}
              </p>
            </div>
          </div>
          <p className="inspector-keys">
            <kbd className="myday-kbd">↵</kbd> confirm <kbd className="myday-kbd">G</kbd> general{' '}
            <kbd className="myday-kbd">X</kbd> not work <kbd className="myday-kbd">← →</kbd> move on
            the timeline <kbd className="myday-kbd">J</kbd> <kbd className="myday-kbd">K</kbd> move
            in the list <kbd className="myday-kbd">?</kbd> all keys
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
      const hi = block === undefined ? undefined : limitsIn(line, block).hi;
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
            <span className="inspector-kind inspector-kind-confirmed">
              <span className="inspector-kind-icon" aria-hidden="true">
                {ICONS.confirmed}
              </span>
              Confirmed
            </span>
            <span className="inspector-range">{whenOf(entry)}</span>
            <span className="inspector-source">
              {SOURCES[entry.source]} · others can see it · rev {String(entry.revision)}
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
                {folderOf(entry) !== undefined && (
                  <span data-entry-folder>{` · ${folderOf(entry) ?? ''}`}</span>
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
                <>
                  <Stepper
                    minutes={entry.minutes}
                    canShorten={
                      block === undefined
                        ? stepMinutes(entry.minutes, -5) !== undefined
                        : stepEnd(block, -5) !== undefined
                    }
                    canLengthen={
                      block === undefined
                        ? stepMinutes(entry.minutes, 5) !== undefined
                        : stepEnd(block, 5, hi) !== undefined
                    }
                    busy={busy}
                    onStep={(by) => {
                      actions.step(held, by);
                    }}
                  />
                  <LengthField
                    minutes={entry.minutes}
                    busy={busy}
                    onSet={(minutes) => {
                      actions.setLength(held, minutes);
                    }}
                  />
                </>
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
            {block !== undefined && agentsIn !== undefined && (
              <div className="inspector-part">
                <h3 className="inspector-label">Built from</h3>
                <dl className="inspector-counts inspector-counts-one">
                  <div className="inspector-count">
                    <dd data-count="agents">{String(agentsIn(block).runs)}</dd>
                    <dt>agents</dt>
                  </div>
                </dl>
                <p className="inspector-note" data-agent-line>
                  {agentLine(agentsIn(block))}
                </p>
              </div>
            )}
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
          <span className="inspector-kind inspector-kind-gap">
            <span className="inspector-kind-icon" aria-hidden="true">
              {ICONS.gap}
            </span>
            Gap
          </span>
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
            <span className="inspector-kind inspector-kind-break">
              <span className="inspector-kind-icon" aria-hidden="true">
                {ICONS.break}
              </span>
              Break
            </span>
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
          Pick a block on the timeline, or a row below, to edit it here.
        </span>
      </p>
    </section>
  );
}

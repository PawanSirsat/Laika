import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getRevisions,
  type MyDay,
  type TaskRef,
  type TimeDraft,
  type TimeEntry,
  type TimeRevision,
  type EntryKind,
  type NewEntry,
} from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { CardLink } from './CardLink.tsx';
import { folderOf, needsACard } from './folder.ts';
import { agentDuration, clock, duration, span } from './format.ts';
import { canChange, dayIn, dayLabel } from './my-day-derive.ts';
import type { Selection } from './Timeline.tsx';
import {
  instantOf,
  limitsIn,
  splitPoint,
  type DayLine,
  type LaneBlock,
  type Span,
  freeAround,
  stepEnd,
  stepMinutes,
} from './timeline-derive.ts';
import { EditorWhen } from './EditorWhen.tsx';
import { KINDS } from './entry-kinds.ts';
import { TaskSearch } from './TaskSearch.tsx';
import { splitAt, splitUnderstood } from './my-day-derive.ts';
import { NewEntryPanel } from './NewEntryPanel.tsx';

/** A draft or an entry — the two things −/+ and the card chips act on. */
export type Held =
  | { readonly kind: 'draft'; readonly draft: TimeDraft }
  | { readonly kind: 'entry'; readonly entry: TimeEntry };

/** What a draft was, said before its confirm (LAI-504): the entry's three words. */
export interface DraftSaid {
  readonly kind?: EntryKind | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

export interface InspectorActions {
  readonly confirm: (draft: TimeDraft, said?: DraftSaid) => void;
  /** A span typed in the editor (LAI-504): minutes after midnight. */
  readonly setSpan: (held: Held, span: { readonly start: number; readonly end: number }) => void;
  /** A split at a typed instant (LAI-504), unix ms. */
  readonly splitAt: (draft: TimeDraft, at: number) => void;
  readonly dismiss: (draft: TimeDraft) => void;
  /** A card's key, or `general`. */
  readonly setCard: (held: Held, card: string) => void;
  readonly step: (held: Held, by: number) => void;
  /** A length typed for the block (review round 1, LAI-830's parser). */
  readonly setLength: (held: Held, minutes: number) => void;
  readonly split: (draft: TimeDraft) => void;
  readonly remove: (entry: TimeEntry) => void;
  readonly saveNote: (entry: TimeEntry, note: string) => void;
  /** A new entry for a range dragged on the Timeline, or a gap (LAI-897). */
  readonly add: (entry: NewEntry, label: string) => Promise<boolean>;
  /** Let go of a picked range. */
  readonly letGo: () => void;
  readonly setKind: (entry: TimeEntry, kind: EntryKind | null) => void;
  readonly saveDetails: (
    entry: TimeEntry,
    details: { title: string; description: string; note: string },
  ) => void;
  readonly markBreak: (gap: Span) => void;
  readonly unbreak: (id: string) => void;
}

/** How long the agent worked inside a span, and on how many runs (LAI-888). */
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
  /**
   * Somebody else's day, read (D-102 rule 4, LAI-959): what the block is and
   * nothing to change it with — no confirm, card, length, split, note,
   * delete, break or history (the history is a `/me` read of the reader's
   * own entries).
   */
  readonly readOnly?: boolean;
  /** Where the block stands among the drafts, for the head's ‹ n of N › (LAI-504). */
  readonly position?: { readonly index: number; readonly total: number } | undefined;
  readonly onPrev?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

/** The tiles under *Drafted from*, in the design's order; *agents* is the lane's. */
const COUNTS = ['prompts', 'commits', 'marks'] as const;

/** The design's glyph for each kind, as the Timeline draws it. */
const ICONS = { drafted: '✎', needs: '?', confirmed: '✓', gap: '+', break: '‖' } as const;

const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** What the agent did inside a block, in one line — minutes, never what it typed. */
function agentLine(during: AgentsIn | undefined, who: 'you' | 'they' = 'you'): string {
  if (during === undefined || during.runs === 0) {
    return `No agent ran in this time. Counts only, never what ${who} typed.`;
  }
  const worked = agentDuration(agentMinutes(during.seconds));
  const onCard =
    during.onCardSeconds > 0
      ? `, ${agentDuration(agentMinutes(during.onCardSeconds))} of it on a card`
      : ', on no card';
  return `During this time an agent worked ${worked}${onCard}. Counts only, never what ${who} typed.`;
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

/**
 * The editor's head (the owner's design, LAI-504): the pill, ‹ n of N › for a
 * draft, and the close.
 */
function EditorHead({
  pill,
  pillClass,
  icon,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  readonly pill: string;
  readonly pillClass: string;
  readonly icon: string;
  readonly position?: { readonly index: number; readonly total: number } | undefined;
  readonly onPrev?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}) {
  return (
    <header className="inspector-head">
      <span className={`inspector-kind ${pillClass}`}>
        <span className="inspector-kind-icon" aria-hidden="true">
          {icon}
        </span>
        {pill}
      </span>
      <span className="inspector-head-gap" />
      {position !== undefined && (
        <span className="inspector-nav">
          <span className="myday-quiet" data-inspector-position>
            {String(position.index + 1)} of {String(position.total)}
          </span>
          <button
            type="button"
            className="myday-week-step"
            aria-label="Previous to review (K)"
            onClick={onPrev}
          >
            ‹
          </button>
          <button
            type="button"
            className="myday-week-step"
            aria-label="Next to review (J)"
            onClick={onNext}
          >
            ›
          </button>
        </span>
      )}
      {onClose !== undefined && (
        <button
          type="button"
          className="myday-week-step inspector-close"
          aria-label="Close (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      )}
    </header>
  );
}

/** The card chips, General, and a key typed for any other card. */
export function CardPicker({
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

export function Stepper({
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
  readOnly = false,
  position,
  onPrev,
  onNext,
  onClose,
}: InspectorProps) {
  const [history, setHistory] = useState<History>({ kind: 'closed' });
  /** What a draft was, typed before its confirm (LAI-504). */
  const [draftWords, setDraftWords] = useState<
    { id: string; kind: EntryKind | undefined; title: string; description: string } | undefined
  >(undefined);
  /** *Split…*: the time typed, for the draft it is open on. */
  const [splitting, setSplitting] = useState<{ id: string; text: string } | undefined>(undefined);
  const [note, setNote] = useState<{ id: string; text: string } | undefined>(undefined);
  /** The gap whose *Add time here* opened the new-entry panel (LAI-897). */
  const [adding, setAdding] = useState<number | undefined>(undefined);
  const [details, setDetails] = useState<
    { id: string; title: string; description: string } | undefined
  >(undefined);
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
      const limits =
        block === undefined ? { lo: line.from * 60, hi: line.to * 60 } : limitsIn(line, block);
      const spanOf = block === undefined ? undefined : { start: block.start, end: block.end };
      const words =
        draftWords?.id === draft.id
          ? draftWords
          : { id: draft.id, kind: undefined, title: '', description: '' };
      const said: DraftSaid = {
        ...(words.kind === undefined ? {} : { kind: words.kind }),
        ...(words.title.trim() === '' ? {} : { title: words.title }),
        ...(words.description.trim() === '' ? {} : { description: words.description }),
      };
      const splitText = splitting?.id === draft.id ? splitting.text : undefined;
      const splitInstant = splitText === undefined ? undefined : splitAt(draft, splitText);
      const name = draft.task?.title ?? draft.project?.name ?? (ready ? 'General' : 'No task yet');
      return (
        <section
          className="myday-card inspector"
          data-inspector="draft"
          data-inspector-for={draft.id}
          tabIndex={-1}
          aria-label="The selected drafted block"
        >
          <EditorHead
            pill={ready ? 'Draft' : 'No task yet'}
            pillClass={ready ? 'inspector-kind-drafted' : 'inspector-kind-needs'}
            icon={ready ? ICONS.drafted : ICONS.needs}
            position={position}
            onPrev={onPrev}
            onNext={onNext}
            onClose={onClose}
          />
          <div className="inspector-title">
            {draft.task !== null && <span className="inspector-key">{draft.task.key}</span>}
            <span className="inspector-name">{name}</span>
          </div>
          <p className="inspector-source">
            {whenOf(draft)} · {duration(draft.minutes)} ·{' '}
            {draft.source === 'agent' ? 'proposed by an agent' : 'drafted by your collector'} ·{' '}
            {readOnly ? 'not confirmed' : 'only you and the owners see it'}
            {draft.note !== null && ` · “${draft.note}”`}
          </p>
          <div className="inspector-body">
            <section className="inspector-part">
              <h3 className="inspector-label">When</h3>
              <EditorWhen
                span={spanOf}
                minutes={draft.minutes}
                midnight={line.midnight}
                tz={view.tz}
                limits={limits}
                busy={busy}
                readOnly={readOnly}
                onSpan={(next) => {
                  actions.setSpan(held, next);
                }}
                onLength={(minutes) => {
                  actions.setLength(held, minutes);
                }}
              />
              {!readOnly && (
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
                      : stepEnd(block, 5, limits.hi) !== undefined
                  }
                  busy={busy}
                  onStep={(by) => {
                    actions.step(held, by);
                  }}
                />
              )}
            </section>
            <section className="inspector-part">
              <h3 className="inspector-label">Task</h3>
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
              {draft.general && draft.task === null && draft.project === null && (
                <p className="inspector-card">General</p>
              )}
              {!ready && (
                <p className={readOnly ? 'inspector-card' : 'inspector-warn'} data-card-warning>
                  {draft.task_key !== null
                    ? `${draft.task_key} was named — a card you can’t read.`
                    : draft.folder !== undefined && draft.folder !== null
                      ? `${needsACard(draft)}.`
                      : 'Nothing named a task.'}
                  {!readOnly && ' Pick one, or General if it was general work.'}
                </p>
              )}
              {!readOnly && (
                <>
                  <TaskSearch
                    busy={busy}
                    onPick={(card) => {
                      actions.setCard(held, card);
                    }}
                  />
                  <CardPicker
                    current={draft.task?.key}
                    general={draft.general}
                    chips={chipsFor(draft.task)}
                    busy={busy}
                    onPick={(card) => {
                      actions.setCard(held, card);
                    }}
                  />
                </>
              )}
            </section>
            {!readOnly && (
              <section className="inspector-part" data-draft-words>
                <h3 className="inspector-label">Kind</h3>
                <div className="myday-kinds" role="group" aria-label="Kind">
                  {KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className="myday-kind"
                      data-kind-pick={k.kind}
                      aria-pressed={words.kind === k.kind}
                      disabled={busy}
                      onClick={() => {
                        setDraftWords({
                          ...words,
                          kind: words.kind === k.kind ? undefined : k.kind,
                        });
                      }}
                    >
                      <span className="myday-kind-glyph" aria-hidden="true">
                        {k.glyph}
                      </span>
                      {k.label}
                    </button>
                  ))}
                </div>
                <h3 className="inspector-label">What it was</h3>
                <input
                  className="input"
                  data-draft-title
                  value={words.title}
                  maxLength={120}
                  placeholder="A name for it — optional"
                  aria-label="Title"
                  disabled={busy}
                  onChange={(event) => {
                    setDraftWords({ ...words, title: event.target.value });
                  }}
                />
                <textarea
                  className="input myday-textarea"
                  data-draft-description
                  rows={2}
                  value={words.description}
                  maxLength={2000}
                  placeholder="Add a description (optional)"
                  aria-label="Description"
                  disabled={busy}
                  onChange={(event) => {
                    setDraftWords({ ...words, description: event.target.value });
                  }}
                />
                <p className="inspector-note">Saved with the entry when you confirm.</p>
              </section>
            )}
            <section className="inspector-part">
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
                {agentLine(
                  block === undefined ? undefined : agentsIn?.(block),
                  readOnly ? 'they' : 'you',
                )}
              </p>
              <p className="inspector-note">
                {readOnly
                  ? 'Counts only — never what they typed, file names or commit messages.'
                  : folderOf(draft) === undefined
                    ? 'Counts only — never what you typed, file names or commit messages.'
                    : draft.branch !== undefined && draft.branch !== null
                      ? 'Counts, the name you gave this folder and its branch — never what you typed, file names or commit messages.'
                      : 'Counts and the name you gave this folder — never what you typed, file names or commit messages.'}
              </p>
            </section>
            {splitText !== undefined && block !== undefined && (
              <section className="inspector-part" data-split>
                <h3 className="inspector-label">Split</h3>
                <div className="inspector-row">
                  <label className="myday-when-field">
                    <span className="myday-when-label">Split at</span>
                    <input
                      className="input myday-when-input"
                      value={splitText}
                      aria-label="Split at time"
                      data-split-at
                      // Opened by the reader's own click, so the field is where focus goes.
                      autoFocus
                      disabled={busy}
                      onChange={(event) => {
                        setSplitting({ id: draft.id, text: event.target.value });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="myday-chip myday-chip-primary"
                    data-split-go
                    disabled={busy || splitInstant === undefined}
                    onClick={() => {
                      if (splitInstant !== undefined) {
                        actions.splitAt(draft, splitInstant);
                        setSplitting(undefined);
                      }
                    }}
                  >
                    Split
                  </button>
                  <button
                    type="button"
                    className="myday-chip"
                    onClick={() => {
                      setSplitting(undefined);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <p className="inspector-note" data-split-hint>
                  {splitUnderstood(draft, splitText) ??
                    `Pick a time between ${clock(at(block.start + 5), view.tz)} and ${clock(at(block.end - 5), view.tz)}. Both halves stay drafts.`}
                </p>
              </section>
            )}
          </div>
          {!readOnly && (
            <footer className="inspector-foot">
              <button
                type="button"
                className="myday-chip myday-chip-primary inspector-confirm"
                data-inspector-confirm
                disabled={busy || !ready}
                onClick={() => {
                  actions.confirm(draft, said);
                }}
              >
                {pending === `confirm:${draft.id}` && <Spinner size="sm" label="Confirming" />}
                {ready ? `Confirm ${duration(draft.minutes)}` : 'Needs a card'}
              </button>
              <kbd className="myday-kbd" title="Enter confirms">
                ↵
              </kbd>
              <button
                type="button"
                className="myday-chip"
                aria-label="Split in two"
                disabled={busy || block === undefined || splitPoint(block) === undefined}
                onClick={() => {
                  const middle = block === undefined ? undefined : splitPoint(block);
                  if (middle !== undefined) {
                    setSplitting({ id: draft.id, text: clock(at(middle), view.tz) });
                  }
                }}
              >
                Split…
              </button>
              <button
                type="button"
                className="myday-chip"
                disabled={busy}
                onClick={() => {
                  actions.dismiss(draft);
                }}
              >
                Not work time
              </button>
              <span className="inspector-head-gap" />
              <span className="inspector-keys-hint">
                <kbd className="myday-kbd">?</kbd> all keys
              </span>
            </footer>
          )}
        </section>
      );
    }
  }

  if (selection?.kind === 'entry') {
    const entry = view.entries.find((e) => e.id === selection.id);
    if (entry !== undefined) {
      const block = placed(entry.id);
      const changeable = !readOnly && canChange(entry);
      const held: Held = { kind: 'entry', entry };
      const typed = note?.id === entry.id ? note.text : (entry.note ?? '');
      const said =
        details?.id === entry.id
          ? details
          : { id: entry.id, title: entry.title ?? '', description: entry.description ?? '' };
      const unchanged =
        typed.trim() === (entry.note ?? '') &&
        said.title.trim() === (entry.title ?? '') &&
        said.description.trim() === (entry.description ?? '');
      const limits =
        block === undefined ? { lo: line.from * 60, hi: line.to * 60 } : limitsIn(line, block);
      const spanOf = block === undefined ? undefined : { start: block.start, end: block.end };
      const name = entry.title ?? entry.task?.title ?? entry.project?.name ?? 'General';
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
      const saveWords = (): void => {
        actions.saveDetails(entry, {
          title: said.title,
          description: said.description,
          note: typed,
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
          <EditorHead
            pill={entry.source === 'import' ? 'Imported' : 'Confirmed'}
            pillClass="inspector-kind-confirmed"
            icon={ICONS.confirmed}
            onClose={onClose}
          />
          <div className="inspector-title">
            {entry.task !== null && <span className="inspector-key">{entry.task.key}</span>}
            <span className="inspector-name">{name}</span>
          </div>
          <p className="inspector-source">
            {whenOf(entry)} · {duration(entry.minutes)} ·{' '}
            {readOnly ? SOURCES[entry.source].replace('by you', 'by them') : SOURCES[entry.source]}{' '}
            · others can see it · rev {String(entry.revision)}
            {!readOnly && !changeable && ' · change it in Solidtime'}
          </p>
          <div className="inspector-body">
            <section className="inspector-part">
              <h3 className="inspector-label">When</h3>
              <EditorWhen
                span={spanOf}
                minutes={entry.minutes}
                midnight={line.midnight}
                tz={view.tz}
                limits={limits}
                busy={busy}
                readOnly={!changeable}
                onSpan={(next) => {
                  actions.setSpan(held, next);
                }}
                onLength={(minutes) => {
                  actions.setLength(held, minutes);
                }}
              />
              {changeable && (
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
                      : stepEnd(block, 5, limits.hi) !== undefined
                  }
                  busy={busy}
                  onStep={(by) => {
                    actions.step(held, by);
                  }}
                />
              )}
              {!readOnly && (
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
              )}
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
            </section>
            <section className="inspector-part">
              <h3 className="inspector-label">Task</h3>
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
                <>
                  <TaskSearch
                    busy={busy}
                    onPick={(card) => {
                      actions.setCard(held, card);
                    }}
                  />
                  <CardPicker
                    current={entry.task?.key}
                    general={entry.task === null && entry.project === null}
                    chips={chipsFor(entry.task)}
                    busy={busy}
                    onPick={(card) => {
                      actions.setCard(held, card);
                    }}
                  />
                </>
              )}
            </section>
            {block !== undefined && agentsIn !== undefined && (
              <section className="inspector-part">
                <h3 className="inspector-label">Built from</h3>
                <dl className="inspector-counts inspector-counts-one">
                  <div className="inspector-count">
                    <dd data-count="agents">{String(agentsIn(block).runs)}</dd>
                    <dt>agents</dt>
                  </div>
                </dl>
                <p className="inspector-note" data-agent-line>
                  {agentLine(agentsIn(block), readOnly ? 'they' : 'you')}
                </p>
              </section>
            )}
            {changeable && (
              <form
                className="inspector-part"
                data-entry-details
                onSubmit={(event) => {
                  event.preventDefault();
                  saveWords();
                }}
              >
                <h3 className="inspector-label">Kind</h3>
                {/* The kind saves on its own press (LAI-897); the words below, on Save. */}
                <div className="myday-kinds" role="group" aria-label="Kind">
                  {KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className="myday-kind"
                      data-kind-pick={k.kind}
                      aria-pressed={entry.kind === k.kind}
                      disabled={busy}
                      onClick={() => {
                        actions.setKind(entry, entry.kind === k.kind ? null : k.kind);
                      }}
                    >
                      <span className="myday-kind-glyph" aria-hidden="true">
                        {k.glyph}
                      </span>
                      {k.label}
                    </button>
                  ))}
                </div>
                <h3 className="inspector-label">What it was</h3>
                <label className="myday-field">
                  <span className="myday-field-label">Title</span>
                  <input
                    id="inspector-title-field"
                    className="input"
                    data-entry-title
                    value={said.title}
                    maxLength={120}
                    placeholder="A name for it"
                    onChange={(event) => {
                      setDetails({ ...said, title: event.target.value });
                    }}
                  />
                </label>
                <label className="myday-field">
                  <span className="myday-field-label">Description</span>
                  <textarea
                    id="inspector-description-field"
                    className="input myday-textarea"
                    data-entry-description
                    rows={2}
                    value={said.description}
                    maxLength={2000}
                    placeholder="What happened, in your words"
                    onChange={(event) => {
                      setDetails({ ...said, description: event.target.value });
                    }}
                  />
                </label>
                <label className="myday-field">
                  <span className="myday-field-label">Note</span>
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
                </label>
                <div className="inspector-row">
                  <button type="submit" className="myday-chip" disabled={busy || unchanged}>
                    Save
                  </button>
                </div>
              </form>
            )}
          </div>
          {changeable && (
            <footer className="inspector-foot">
              <button
                type="button"
                className="myday-chip myday-chip-primary"
                disabled={busy || unchanged}
                onClick={saveWords}
              >
                Save
              </button>
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
              <span className="inspector-head-gap" />
              <span className="inspector-keys-hint">
                <kbd className="myday-kbd">?</kbd> all keys
              </span>
            </footer>
          )}
        </section>
      );
    }
  }

  if (selection?.kind === 'range' || (selection?.kind === 'gap' && adding === selection.start)) {
    const range: Span = { start: selection.start, end: selection.end };
    const free = freeAround(
      range.start,
      line.blocks.filter((b) => b.kind === 'confirmed'),
      line.from * 60,
      line.to * 60,
    );
    return (
      <section
        className="myday-card inspector"
        data-inspector="range"
        data-inspector-for={`range-${String(range.start)}`}
        tabIndex={-1}
        aria-label="A new entry"
      >
        <EditorHead
          pill="New entry"
          pillClass="inspector-kind-gap"
          icon={ICONS.gap}
          onClose={() => {
            setAdding(undefined);
            actions.letGo();
          }}
        />
        <p className="inspector-source">confirmed as you add it</p>
        <NewEntryPanel
          view={view}
          range={range}
          untimed={selection.kind === 'range' ? selection.untimed : undefined}
          prefill={selection.kind === 'range' ? selection.prefill : undefined}
          limits={{ lo: free?.lo ?? line.from * 60, hi: free?.hi ?? line.to * 60 }}
          now={
            view.day === view.today && line.midnight !== undefined
              ? Math.floor((Date.now() - line.midnight) / 60_000 / 5) * 5
              : undefined
          }
          chips={chipsFor(null)}
          busy={busy}
          onAdd={actions.add}
          onCancel={() => {
            setAdding(undefined);
            actions.letGo();
          }}
        />
      </section>
    );
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
            {duration(gap.end - gap.start)} nothing on {readOnly ? 'their' : 'your'} day covers
          </span>
          <span className="inspector-head-gap" />
          {!readOnly && (
            <>
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
                data-gap-add
                onClick={() => {
                  setAdding(gap.start);
                }}
              >
                Add time here
              </button>
            </>
          )}
        </header>
        {!readOnly && (
          <p className="inspector-note inspector-pad">
            Add time here, and say what it was; or mark it a break: a break is not time, and stops
            counting as a gap.
          </p>
        )}
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
            {!readOnly && (
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
            )}
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
          {readOnly
            ? 'Pick a block on the timeline, or a row below, to see it here.'
            : 'Pick a block on the timeline, or a row below, to edit it here.'}
        </span>
      </p>
    </section>
  );
}

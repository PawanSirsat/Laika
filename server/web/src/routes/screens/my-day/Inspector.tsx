import { useEffect, useRef, useState } from 'react';
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
import type { CardChip, ChipWhy } from './card-chips.ts';
import { CardLink } from './CardLink.tsx';
import { EditorFrame, type EditorNav } from './EditorFrame.tsx';
import { EditorWhen, type BusySpan, type Conflict } from './EditorWhen.tsx';
import { KINDS, kindLabel } from './entry-kinds.ts';
import { folderOf, needsACard } from './folder.ts';
import { agentDuration, clock, duration, span } from './format.ts';
import { canChange, splitAt, splitUnderstood } from './my-day-derive.ts';
import { NewEntryPanel, type NewEntryFrom } from './NewEntryPanel.tsx';
import { TaskChips } from './TaskChips.tsx';
import { TaskSearch } from './TaskSearch.tsx';
import type { Selection } from './Timeline.tsx';
import {
  freeAround,
  instantOf,
  limitsIn,
  splitPoint,
  type BreakSpan,
  type DayLine,
  type LaneBlock,
  type Span,
} from './timeline-derive.ts';
import './editor.css';

/** A draft or an entry — the two things the editor's writes act on. */
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
  /** Another gap, from the gap editor's ‹ › (LAI-515). */
  readonly pickGap: (gap: Span) => void;
  /** A break turned back into work time (LAI-515): removed, and its span opens as Add time. */
  readonly workFromBreak: (b: BreakSpan) => void;
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
  /** The chips for a block whose own card is `own`, each with why it is offered. */
  readonly chipsFor: (own: TaskRef | null) => readonly CardChip[];
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
  /** Whose day, when read-only: the sub line names them. */
  readonly subject?: string | undefined;
  /** Where the block stands among the drafts, for the head's ‹ n of N › (LAI-504). */
  readonly position?: { readonly index: number; readonly total: number } | undefined;
  readonly onPrev?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  /** The entry a timer just stopped into (LAI-515): the head says so once. */
  readonly stopped?: string | undefined;
  /** The last change can be taken back: *Undo* beside *Saved ✓*. */
  readonly undo?: (() => void) | undefined;
}

/** The tiles under *Drafted from*, in the design's order; *agents* is the lane's. */
const COUNTS = ['prompts', 'commits', 'marks'] as const;

/** The design's glyph for each state, as the Timeline draws it. */
const ICONS = {
  drafted: '✎',
  needs: '?',
  confirmed: '✓',
  gap: '+',
  break: '‖',
  imported: '⇣',
} as const;

const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** What the agent did inside a block, in one line — minutes, never what it typed. */
function agentLine(during: AgentsIn | undefined, who: 'you' | 'they' = 'you'): string {
  if (during === undefined || during.runs === 0) {
    return `No agent ran in this time. Counts only — never what ${who} typed, file names or commit messages.`;
  }
  const worked = agentDuration(agentMinutes(during.seconds));
  const onCard =
    during.onCardSeconds > 0
      ? `, ${agentDuration(agentMinutes(during.onCardSeconds))} of it on a card`
      : '';
  return `During this time an agent worked ${worked}${onCard}. Counts only — never what ${who} typed, file names or commit messages.`;
}

/** What a revision did, in the design's words. */
function revisionWords(r: TimeRevision, source: TimeEntry['source'], first: boolean): string {
  if (r.change === 'deleted') return 'Deleted';
  if (r.change === 'created' || first) {
    return source === 'import'
      ? 'Imported from Solidtime'
      : source === 'manual'
        ? `Added by hand · ${duration(r.minutes)}`
        : `Confirmed · ${duration(r.minutes)}`;
  }
  return `Edited · ${duration(r.minutes)}`;
}

type History =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly revisions: readonly TimeRevision[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The editor (the owner's `MyDay.dc.html`, LAI-515; LAI-831, LAI-504): one
 * block in full, in the drawer beside the page — a head with the state pill,
 * *Saved ✓*, ‹ n of N › and ×; the title and its sub line; then WHEN, TASK,
 * KIND, WHAT IT WAS, SPLIT, DRAFTED FROM or BUILT FROM and HISTORY, in the
 * design's order; and a footer fixed at the bottom with what the block can
 * become.
 *
 * - **Drafted**: confirm it, with the kind and words typed here; split it at
 *   a time; mark it not work time; put it on a task found or offered, or on
 *   General; and **the counts it was drafted from — never what was typed, a
 *   file name or a commit message**, which the server never has.
 * - **Confirmed**: its task, kind and words, each change a revision listed
 *   under HISTORY; *Delete entry*. One from Solidtime is changed there.
 * - **A gap** fills with Add time, or becomes a break.
 * - **A break** turns back into work time, or goes.
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
  subject = 'This person',
  position,
  onPrev,
  onNext,
  onClose,
  stopped,
  undo,
}: InspectorProps) {
  const [history, setHistory] = useState<History>({ kind: 'closed' });
  /** What a draft was, typed before its confirm (LAI-504). */
  const [draftWords, setDraftWords] = useState<
    { id: string; kind: EntryKind | undefined; title: string; description: string } | undefined
  >(undefined);
  /** *Split…*: the time typed, for the draft it is open on. */
  const [splitting, setSplitting] = useState<{ id: string; text: string } | undefined>(undefined);
  const [details, setDetails] = useState<
    { id: string; title: string; description: string } | undefined
  >(undefined);
  const busy = pending !== undefined;
  const selectedId =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? selection.id
      : undefined;

  // *Saved ✓* for a few seconds after a write to the block in hand lands.
  const lastPending = useRef(pending);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const before = lastPending.current;
    lastPending.current = pending;
    if (
      before === undefined ||
      pending !== undefined ||
      selectedId === undefined ||
      !before.endsWith(`:${selectedId}`)
    ) {
      return undefined;
    }
    setSaved(true);
    const timer = setTimeout(() => {
      setSaved(false);
    }, 6_000);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, selectedId]);

  // HISTORY, read as a confirmed entry opens (a `/me` read: the reader's own).
  const entryId = selection?.kind === 'entry' ? selection.id : undefined;
  useEffect(() => {
    if (entryId === undefined || readOnly) {
      setHistory({ kind: 'closed' });
      return undefined;
    }
    let live = true;
    setHistory({ kind: 'loading' });
    getRevisions(entryId)
      .then(({ revisions }) => {
        if (live) setHistory({ kind: 'ready', revisions });
      })
      .catch((cause: unknown) => {
        if (live) {
          setHistory({
            kind: 'error',
            message: cause instanceof ApiError ? cause.message : 'The history could not be read.',
          });
        }
      });
    return () => {
      live = false;
    };
  }, [entryId, readOnly]);

  const at = (m: number): number => (line.midnight === undefined ? 0 : instantOf(line.midnight, m));
  const placed = (id: string): LaneBlock | undefined => line.blocks.find((b) => b.id === id);
  const whenOf = (item: TimeDraft | TimeEntry): string =>
    item.started_at === null || item.ended_at === null
      ? 'No set time'
      : span(item.started_at, item.ended_at, item.tz);
  /** A placed block's name, for a refusal that names what is in the way. */
  const labelOf = (b: LaneBlock): string => {
    const entry = view.entries.find((e) => e.id === b.id);
    if (entry !== undefined) {
      return entry.task?.key ?? entry.title ?? entry.project?.name ?? 'General';
    }
    const draft = view.drafts.find((d) => d.id === b.id);
    return draft?.task?.key ?? draft?.project?.name ?? 'a draft';
  };
  const keyOf = (b: LaneBlock | undefined): string | undefined =>
    b === undefined
      ? undefined
      : (view.entries.find((e) => e.id === b.id)?.task?.key ??
        view.drafts.find((d) => d.id === b.id)?.task?.key);
  const conflictsAround = (id: string | undefined): Conflict[] =>
    line.blocks
      .filter((b) => b.kind === 'confirmed' && b.id !== id)
      .map((b) => ({ start: b.start, end: b.end, label: labelOf(b) }));
  const busySpans = (): BusySpan[] =>
    line.blocks.map((b) => ({
      start: b.start,
      end: b.end,
      confirmed: b.kind === 'confirmed',
      label: labelOf(b),
    }));
  /** The chips, with *Card before* and *Card after* for the neighbours on the track. */
  const chipsAround = (own: TaskRef | null, id: string): readonly CardChip[] => {
    const ordered = [...line.blocks].sort((a, b) => a.start - b.start);
    const i = ordered.findIndex((b) => b.id === id);
    const before = i > 0 ? keyOf(ordered[i - 1]) : undefined;
    const after = i >= 0 ? keyOf(ordered[i + 1]) : undefined;
    return chipsFor(own).map((chip) => {
      const why: ChipWhy | undefined =
        chip.task.key === own?.key
          ? undefined
          : chip.task.key === before
            ? 'Card before'
            : chip.task.key === after
              ? 'Card after'
              : chip.why;
      return { task: chip.task, why };
    });
  };
  const kindChips = (
    current: EntryKind | undefined,
    canPick: boolean,
    onPick: (kind: EntryKind) => void,
  ) => (
    <div className="editor-kinds" role="radiogroup" aria-label="Kind">
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          role="radio"
          className="editor-kind"
          data-kind-pick={k.kind}
          aria-checked={current === k.kind}
          aria-pressed={current === k.kind}
          aria-disabled={canPick ? undefined : true}
          disabled={busy}
          onClick={() => {
            if (canPick) onPick(k.kind);
          }}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
  const nowMinute =
    view.day === view.today && line.midnight !== undefined
      ? Math.floor((Date.now() - line.midnight) / 60_000 / 5) * 5
      : undefined;
  const who = readOnly ? 'they' : 'you';

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
      const name =
        draft.task?.title ?? draft.project?.name ?? (draft.general ? 'General' : 'No task yet');
      const nav: EditorNav | undefined =
        position === undefined || position.total < 2 || onPrev === undefined || onNext === undefined
          ? undefined
          : {
              text: `${String(position.index + 1)} of ${String(position.total)}`,
              prevLabel: 'Previous to review (K)',
              nextLabel: 'Next to review (J)',
              onPrev,
              onNext,
            };
      const why =
        draft.task_key !== null
          ? `${draft.task_key} was named — a card you can’t read.`
          : draft.folder !== undefined && draft.folder !== null
            ? `${needsACard(draft)}.`
            : 'Nothing named a task.';
      const foot = readOnly ? undefined : (
        <>
          <button
            type="button"
            className="editor-primary inspector-confirm"
            data-inspector-confirm
            disabled={busy || !ready}
            onClick={() => {
              actions.confirm(draft, said);
            }}
          >
            {pending === `confirm:${draft.id}` && <Spinner size="sm" label="Confirming" />}
            {ready ? `Confirm ${duration(draft.minutes)}` : 'Pick a task or kind'}
            {ready && <kbd className="editor-kbd">↵</kbd>}
          </button>
          <button
            type="button"
            className="editor-act"
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
            className="editor-act"
            disabled={busy}
            onClick={() => {
              actions.dismiss(draft);
            }}
          >
            Not work time
          </button>
        </>
      );
      return (
        <EditorFrame
          kind="draft"
          forId={draft.id}
          label="The selected drafted block"
          pill={ready ? 'Draft' : 'No task yet'}
          pillClass={ready ? 'inspector-kind-drafted' : 'inspector-kind-needs'}
          icon={ready ? ICONS.drafted : ICONS.needs}
          saved={saved && !readOnly}
          onUndo={undo}
          nav={nav}
          onClose={onClose}
          keyText={draft.task?.key}
          title={name}
          sub={`${whenOf(draft)} · ${duration(draft.minutes)} · ${
            draft.source === 'agent' ? 'Proposed by an agent' : 'Drafted by your collector'
          } · ${readOnly ? `Read-only · ${subject}’s draft` : 'only you and the owners see it'}${
            draft.note !== null ? ` · “${draft.note}”` : ''
          }`}
          banner={
            readOnly
              ? 'Read-only. You can see this because you may read everyone’s day.'
              : undefined
          }
          bannerTone="blue"
          foot={foot}
        >
          <section className="editor-section">
            <h3 className="editor-label">When</h3>
            <EditorWhen
              span={spanOf}
              minutes={draft.minutes}
              midnight={line.midnight}
              tz={view.tz}
              limits={limits}
              conflicts={conflictsAround(draft.id)}
              busy={busy}
              readOnly={readOnly}
              onSpan={(next) => {
                actions.setSpan(held, next);
              }}
              onLength={(minutes) => {
                actions.setLength(held, minutes);
              }}
            />
          </section>
          <section className="editor-section">
            <h3 className="editor-label">Task</h3>
            {draft.task !== null && (
              <p className="editor-task-line inspector-card">
                <CardLink task={draft.task} slug={draft.project?.slug} onNavigate={onNavigate} />
              </p>
            )}
            {draft.task === null && draft.project !== null && (
              <p className="editor-task-line inspector-card">
                <span className="editor-task-title">
                  {draft.project.name}
                  {draft.folder !== undefined && draft.folder !== null && ` · ${draft.folder}`}
                </span>
              </p>
            )}
            {draft.general && draft.task === null && draft.project === null && (
              <p className="editor-task-line inspector-card">
                <span className="editor-task-key">No task</span>
                <span className="editor-task-title">
                  Shows as {words.kind === undefined ? 'General' : kindLabel(words.kind)} on the
                  Timeline
                </span>
              </p>
            )}
            {!ready && (
              <p className={readOnly ? 'inspector-card' : 'editor-notask'} data-card-warning>
                {readOnly ? (
                  why
                ) : (
                  <>
                    <b>No task yet.</b> {why} Pick one, or just pick a kind below.
                  </>
                )}
              </p>
            )}
            {!readOnly && (
              <>
                <TaskSearch
                  busy={busy}
                  onPick={(card) => {
                    actions.setCard(held, card);
                  }}
                  onCustom={(text) => {
                    setDraftWords({ ...words, title: text });
                    if (!draft.general) actions.setCard(held, 'general');
                  }}
                />
                <TaskChips
                  current={draft.task?.key}
                  general={draft.general}
                  chips={chipsAround(draft.task, draft.id)}
                  busy={busy}
                  onPick={(card) => {
                    actions.setCard(held, card);
                  }}
                />
              </>
            )}
          </section>
          <section className="editor-section" data-draft-words>
            <h3 className="editor-label">Kind</h3>
            {kindChips(words.kind, !readOnly, (kind) => {
              setDraftWords({ ...words, kind: words.kind === kind ? undefined : kind });
              // A kind on a draft with no task logs it as that kind, on General (the design).
              if (!ready) actions.setCard(held, 'general');
            })}
          </section>
          <section className="editor-section">
            <h3 className="editor-label">What it was</h3>
            <input
              className="input editor-input editor-words"
              data-draft-title
              value={words.title}
              maxLength={120}
              placeholder={`e.g. ${draft.task?.title ?? 'Code review for the onboarding epic'}`}
              aria-label="What it was"
              readOnly={readOnly}
              disabled={busy}
              onChange={(event) => {
                setDraftWords({ ...words, title: event.target.value });
              }}
            />
            {!readOnly && (
              <textarea
                className="input editor-textarea"
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
            )}
          </section>
          {splitText !== undefined && block !== undefined && (
            <section className="editor-section" data-split>
              <h3 className="editor-label">Split</h3>
              <div className="editor-split">
                <span>Split at</span>
                <input
                  className="input editor-input editor-split-field"
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
                <button
                  type="button"
                  className="editor-act"
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
                  className="editor-link"
                  onClick={() => {
                    setSplitting(undefined);
                  }}
                >
                  Cancel
                </button>
              </div>
              <p className="editor-hint" data-split-hint>
                {splitUnderstood(draft, splitText) ??
                  `Pick a time between ${clock(at(block.start + 5), view.tz)} and ${clock(at(block.end - 5), view.tz)}. Both halves stay drafts.`}
              </p>
            </section>
          )}
          <section className="editor-section editor-section-last">
            <h3 className="editor-label">Drafted from</h3>
            <div className="editor-tiles">
              {COUNTS.map((kind) => (
                <div key={kind} className="editor-tile">
                  <strong data-count={kind}>{String(draft.signals[kind])}</strong>
                  <span>{kind}</span>
                </div>
              ))}
              <div className="editor-tile">
                <strong data-count="agents">
                  {String(block === undefined ? 0 : (agentsIn?.(block).runs ?? 0))}
                </strong>
                <span>agents</span>
              </div>
            </div>
            {folderOf(draft) !== undefined && (
              <p className="editor-hint" data-drafted-folder>
                {folderOf(draft)}
              </p>
            )}
            <p className="editor-hint" data-agent-line>
              {agentLine(block === undefined ? undefined : agentsIn?.(block), who)}
            </p>
            {folderOf(draft) !== undefined && (
              <p className="editor-hint">
                {draft.branch !== undefined && draft.branch !== null
                  ? 'Counts, the name you gave this folder and its branch — never what you typed, file names or commit messages.'
                  : 'Counts and the name you gave this folder — never what you typed, file names or commit messages.'}
              </p>
            )}
          </section>
        </EditorFrame>
      );
    }
  }

  if (selection?.kind === 'entry') {
    const entry = view.entries.find((e) => e.id === selection.id);
    if (entry !== undefined) {
      const block = placed(entry.id);
      const imported = entry.source === 'import';
      const changeable = !readOnly && canChange(entry);
      const untimedEntry = entry.started_at === null || entry.ended_at === null;
      const held: Held = { kind: 'entry', entry };
      const said =
        details?.id === entry.id
          ? details
          : { id: entry.id, title: entry.title ?? '', description: entry.description ?? '' };
      const changed =
        said.title.trim() !== (entry.title ?? '') ||
        said.description.trim() !== (entry.description ?? '');
      const limits =
        block === undefined ? { lo: line.from * 60, hi: line.to * 60 } : limitsIn(line, block);
      const spanOf = block === undefined ? undefined : { start: block.start, end: block.end };
      const name = entry.title ?? entry.task?.title ?? entry.project?.name ?? 'General';
      const saveWords = (): void => {
        if (!changeable || !changed) return;
        actions.saveDetails(entry, {
          title: said.title,
          description: said.description,
          note: entry.note ?? '',
        });
      };
      const banner =
        stopped === entry.id
          ? `Timer stopped. ${duration(entry.minutes)} saved as confirmed time. Check the task and title, then close.`
          : imported
            ? 'This entry came from Solidtime. Change it there; the next import updates it here.'
            : readOnly
              ? 'Read-only. You can see this because you may read everyone’s day.'
              : undefined;
      return (
        <EditorFrame
          kind="entry"
          forId={entry.id}
          label="The selected confirmed entry"
          pill={imported ? 'Imported' : untimedEntry ? 'No set time' : 'Confirmed'}
          pillClass={imported ? 'inspector-kind-imported' : 'inspector-kind-confirmed'}
          icon={imported ? ICONS.imported : ICONS.confirmed}
          saved={saved && changeable}
          onUndo={undo}
          onClose={onClose}
          keyText={entry.task?.key}
          title={name}
          sub={`${whenOf(entry)} · ${duration(entry.minutes)} · ${
            imported
              ? 'Imported from Solidtime · read-only here'
              : readOnly
                ? `Read-only · ${subject}’s entry`
                : 'Confirmed · owners and admins can see it'
          }${entry.note !== null ? ` · “${entry.note}”` : ''}`}
          banner={banner}
          bannerTone={stopped === entry.id ? 'accent' : 'blue'}
          foot={
            changeable ? (
              <button
                type="button"
                className="editor-act editor-act-danger"
                data-entry-delete
                disabled={busy}
                onClick={() => {
                  actions.remove(entry);
                }}
              >
                Delete entry
              </button>
            ) : undefined
          }
        >
          <section className="editor-section">
            <h3 className="editor-label">When</h3>
            <EditorWhen
              span={spanOf}
              minutes={entry.minutes}
              midnight={line.midnight}
              tz={view.tz}
              limits={limits}
              conflicts={conflictsAround(entry.id)}
              busy={busy}
              readOnly={!changeable}
              onSpan={(next) => {
                actions.setSpan(held, next);
              }}
              onLength={(minutes) => {
                actions.setLength(held, minutes);
              }}
            />
          </section>
          <section className="editor-section">
            <h3 className="editor-label">Task</h3>
            <p className="editor-task-line inspector-card">
              {entry.task !== null ? (
                <CardLink task={entry.task} slug={entry.project?.slug} onNavigate={onNavigate} />
              ) : entry.project !== null ? (
                <span className="editor-task-title">{entry.project.name}</span>
              ) : (
                <>
                  <span className="editor-task-key">No task</span>
                  <span className="editor-task-title">
                    Shows as{' '}
                    {entry.kind === undefined || entry.kind === null
                      ? 'General'
                      : kindLabel(entry.kind)}{' '}
                    on the Timeline
                  </span>
                </>
              )}
              {folderOf(entry) !== undefined && (
                <span className="editor-task-title" data-entry-folder>
                  {` · ${folderOf(entry) ?? ''}`}
                </span>
              )}
            </p>
            {changeable && (
              <>
                <TaskSearch
                  busy={busy}
                  onPick={(card) => {
                    actions.setCard(held, card);
                  }}
                  onCustom={(text) => {
                    actions.saveDetails(entry, {
                      title: text,
                      description: said.description,
                      note: entry.note ?? '',
                    });
                    if (entry.task !== null || entry.project !== null) {
                      actions.setCard(held, 'general');
                    }
                  }}
                />
                <TaskChips
                  current={entry.task?.key}
                  general={entry.task === null && entry.project === null}
                  chips={chipsAround(entry.task, entry.id)}
                  busy={busy}
                  onPick={(card) => {
                    actions.setCard(held, card);
                  }}
                />
              </>
            )}
          </section>
          <section className="editor-section" data-entry-details>
            <h3 className="editor-label">Kind</h3>
            {kindChips(entry.kind ?? undefined, changeable, (kind) => {
              actions.setKind(entry, entry.kind === kind ? null : kind);
            })}
          </section>
          <section
            className={
              block !== undefined && agentsIn !== undefined && !readOnly
                ? 'editor-section'
                : 'editor-section editor-section-last'
            }
          >
            <h3 className="editor-label">What it was</h3>
            <input
              className="input editor-input editor-words"
              data-entry-title
              value={said.title}
              maxLength={120}
              placeholder={
                changeable
                  ? `e.g. ${entry.task?.title ?? 'Code review for the onboarding epic'}`
                  : 'No title'
              }
              aria-label="What it was"
              readOnly={!changeable}
              disabled={busy}
              onChange={(event) => {
                setDetails({ ...said, title: event.target.value });
              }}
              onBlur={saveWords}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            {(changeable || said.description !== '') && (
              <textarea
                className="input editor-textarea"
                data-entry-description
                rows={2}
                value={said.description}
                maxLength={2000}
                placeholder="Add a description (optional)"
                aria-label="Description"
                readOnly={!changeable}
                disabled={busy}
                onChange={(event) => {
                  setDetails({ ...said, description: event.target.value });
                }}
                onBlur={saveWords}
              />
            )}
          </section>
          {block !== undefined && agentsIn !== undefined && (
            <section className={readOnly ? 'editor-section editor-section-last' : 'editor-section'}>
              <h3 className="editor-label">Built from</h3>
              <div className="editor-tiles editor-tiles-one">
                <div className="editor-tile">
                  <strong data-count="agents">{String(agentsIn(block).runs)}</strong>
                  <span>agents</span>
                </div>
              </div>
              <p className="editor-hint" data-agent-line>
                {agentLine(agentsIn(block), who)}
              </p>
            </section>
          )}
          {!readOnly && (
            <section className="editor-section editor-section-last" data-entry-history>
              <h3 className="editor-label">History</h3>
              {history.kind === 'loading' && <Spinner size="sm" label="Reading the history" />}
              {history.kind === 'error' && <p className="editor-error">{history.message}</p>}
              {history.kind === 'ready' && (
                <ol className="editor-history" aria-label="Revisions">
                  {[...history.revisions].reverse().map((r, i, all) => (
                    <li key={r.revision} className="editor-history-row">
                      <span className="editor-history-time">
                        <time dateTime={new Date(r.created_at).toISOString()}>
                          {clock(r.created_at, view.tz)}
                        </time>
                      </span>
                      <span>
                        {revisionWords(r, entry.source, i === all.length - 1)}
                        <span className="editor-history-who"> · You</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </EditorFrame>
      );
    }
  }

  if (selection?.kind === 'gap' && readOnly) {
    // Somebody else's gap (LAI-959): what it is, and nothing to fill it with.
    const g: Span = { start: selection.start, end: selection.end };
    return (
      <EditorFrame
        kind="gap"
        forId={`gap-${String(g.start)}`}
        label="The picked gap"
        pill="Gap"
        pillClass="inspector-kind-gap"
        icon={ICONS.gap}
        onClose={onClose}
        title="Gap"
        sub={`${span(at(g.start), at(g.end), view.tz)} · ${duration(g.end - g.start)} · Nothing reached Laika in this time`}
      >
        <section className="editor-section editor-section-last">
          <p className="editor-note">Nothing on {subject}’s day covers this time.</p>
        </section>
      </EditorFrame>
    );
  }

  if (selection?.kind === 'range' || selection?.kind === 'gap') {
    const range: Span = { start: selection.start, end: selection.end };
    const free = freeAround(
      range.start,
      line.blocks.filter((b) => b.kind === 'confirmed'),
      line.from * 60,
      line.to * 60,
    );
    const gaps = line.gaps;
    const gapIndex =
      selection.kind === 'gap' ? gaps.findIndex((g) => g.start === selection.start) : -1;
    const from: NewEntryFrom =
      selection.kind === 'gap'
        ? 'gap'
        : (selection.from ?? (selection.fromTimer === true ? 'timer' : 'drag'));
    return (
      <NewEntryPanel
        key={`${selection.kind}-${String(selection.start)}`}
        view={view}
        range={range}
        from={from}
        gap={selection.kind === 'gap' ? range : undefined}
        gapNav={
          selection.kind === 'gap' && gaps.length > 1 && gapIndex >= 0
            ? {
                index: gapIndex,
                total: gaps.length,
                onPrev: () => {
                  const g = gaps[(gapIndex - 1 + gaps.length) % gaps.length];
                  if (g !== undefined) actions.pickGap(g);
                },
                onNext: () => {
                  const g = gaps[(gapIndex + 1) % gaps.length];
                  if (g !== undefined) actions.pickGap(g);
                },
              }
            : undefined
        }
        untimed={selection.kind === 'range' ? selection.untimed : undefined}
        prefill={selection.kind === 'range' ? selection.prefill : undefined}
        limits={{ lo: free?.lo ?? line.from * 60, hi: free?.hi ?? line.to * 60 }}
        conflicts={conflictsAround(undefined)}
        busySpans={busySpans()}
        now={nowMinute}
        chips={chipsFor(null)}
        busy={busy}
        onAdd={actions.add}
        onCancel={actions.letGo}
        onBreak={
          selection.kind === 'gap' && !readOnly
            ? () => {
                actions.markBreak(range);
              }
            : undefined
        }
        onClose={onClose ?? actions.letGo}
      />
    );
  }

  if (selection?.kind === 'break') {
    const b = line.breaks.find((x) => x.id === selection.id);
    if (b !== undefined) {
      const range = span(at(b.start), at(b.end), view.tz);
      return (
        <EditorFrame
          kind="break"
          forId={b.id}
          label="The picked break"
          pill="Personal break"
          pillClass="inspector-kind-break"
          icon={ICONS.break}
          onClose={onClose}
          title="Break"
          sub={`${range} · ${duration(b.end - b.start)} · Personal break · not counted in ${who === 'you' ? 'your' : 'their'} hours`}
          foot={
            readOnly ? undefined : (
              <>
                <button
                  type="button"
                  className="editor-act"
                  data-break-work
                  disabled={busy}
                  onClick={() => {
                    actions.workFromBreak(b);
                  }}
                >
                  Turn into work time
                </button>
                <button
                  type="button"
                  className="editor-act"
                  data-break-remove
                  disabled={busy}
                  onClick={() => {
                    actions.unbreak(b.id);
                  }}
                >
                  Remove break
                </button>
              </>
            )
          }
        >
          <section className="editor-section">
            <h3 className="editor-label">When</h3>
            <EditorWhen
              span={{ start: b.start, end: b.end }}
              minutes={b.end - b.start}
              midnight={line.midnight}
              tz={view.tz}
              limits={{ lo: 0, hi: 1440 }}
              busy={busy}
              readOnly
              onSpan={() => undefined}
              onLength={() => undefined}
            />
          </section>
          <section className="editor-section editor-section-last">
            <p className="editor-note">
              A break {who === 'you' ? 'you' : 'they'} took. It isn’t counted, and it doesn’t block
              work: time dragged over it shows hatched.
            </p>
          </section>
        </EditorFrame>
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

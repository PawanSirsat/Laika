import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  addBreak,
  addEntry,
  confirmDay,
  confirmDraft,
  deleteEntry,
  dismissDraft,
  getMyDay,
  removeBreak,
  splitDraft,
  undo,
  updateDraft,
  updateEntry,
  type DraftPatch,
  type EntryPatch,
  type MyDay,
  type NewEntry,
  type TaskRef,
  type OnUndo,
  type TimeDraft,
} from '../../../api/time.ts';
import { everyPage } from '../../../api/every-page.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import type { MeProfile } from '../../../api/me.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import { AddTimeForm } from './AddTimeForm.tsx';
import { AgentStrip } from './AgentStrip.tsx';
import { cardChips } from './card-chips.ts';
import { DraftList, type Batch } from './DraftList.tsx';
import { DraftMyTime } from './DraftMyTime.tsx';
import {
  confirmPlan,
  needCardLine,
  runBulk,
  runConfirmDay,
  type BulkApi,
  type BulkKind,
  type BulkResult,
} from './draft-bulk.ts';
import { EntryList } from './EntryList.tsx';
import { clock, duration, span } from './format.ts';
import { Inspector, type Held, type InspectorActions } from './Inspector.tsx';
import { canAddTime, dayIn, isDay } from './my-day-derive.ts';
import { OnYourPlate, usePlate } from './OnYourPlate.tsx';
import { shortcutFor, type Shortcut } from './shortcuts.ts';
import { ShortcutSheet } from './ShortcutSheet.tsx';
import { Timeline, type Selection } from './Timeline.tsx';
import {
  agentsDuring,
  dayLine,
  instantOf,
  limitsIn,
  setLength,
  splitPoint,
  stepEnd,
  stepMinutes,
  type Edit,
  type LaneBlock,
  type Span,
  type Zoom,
} from './timeline-derive.ts';
import { Toast, type ToastState } from './Toast.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { dayLong } from './week-derive.ts';
import './my-day.css';

export interface MyDayScreenProps {
  /** `?day=` — a calendar day in the reader's zone; today when absent. */
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
  /** Whose plate (LAI-796): their own open tasks. */
  readonly me?: MeProfile | undefined;
  /** The review queue the shell holds for the sidebar's badge. */
  readonly queue?: readonly ReviewQueueItem[] | undefined;
  /** The server cut that queue at its limit (LAI-820). */
  readonly queueCapped?: boolean | undefined;
  /** Open a task from *On your plate* without reloading the page. */
  readonly onNavigate?: (to: string) => void;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: MyDay }
  | { readonly kind: 'error'; readonly error: unknown };

const RUNNING: Readonly<Record<BulkKind, string>> = {
  confirm: 'Confirming',
  general: 'Moving to General',
  dismiss: 'Marking not work',
};

/** The keys a batch runs under: the bar's, and the header's *Confirm day*. */
const BATCHES: ReadonlySet<string> = new Set(['bulk', 'confirm-day']);

/** How long Undo is offered; the server keeps a change longer (`UNDO_WINDOW_MS`). */
const UNDO_MS = 10_000;
const SAID_MS = 6_000;

const messageOf = (cause: unknown): string =>
  cause instanceof ApiError ? cause.message : 'That change did not save.';

/** A change the page made: the undo id the server answered with, and what it touched. */
interface Made {
  readonly undoId: string;
  readonly blocks: readonly string[];
}

/**
 * The writes a batch makes (LAI-810), **each recorded with the undo id its
 * change answered with** (review round 1), so Undo takes back exactly those
 * changes and never a later one. `day` is every block a *Confirm day* touches.
 */
function recording(made: Made[], day: readonly string[]): BulkApi {
  const keep =
    (blocks: readonly string[]): OnUndo =>
    (undoId) => {
      made.push({ undoId, blocks });
    };
  return {
    confirmDraft: (id) => confirmDraft(id, keep([id])),
    confirmDay: (on) => confirmDay(on, keep(day)),
    dismissDraft: (id) => dismissDraft(id, keep([id])),
    toGeneral: (id) => updateDraft(id, { task: null, project: null, general: true }, keep([id])),
  };
}

/**
 * Undo many, **newest first**, each by the id its change answered with
 * (`POST /me/time/undo`). What the server would not take back — changed
 * since, or a later change after it — is said, never hidden.
 */
async function undoEach(made: readonly Made[]): Promise<string> {
  let undone = 0;
  const refused: string[] = [];
  for (const change of [...made].reverse()) {
    try {
      await undo(change.undoId);
      undone += 1;
    } catch (cause) {
      refused.push(messageOf(cause));
    }
  }
  if (refused.length === 0) return undone === 1 ? 'Undone.' : `Undone — ${String(undone)} blocks.`;
  if (undone === 0) throw new Error(refused[0] ?? 'Nothing could be undone.');
  return `${String(undone)} undone; ${String(refused.length)} could not be: ${[...new Set(refused)].join(' ')}`;
}

/**
 * The spaces the reader can read, once for the page (LAI-810 review round
 * 1): *On your plate* reads the reader's work in every space they can access,
 * and *Agent minutes* links a card only when its space is one of them.
 * `undefined` while reading, `null` if the read failed.
 */
function useSpaces(): readonly Project[] | null | undefined {
  const [spaces, setSpaces] = useState<readonly Project[] | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    everyPage((cursor) =>
      listProjects(cursor === undefined ? { limit: 200 } : { limit: 200, cursor }, signal),
    )
      .then(({ items }) => {
        if (!signal.aborted) setSpaces(items.filter(isProject));
      })
      .catch(() => {
        if (!signal.aborted) setSpaces(null);
      });
    return () => {
      controller.abort();
    };
  }, []);
  return spaces;
}

/** The padlock beside "Only you see drafts". */
function Padlock() {
  return (
    <svg className="myday-lock-icon" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

const ready = (d: TimeDraft): boolean => d.task !== null || d.project !== null || d.general;

/**
 * My day (LAI-787, D-088): the reader's own day, drafted on their own machine
 * from what their collector already holds, confirmed in one click or edited
 * block by block. **Private**: only they read it, signed in — no admin view
 * and no token. Only what they confirm, or type, is ever seen by anyone else.
 *
 * **Laid out after the owner's "Laika App v2" design** (LAI-831): the week
 * strip and *Draft my time* in the header with *Confirm day*; the day in four
 * figures and as a lane timeline with its gaps; an inspector for the block in
 * hand; *To settle* and *Confirmed* beneath; and beside them *Agent minutes*
 * and *On your plate*. Every action is said in a toast, with **Undo** where
 * the server can put it back exactly; the keys ↵ G X J K act on the selected
 * draft and ? lists them.
 *
 * Every figure, name, key and count comes from the API. A day nothing reached
 * the board on is *No signal*, never zero hours; agent time is minutes beside
 * the day, never hours in it.
 */
export function MyDayScreen({
  day,
  onDay,
  me,
  queue,
  queueCapped,
  onNavigate = () => undefined,
}: MyDayScreenProps) {
  const tz = readerZone();
  const selectedDay = isDay(day) ? day : dayIn(tz, Date.now());
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [batch, setBatch] = useState<Batch>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [slot, setSlot] = useState<Span | undefined>(undefined);
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  const [sheet, setSheet] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('1');
  const [now, setNow] = useState(() => Date.now());
  const spaces = useSpaces();
  const plate = usePlate(me, spaces);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const toastSeq = useRef(0);
  const lastDraftIndex = useRef(0);
  const batching = pending !== undefined && BATCHES.has(pending);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getMyDay(selectedDay, tz, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [selectedDay, tz, tick]);

  // The now line moves with the clock.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // A new day starts with nothing in hand.
  useEffect(() => {
    setSelection(undefined);
    setSlot(undefined);
    setBatch({ kind: 'idle' });
  }, [selectedDay]);

  // The selection stays something that exists: a confirmed or dismissed block
  // hands it to the next one, and an open day starts on its first draft.
  useEffect(() => {
    if (load.kind !== 'ready') return;
    const v = load.view;
    setSelection((prev) => {
      if (prev === undefined) {
        const first = v.drafts[0];
        return first === undefined ? undefined : { kind: 'draft', id: first.id };
      }
      if (prev.kind === 'draft') {
        if (v.drafts.some((d) => d.id === prev.id)) return prev;
        const next = v.drafts[Math.min(lastDraftIndex.current, v.drafts.length - 1)];
        return next === undefined ? undefined : { kind: 'draft', id: next.id };
      }
      if (prev.kind === 'entry') return v.entries.some((e) => e.id === prev.id) ? prev : undefined;
      if (prev.kind === 'break') return v.breaks.some((b) => b.id === prev.id) ? prev : undefined;
      if (prev.kind !== 'gap') return prev;
      const gaps = dayLine(v, Date.now()).gaps;
      return gaps.some((g) => g.start === prev.start && g.end === prev.end) ? prev : undefined;
    });
  }, [load]);

  // Undo is offered for about ten seconds; anything else says its word and goes.
  useEffect(() => {
    if (toast === undefined || toast.tone === 'error') return;
    const timer = setTimeout(
      () => {
        setToast((current) => (current?.id === toast.id ? undefined : current));
      },
      toast.undo === undefined ? SAID_MS : UNDO_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const view = load.kind === 'ready' ? load.view : undefined;
  const line = useMemo(() => (view === undefined ? undefined : dayLine(view, now)), [view, now]);

  useEffect(() => {
    if (view === undefined || selection?.kind !== 'draft') return;
    const at = view.drafts.findIndex((d) => d.id === selection.id);
    if (at >= 0) lastDraftIndex.current = at;
  }, [view, selection]);

  const say = (
    text: string,
    tone: ToastState['tone'] = 'info',
    made: readonly Made[] = [],
    batchReport = false,
  ): void => {
    toastSeq.current += 1;
    setToast({
      id: toastSeq.current,
      text,
      tone,
      ...(made.length === 0
        ? {}
        : { undo: () => undoEach(made), blocks: new Set(made.flatMap((m) => m.blocks)) }),
      ...(batchReport ? { batch: true } : {}),
    });
  };

  /**
   * A later edit to a block retires the Undo of an earlier change to it
   * (review round 1): Undo of *General* never stands beside a *+* made after
   * it — the server would refuse it, and the page does not offer it.
   */
  const retire = (blocks: readonly string[]): void => {
    if (blocks.length === 0) return;
    setToast((current) =>
      current?.undo !== undefined && blocks.some((b) => current.blocks?.has(b) === true)
        ? { id: current.id, text: current.text, tone: current.tone }
        : current,
    );
  };

  /**
   * Run one write to `blocks`, keyed so only its own control spins; re-read
   * the day after. When `said` asks, Undo is offered **for this change**, by
   * the id it answered with; any write retires an earlier Undo on its blocks.
   */
  const run = async <T,>(
    key: string,
    blocks: readonly string[],
    write: (onUndo: OnUndo) => Promise<T>,
    said?:
      | string
      | ((result: T) => {
          readonly text: string;
          readonly undoable?: boolean;
          readonly blocks?: readonly string[];
        }),
  ): Promise<T | undefined> => {
    setPending(key);
    let undoId: string | undefined;
    try {
      const result = await write((id) => {
        undoId = id;
      });
      reload();
      retire(blocks);
      if (said !== undefined) {
        const word = typeof said === 'string' ? { text: said } : said(result);
        const offered = 'undoable' in word && word.undoable === true && undoId !== undefined;
        const touched = [...blocks, ...('blocks' in word ? (word.blocks ?? []) : [])];
        say(word.text, 'info', offered ? [{ undoId: undoId ?? '', blocks: touched }] : []);
      }
      return result;
    } catch (cause) {
      say(messageOf(cause), 'error');
      return undefined;
    } finally {
      setPending(undefined);
    }
  };

  const runUndo = (undoIt: () => Promise<string>): void => {
    setPending('undo');
    setToast(undefined);
    undoIt()
      .then((text) => {
        say(text);
      })
      .catch((cause: unknown) => {
        say(cause instanceof Error ? cause.message : 'Nothing could be undone.', 'error');
      })
      .finally(() => {
        setPending(undefined);
        reload();
      });
  };

  /**
   * One batch over many blocks: one request each, in order, the progress
   * said as it goes — and **the day re-read once at the end**. Its last word
   * is the toast, with Undo for exactly what it did. The day cannot be
   * changed, nor time added, while it runs. Resolves to the blocks that stay
   * selected.
   */
  const runBatch = async (
    key: string,
    label: string,
    onDay: string,
    touches: readonly string[],
    work: (api: BulkApi, onProgress: (done: number, total: number) => void) => Promise<BulkResult>,
  ): Promise<readonly string[]> => {
    const total = touches.length;
    setPending(key);
    setBatch({ kind: 'running', day: onDay, label, done: 0, total });
    const made: Made[] = [];
    try {
      const result = await work(recording(made, touches), (done, of) => {
        setBatch({ kind: 'running', day: onDay, label, done, total: of });
      });
      retire(touches);
      say(result.text, result.ok ? 'info' : 'warn', made, true);
      return result.keep;
    } finally {
      setPending(undefined);
      setBatch({ kind: 'idle' });
      reload();
    }
  };

  // The keys (CHIEF's addition H), read through a ref so one listener serves.
  const onShortcut = useRef<(shortcut: Shortcut) => boolean>(() => false);
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const target = event.target as (HTMLElement & { type?: string }) | null;
      const shortcut = shortcutFor({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target:
          target === null
            ? null
            : {
                tagName: target.tagName,
                ...(typeof target.type === 'string' ? { type: target.type } : {}),
                isContentEditable: target.isContentEditable,
              },
      });
      if (shortcut === undefined) return;
      if (onShortcut.current(shortcut)) event.preventDefault();
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, []);

  if (load.kind === 'loading' || view === undefined || line === undefined) {
    return (
      <div className="myday-page">
        <ScreenHeader variant="page" title="My day" description={dayLong(selectedDay)} />
        <div className="myday">
          {load.kind === 'error' ? (
            <ApiErrorState error={load.error} resource="your day" onRetry={reload} />
          ) : (
            <LoadingState shape="card" count={3} label="Reading your day" />
          )}
        </div>
      </div>
    );
  }

  const { settings } = view;
  const addable = canAddTime(settings);
  const dayPlan = confirmPlan(view.drafts);
  const readyMinutes = dayPlan.ready.reduce((sum, d) => sum + d.minutes, 0);
  const busy = pending !== undefined;
  const instant = (m: number): number =>
    line.midnight === undefined ? 0 : instantOf(line.midnight, m);
  const block = (id: string): LaneBlock | undefined => line.blocks.find((b) => b.id === id);

  const inProgress: TaskRef[] =
    plate.kind === 'ready'
      ? plate.mine
          .filter((m) => m.task.status === 'in_progress')
          .map((m) => ({ id: m.task.id, key: m.task.key, title: m.task.title }))
      : [];
  const onTheDay: TaskRef[] = [...view.drafts, ...view.entries]
    .map((x) => x.task)
    .filter((t): t is TaskRef => t !== null);
  const chipsFor = (own: TaskRef | null): readonly TaskRef[] =>
    cardChips(own, inProgress, onTheDay);

  const pickGap = (gap: Span): void => {
    setSelection({ kind: 'gap', start: gap.start, end: gap.end });
    setSlot(gap);
  };

  const write = (held: Held, patch: DraftPatch & EntryPatch, key: string, said?: string) =>
    held.kind === 'draft'
      ? run(key, [held.draft.id], (onUndo) => updateDraft(held.draft.id, patch, onUndo), said)
      : run(key, [held.entry.id], () => updateEntry(held.entry.id, patch), said);

  const onEdge = (lane: LaneBlock, edit: Edit): void => {
    const patch: { started_at?: number; ended_at?: number; minutes: number } = {
      minutes: edit.minutes,
    };
    if (edit.start !== lane.start) patch.started_at = instant(edit.start);
    if (edit.end !== lane.end) patch.ended_at = instant(edit.end);
    if (lane.kind === 'drafted') {
      void run(`edge:${lane.id}`, [lane.id], (onUndo) => updateDraft(lane.id, patch, onUndo));
    } else {
      void run(`edge:${lane.id}`, [lane.id], () => updateEntry(lane.id, patch));
    }
  };

  const confirmOne = (draft: TimeDraft): void => {
    if (!ready(draft)) {
      say('Pick a card or General first, then confirm.', 'warn');
      return;
    }
    const where = draft.task?.key ?? draft.project?.name ?? 'General';
    void run(
      `confirm:${draft.id}`,
      [draft.id],
      (onUndo) => confirmDraft(draft.id, onUndo),
      (entry) => ({
        text: `${duration(draft.minutes)} confirmed to ${where} — your organisation can see it now.`,
        undoable: true,
        blocks: [entry.id],
      }),
    );
  };

  const dismissOne = (draft: TimeDraft): void => {
    void run(
      `dismiss:${draft.id}`,
      [draft.id],
      (onUndo) => dismissDraft(draft.id, onUndo),
      () => ({ text: 'Marked not work. A later sync won’t bring it back.', undoable: true }),
    );
  };

  /** A length for a block: its end moves with it, never into confirmed time (review round 1). */
  const lengthOf = (held: Held, minutes: number, key: string): void => {
    const item = held.kind === 'draft' ? held.draft : held.entry;
    const placed = block(item.id);
    if (placed === undefined) {
      void write(held, { minutes }, key);
      return;
    }
    const edit = setLength(placed, minutes, limitsIn(line, placed).hi);
    if (edit === undefined) {
      say(
        `${duration(minutes)} would run past the end of the day or into confirmed time — shorten it, or move the block first.`,
        'warn',
      );
      return;
    }
    void write(held, { minutes: edit.minutes, ended_at: instant(edit.end) }, key);
  };

  const actions: InspectorActions = {
    confirm: confirmOne,
    dismiss: dismissOne,
    setCard: (held, card) => {
      if (held.kind === 'draft') {
        const patch: DraftPatch = card === 'general' ? { general: true } : { task: card };
        void run(
          `card:${held.draft.id}`,
          [held.draft.id],
          (onUndo) => updateDraft(held.draft.id, patch, onUndo),
          () => ({
            text:
              card === 'general'
                ? 'Moved to General — ready to confirm.'
                : `Put on ${card} — ready to confirm.`,
            undoable: true,
          }),
        );
      } else {
        const patch: EntryPatch =
          card === 'general' ? { task: null, project: null } : { task: card };
        void write(
          held,
          patch,
          `card:${held.entry.id}`,
          `${card === 'general' ? 'Moved to General' : `Put on ${card}`}. Every edit is kept as a revision.`,
        );
      }
    },
    step: (held, by) => {
      const item = held.kind === 'draft' ? held.draft : held.entry;
      const placed = block(item.id);
      if (placed === undefined) {
        const minutes = stepMinutes(item.minutes, by);
        if (minutes !== undefined) void write(held, { minutes }, `step:${item.id}`);
        return;
      }
      // On the five-minute grid, and never into the confirmed block after it.
      const edit = stepEnd(placed, by, limitsIn(line, placed).hi);
      if (edit !== undefined) {
        void write(held, { minutes: edit.minutes, ended_at: instant(edit.end) }, `step:${item.id}`);
      }
    },
    setLength: (held, minutes) => {
      lengthOf(held, minutes, `length:${held.kind === 'draft' ? held.draft.id : held.entry.id}`);
    },
    split: (draft) => {
      const placed = block(draft.id);
      const at = placed === undefined ? undefined : splitPoint(placed);
      if (at === undefined) return;
      void run(
        `split:${draft.id}`,
        [draft.id],
        (onUndo) => splitDraft(draft.id, instant(at), onUndo),
        (result) => {
          const [a, b] = result.drafts;
          if (a !== undefined) setSelection({ kind: 'draft', id: a.id });
          return {
            text:
              a === undefined || b === undefined
                ? `Split at ${clock(instant(at), view.tz)}.`
                : `Split at ${clock(instant(at), view.tz)} into ${duration(a.minutes)} and ${duration(b.minutes)}.`,
            undoable: true,
            blocks: result.drafts.map((d) => d.id),
          };
        },
      );
    },
    remove: (entry) => {
      void run(
        `delete:${entry.id}`,
        [entry.id],
        (onUndo) => deleteEntry(entry.id, onUndo),
        () => ({
          text: `${duration(entry.minutes)} deleted. The revision history keeps a record.`,
          undoable: true,
        }),
      );
    },
    saveNote: (entry, note) => {
      const text = note.trim();
      void run(
        `note:${entry.id}`,
        [entry.id],
        () => updateEntry(entry.id, { note: text === '' ? null : text }),
        'Note saved. Every edit is kept as a revision.',
      );
    },
    fill: (gap) => {
      setSlot(gap);
      noteRef.current?.scrollIntoView({ block: 'center' });
      noteRef.current?.focus();
    },
    markBreak: (gap) => {
      const range = span(instant(gap.start), instant(gap.end), view.tz);
      void run(
        'break',
        [],
        () =>
          addBreak({
            day: view.day,
            tz: view.tz,
            started_at: instant(gap.start),
            ended_at: instant(gap.end),
          }),
        (made) => {
          setSlot(undefined);
          setSelection({ kind: 'break', id: made.id });
          return { text: `${range} is a break — not time, and not a gap.` };
        },
      );
    },
    unbreak: (id) => {
      void run('unbreak', [], () => removeBreak(id), 'Not a break — it counts as a gap again.');
    },
  };

  onShortcut.current = (shortcut) => {
    const dialog = document.querySelector('.myday-dialog');
    if (shortcut === 'help') {
      if (dialog !== null && !sheet) return false;
      setSheet((open) => !open);
      return true;
    }
    if (shortcut === 'close') {
      if (sheet) {
        setSheet(false);
        return true;
      }
      if (slot !== undefined) {
        setSlot(undefined);
        return true;
      }
      return false;
    }
    if (dialog !== null || busy) return false;
    if (shortcut === 'left' || shortcut === 'right') {
      // ← → walk every placed block, as the Timeline's ‹ › do (LAI-888).
      const blocks = line.blocks;
      if (blocks.length === 0) return false;
      const at =
        selection !== undefined && 'id' in selection
          ? blocks.findIndex((b) => b.id === selection.id)
          : -1;
      const by = shortcut === 'right' ? 1 : -1;
      const next =
        at < 0
          ? by > 0
            ? 0
            : blocks.length - 1
          : Math.max(0, Math.min(blocks.length - 1, at + by));
      const block = blocks[next];
      if (block !== undefined) {
        setSelection({ kind: block.kind === 'drafted' ? 'draft' : 'entry', id: block.id });
      }
      return true;
    }
    const drafts = view.drafts;
    const current =
      selection?.kind === 'draft' ? drafts.find((d) => d.id === selection.id) : undefined;
    if (shortcut === 'next' || shortcut === 'prev') {
      if (drafts.length === 0) return false;
      const at = current === undefined ? -1 : drafts.indexOf(current);
      const step = shortcut === 'next' ? 1 : -1;
      const next = drafts[(at + step + drafts.length) % drafts.length];
      if (next !== undefined) setSelection({ kind: 'draft', id: next.id });
      return true;
    }
    if (current === undefined) return false;
    if (shortcut === 'confirm') confirmOne(current);
    else if (shortcut === 'dismiss') dismissOne(current);
    else if (!current.general) actions.setCard({ kind: 'draft', draft: current }, 'general');
    return true;
  };

  const selectedId =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? selection.id
      : undefined;

  return (
    <div className="myday-page">
      <ScreenHeader
        variant="page"
        title="My day"
        description={
          <span className="myday-subtitle">
            <span>
              {dayLong(view.day)}
              {view.day === view.today && ' · today'}
            </span>
            <span className="myday-subtitle-dot" aria-hidden="true" />
            <span className="myday-lock">
              <Padlock />
              Only you see drafts
            </span>
          </span>
        }
        below={
          <WeekStrip
            week={view.week}
            selected={view.day}
            today={view.today}
            locked={batching}
            onPick={onDay}
          />
        }
      >
        <DraftMyTime
          settings={settings}
          held={view.drafts_held}
          pending={pending}
          run={(key, writeIt, said) =>
            run(key, [], () => writeIt(), said).then((r) => r !== undefined)
          }
        />
        {view.drafts.length > 0 && (
          <button
            type="button"
            className="myday-chip myday-chip-primary myday-confirm-day"
            data-confirm-day
            disabled={busy || dayPlan.ready.length === 0}
            title={
              dayPlan.needCard.length > 0
                ? `${needCardLine(dayPlan.needCard.length)} first — left out`
                : `Confirm every drafted block of ${dayLong(view.day)}`
            }
            onClick={() => {
              void runBatch(
                'confirm-day',
                'Confirming',
                view.day,
                view.drafts.map((d) => d.id),
                (api, progress) => runConfirmDay(view.drafts, view.day, api, progress),
              );
            }}
          >
            {pending === 'confirm-day' && <Spinner size="sm" label="Confirming the day" />}
            {dayPlan.needCard.length === 0
              ? `Confirm day · ${duration(readyMinutes)}`
              : `Confirm ${String(dayPlan.ready.length)} ready · ${duration(readyMinutes)}`}
          </button>
        )}
      </ScreenHeader>

      <div className="myday" data-myday-ready>
        {/* The Timeline spans the page (LAI-889, the v3 design); the editor, the lists and the side column sit under it. */}
        {view.state === 'future' ? (
          <section className="myday-card" aria-label="Timeline">
            <p className="myday-future">This day has not happened yet.</p>
          </section>
        ) : (
          <Timeline
            view={view}
            line={line}
            nowMs={now}
            zoom={zoom}
            onZoom={setZoom}
            selection={selection}
            onSelect={(next) => {
              if (next.kind === 'gap') pickGap(next);
              else setSelection(next);
            }}
            onEdge={onEdge}
            busy={busy}
          />
        )}
        <div className="myday-grid">
          <div className="myday-main">
            {view.state !== 'future' && (
              <Inspector
                key={
                  selection === undefined
                    ? 'none'
                    : 'id' in selection
                      ? `${selection.kind}-${selection.id}`
                      : `gap-${String(selection.start)}`
                }
                view={view}
                line={line}
                selection={selection}
                chipsFor={chipsFor}
                agentsIn={(span) => agentsDuring(line.agents, span)}
                pending={pending}
                actions={actions}
                onNavigate={onNavigate}
              />
            )}

            {view.drafts.length > 0 && (
              <DraftList
                // A new day starts with nothing ticked and on its first page.
                key={`drafts-${view.day}`}
                drafts={view.drafts}
                pending={pending}
                batch={
                  batch.kind === 'running' && batch.day === view.day ? batch : { kind: 'idle' }
                }
                selected={selectedId}
                onSelect={(draft) => {
                  setSelection({ kind: 'draft', id: draft.id });
                }}
                onNavigate={onNavigate}
                onBulk={(kind, chosen) =>
                  runBatch(
                    'bulk',
                    RUNNING[kind],
                    view.day,
                    chosen.map((d) => d.id),
                    (api, progress) => runBulk(kind, chosen, api, progress),
                  )
                }
              />
            )}

            {view.state !== 'future' && (
              <EntryList
                key={`entries-${view.day}`}
                entries={view.entries}
                selected={selectedId}
                onSelect={(entry) => {
                  setSelection({ kind: 'entry', id: entry.id });
                }}
                onNavigate={onNavigate}
              >
                {addable && (
                  <AddTimeForm
                    day={view.day}
                    tz={view.tz}
                    slot={slot}
                    midnight={line.midnight}
                    onClearSlot={() => {
                      setSlot(undefined);
                      if (selection?.kind === 'gap') setSelection(undefined);
                    }}
                    onBreakSlot={actions.markBreak}
                    chips={cardChips(null, inProgress, onTheDay)}
                    busy={pending === 'add'}
                    locked={batching}
                    noteRef={noteRef}
                    onAdd={async (entry: NewEntry, label: string) => {
                      const made = await run(
                        'add',
                        [],
                        (onUndo) => addEntry(entry, onUndo),
                        (created) => ({
                          text: `${duration(entry.minutes)} added to ${label} — confirmed as you add it.`,
                          undoable: true,
                          blocks: [created.id],
                        }),
                      );
                      if (made === undefined) return false;
                      setSlot(undefined);
                      setSelection({ kind: 'entry', id: made.id });
                      return true;
                    }}
                  />
                )}
              </EntryList>
            )}
          </div>

          <aside className="myday-side" aria-label="Beside your day" data-myday-side>
            <AgentStrip agent={view.agent} spaces={spaces} onNavigate={onNavigate} />
            <OnYourPlate
              me={me}
              spaces={spaces}
              load={plate}
              queue={queue}
              reviewCapped={queueCapped}
              onNavigate={onNavigate}
            />
          </aside>
        </div>
      </div>

      <Toast
        toast={toast}
        busy={busy}
        onUndo={runUndo}
        onClose={() => {
          setToast(undefined);
        }}
      />
      {sheet && (
        <ShortcutSheet
          onClose={() => {
            setSheet(false);
          }}
        />
      )}
    </div>
  );
}

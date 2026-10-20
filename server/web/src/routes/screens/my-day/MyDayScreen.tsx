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
  type TimeDraft,
  type UndoSubject,
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
import { StatsStrip } from './StatsStrip.tsx';
import { Timeline, type Selection } from './Timeline.tsx';
import {
  dayLine,
  instantOf,
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

/**
 * The writes a batch makes (LAI-810), **each recorded as it succeeds** so
 * Undo can take back exactly those (LAI-831).
 */
function recording(subjects: UndoSubject[]): BulkApi {
  return {
    confirmDraft: (id) =>
      confirmDraft(id).then((entry) => {
        subjects.push({ draft: id });
        return entry;
      }),
    confirmDay: (day) =>
      confirmDay(day).then((result) => {
        subjects.push({ day });
        return result;
      }),
    dismissDraft: (id) =>
      dismissDraft(id).then(() => {
        subjects.push({ draft: id });
      }),
    toGeneral: (id) =>
      updateDraft(id, { task: null, project: null, general: true }).then((draft) => {
        subjects.push({ draft: id });
        return draft;
      }),
  };
}

/**
 * Undo many, **newest first**, each by the server (`POST /me/time/undo`). What
 * it could not take back — changed since — is said, never hidden.
 */
async function undoEach(subjects: readonly UndoSubject[]): Promise<string> {
  let undone = 0;
  const refused: string[] = [];
  for (const subject of [...subjects].reverse()) {
    try {
      await undo(subject);
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
 * 1): *On your plate* reads the reader's work in the ones they belong to, and
 * *Agent minutes* links a card only when its space is one of them.
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
    undoIt?: () => Promise<string>,
    batchReport = false,
  ): void => {
    toastSeq.current += 1;
    setToast({
      id: toastSeq.current,
      text,
      tone,
      ...(undoIt === undefined ? {} : { undo: undoIt }),
      ...(batchReport ? { batch: true } : {}),
    });
  };

  /** Run one write, keyed so only its own control spins; re-read the day after. */
  const run = async <T,>(
    key: string,
    write: () => Promise<T>,
    said?:
      string | ((result: T) => { readonly text: string; readonly undo?: readonly UndoSubject[] }),
  ): Promise<T | undefined> => {
    setPending(key);
    try {
      const result = await write();
      reload();
      if (said !== undefined) {
        const word = typeof said === 'string' ? { text: said } : said(result);
        const subjects = 'undo' in word ? word.undo : undefined;
        say(
          word.text,
          'info',
          subjects === undefined || subjects.length === 0 ? undefined : () => undoEach(subjects),
        );
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
    total: number,
    work: (api: BulkApi, onProgress: (done: number, total: number) => void) => Promise<BulkResult>,
  ): Promise<readonly string[]> => {
    setPending(key);
    setBatch({ kind: 'running', day: onDay, label, done: 0, total });
    const subjects: UndoSubject[] = [];
    try {
      const result = await work(recording(subjects), (done, of) => {
        setBatch({ kind: 'running', day: onDay, label, done, total: of });
      });
      say(
        result.text,
        result.ok ? 'info' : 'warn',
        subjects.length === 0 ? undefined : () => undoEach(subjects),
        true,
      );
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
      ? run(key, () => updateDraft(held.draft.id, patch), said)
      : run(key, () => updateEntry(held.entry.id, patch), said);

  const onEdge = (lane: LaneBlock, edit: Edit): void => {
    const patch: { started_at?: number; ended_at?: number; minutes: number } = {
      minutes: edit.minutes,
    };
    if (edit.start !== lane.start) patch.started_at = instant(edit.start);
    if (edit.end !== lane.end) patch.ended_at = instant(edit.end);
    if (lane.kind === 'drafted') void run(`edge:${lane.id}`, () => updateDraft(lane.id, patch));
    else void run(`edge:${lane.id}`, () => updateEntry(lane.id, patch));
  };

  const confirmOne = (draft: TimeDraft): void => {
    if (!ready(draft)) {
      say('Pick a card or General first, then confirm.', 'warn');
      return;
    }
    const where = draft.task?.key ?? draft.project?.name ?? 'General';
    void run(
      `confirm:${draft.id}`,
      () => confirmDraft(draft.id),
      () => ({
        text: `${duration(draft.minutes)} confirmed to ${where} — your organisation can see it now.`,
        undo: [{ draft: draft.id }],
      }),
    );
  };

  const dismissOne = (draft: TimeDraft): void => {
    void run(
      `dismiss:${draft.id}`,
      () => dismissDraft(draft.id),
      () => ({
        text: 'Marked not work. A later sync won’t bring it back.',
        undo: [{ draft: draft.id }],
      }),
    );
  };

  const actions: InspectorActions = {
    confirm: confirmOne,
    dismiss: dismissOne,
    setCard: (held, card) => {
      if (held.kind === 'draft') {
        const patch: DraftPatch = card === 'general' ? { general: true } : { task: card };
        void run(
          `card:${held.draft.id}`,
          () => updateDraft(held.draft.id, patch),
          () => ({
            text:
              card === 'general'
                ? 'Moved to General — ready to confirm.'
                : `Put on ${card} — ready to confirm.`,
            undo: [{ draft: held.draft.id }],
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
      const edit = stepEnd(placed, by, line.length);
      if (edit !== undefined) {
        void write(held, { minutes: edit.minutes, ended_at: instant(edit.end) }, `step:${item.id}`);
      }
    },
    split: (draft) => {
      const placed = block(draft.id);
      const at = placed === undefined ? undefined : splitPoint(placed);
      if (at === undefined) return;
      void run(
        `split:${draft.id}`,
        () => splitDraft(draft.id, instant(at)),
        (result) => {
          const [a, b] = result.drafts;
          if (a !== undefined) setSelection({ kind: 'draft', id: a.id });
          return {
            text:
              a === undefined || b === undefined
                ? `Split at ${clock(instant(at), view.tz)}.`
                : `Split at ${clock(instant(at), view.tz)} into ${duration(a.minutes)} and ${duration(b.minutes)}.`,
            undo: [{ draft: draft.id }],
          };
        },
      );
    },
    remove: (entry) => {
      void run(
        `delete:${entry.id}`,
        () => deleteEntry(entry.id),
        () => ({
          text: `${duration(entry.minutes)} deleted. The revision history keeps a record.`,
          undo: [{ entry: entry.id }],
        }),
      );
    },
    saveNote: (entry, note) => {
      const text = note.trim();
      void run(
        `note:${entry.id}`,
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
      void run('unbreak', () => removeBreak(id), 'Not a break — it counts as a gap again.');
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
          run={(key, writeIt, said) => run(key, writeIt, said).then((r) => r !== undefined)}
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
                view.drafts.length,
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
        <div className="myday-grid">
          <div className="myday-main">
            <section className="myday-card myday-day" aria-labelledby="myday-day-title">
              <h2 className="visually-hidden" id="myday-day-title">
                {dayLong(view.day)}
              </h2>
              <StatsStrip view={view} gaps={line.gaps} onGap={pickGap} />
              {view.state === 'future' ? (
                <p className="myday-future">This day has not happened yet.</p>
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
            </section>

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
                  runBatch('bulk', RUNNING[kind], view.day, chosen.length, (api, progress) =>
                    runBulk(kind, chosen, api, progress),
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
                        () => addEntry(entry),
                        (created) => ({
                          text: `${duration(entry.minutes)} added to ${label} — confirmed as you add it.`,
                          undo: [{ entry: created.id }],
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

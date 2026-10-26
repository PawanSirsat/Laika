import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  discardTimer,
  pauseTimer,
  resumeTimer,
  setDraftMyTime,
  startTimer,
  stopTimer,
  type TimerStart,
  setDayNote,
} from '../../../api/time.ts';
import { everyPage } from '../../../api/every-page.ts';
import { getPersonDay, PEOPLE_ANALYTICS } from '../../../api/people-analytics.ts';
import { useGates } from '../../../api/permissions.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import type { MeProfile } from '../../../api/me.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import { AgentStrip } from './AgentStrip.tsx';
import { CHIP_CAP, cardChips, cardChipsWhy } from './card-chips.ts';
import { DayTabs, type DayTab } from './DayTabs.tsx';
import { DraftList, type Batch } from './DraftList.tsx';
import { ConfirmDaySummary } from './ConfirmDaySummary.tsx';
import { DaySettings } from './DaySettings.tsx';
import { TimerControl, timerSeconds } from './TimerControl.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import {
  confirmPlan,
  runBulk,
  runConfirmDay,
  type BulkApi,
  type BulkKind,
  type BulkResult,
} from './draft-bulk.ts';
import { EntryList } from './EntryList.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { UntimedTray } from './UntimedTray.tsx';
import { clock, duration, span } from './format.ts';
import { kindLabel } from './entry-kinds.ts';
import { Inspector, type DraftSaid, type Held, type InspectorActions } from './Inspector.tsx';
import { MyDayDrawer, type DrawerMode } from './MyDayDrawer.tsx';
import { DayEmpty, type EmptyAction, type EmptyKind } from './DayEmpty.tsx';
import { DayError } from './DayError.tsx';
import { DayOff } from './DayOff.tsx';
import { DaySkeleton, DaySkeletonActions } from './DaySkeleton.tsx';
import { HeaderPopover } from './HeaderPopover.tsx';
import { MyDayPhoneBar } from './MyDayPhoneBar.tsx';
import { MyDayPhoneHead } from './MyDayPhoneHead.tsx';
import { TimelineMobile } from './TimelineMobile.tsx';
import { keepZoom, readZoom } from './timeline-prefs.ts';
import { usePhone } from './use-phone.ts';
import { initials } from '../../../theme/initials.ts';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { addDays, canAddTime, dayIn, dayTotals, DRAFT_READERS, isDay } from './my-day-derive.ts';
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
  freeAround,
  STEP,
} from './timeline-derive.ts';
import { Toast, type ToastState } from './Toast.tsx';
import { usePeople, ViewingSwitch } from './ViewingSwitch.tsx';
import { WhoLooked } from './WhoLooked.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { dayLong } from './week-derive.ts';
import './my-day.css';
// The lists as designed (LAI-514), after `my-day.css` so its rules win.
import './lists.css';
// After my-day.css: the phone's rules (LAI-518) win at equal specificity.
import './phone.css';

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
  /**
   * `?user=` — somebody else's day, read only (D-102, LAI-959). Absent, or
   * the reader's own id, is their own day.
   */
  readonly user?: string | undefined;
  /** Whom the *Viewing* switcher picked; `undefined` is the reader again. */
  readonly onUser?: (userId: string | undefined) => void;
  /**
   * Drawn inside a member's profile (LAI-959): the person is fixed and named
   * by the profile, so there is no page title and no switcher.
   */
  readonly embedded?: { readonly name: string } | undefined;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: MyDay }
  | { readonly kind: 'error'; readonly error: unknown };

const RUNNING: Readonly<Record<BulkKind, string>> = {
  confirm: 'Confirming',
  general: 'Moving to General',
  dismiss: 'Marking not work',
  assign: 'Assigning',
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
    confirmDay: (on, note) => confirmDay(on, keep(day), note),
    setDayNote: (on, note) => setDayNote(on, note),
    dismissDraft: (id) => dismissDraft(id, keep([id])),
    toGeneral: (id) => updateDraft(id, { task: null, project: null, general: true }, keep([id])),
    toCard: (id, card) => updateDraft(id, { task: card }, keep([id])),
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

/** The padlock beside who reads drafts. */
/** The design's mark beside *Who can see this*: an i in a ring (LAI-513). */
function InfoMark() {
  return (
    <svg className="myday-lock-icon myday-info-icon" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.6" />
      <path d="M7 6.2v3.6M7 4.2v.1" />
    </svg>
  );
}

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
 * block by block. **Not the team's**: signed in, no token. Besides them, only
 * owners, admins and whoever the owner grants *See everyone's analytics* read
 * it, read only, and every look is listed for them (D-102, LAI-968); what they
 * confirm, or type, is the time the organisation sees.
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
  user,
  onUser,
  embedded,
}: MyDayScreenProps) {
  const tz = readerZone();
  // Deleting an entry and discarding the timer ask first (LAI-522).
  const confirm = useConfirm();
  const { org, settled } = useGates(me !== undefined);
  const holds = org(PEOPLE_ANALYTICS);
  /** Whose day: somebody else's only by `?user=` naming another person. */
  const subjectId = user !== undefined && user !== '' && user !== me?.id ? user : undefined;
  const readOnly = subjectId !== undefined;
  /** A refused `?user=` is decided once the server has said what the reader holds. */
  const refused = readOnly && !holds && settled;
  const people = usePeople(holds && embedded === undefined);
  const subjectName =
    embedded?.name ??
    (subjectId === undefined ? undefined : (people ?? []).find((p) => p.id === subjectId)?.name) ??
    'This person';
  const selectedDay = isDay(day) ? day : dayIn(tz, Date.now());
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [batch, setBatch] = useState<Batch>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  const [sheet, setSheet] = useState(false);
  const [lookedOpen, setLookedOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [summary, setSummary] = useState(false);
  // The drawer beside the page (LAI-511): the editor while something is in
  // hand, or Agent time and On your plate from the header's button, and
  // nothing on load.
  const [beside, setBeside] = useState(false);
  const besideButton = useRef<HTMLButtonElement | null>(null);
  // Fill gaps (LAI-513): walking the day's gaps, one add after another.
  const [fillRun, setFillRun] = useState(false);
  /** The entry a timer just stopped into (LAI-515): its editor says so once. */
  const [justStopped, setJustStopped] = useState<string | undefined>(undefined);
  // The tab under the Timeline (LAI-505): remembered per browser; Overview
  // until one is picked, as the design opens (LAI-514).
  const [tab, setTab] = useState<DayTab | undefined>(() => {
    try {
      const kept = localStorage.getItem('laika.my-day.tab');
      return kept === 'overview' || kept === 'review' || kept === 'confirmed' || kept === 'all'
        ? kept
        : undefined;
    } catch {
      return undefined;
    }
  });
  const pickTab = (next: DayTab): void => {
    setTab(next);
    try {
      localStorage.setItem('laika.my-day.tab', next);
    } catch {
      // A private window keeps nothing; the tab still changes.
    }
  };
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  // 3× by default, and the person's own once they change it (timeline-prefs).
  const [zoom, setZoomState] = useState<Zoom>(readZoom);
  const setZoom = (next: Zoom): void => {
    setZoomState(next);
    keepZoom(next);
  };
  const [now, setNow] = useState(() => Date.now());
  const spaces = useSpaces();
  const plate = usePlate(readOnly ? undefined : me, spaces);
  // The owner's phone page (LAI-518): its own head, bar and Timeline.
  const phone = usePhone();
  const { theme } = useTheme();
  const toastSeq = useRef(0);
  const lastDraftIndex = useRef(0);
  const batching = pending !== undefined && BATCHES.has(pending);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  // Somebody else's day is asked only of a reader who holds the capability:
  // the server would refuse it, and a refused read is the not-allowed state.
  const asking = !readOnly || holds;
  // Another person's day never shows under the last one's — a re-read after a
  // change keeps the page as it is until the answer lands.
  useEffect(() => {
    setLoad({ kind: 'loading' });
  }, [subjectId]);
  useEffect(() => {
    if (!asking) return;
    const controller = new AbortController();
    (subjectId === undefined
      ? getMyDay(selectedDay, tz, controller.signal)
      : getPersonDay(subjectId, selectedDay, tz, controller.signal)
    )
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [selectedDay, tz, tick, subjectId, asking]);

  // The now line moves with the clock.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // The timer's word in the editor goes with the selection that carried it (LAI-515).
  useEffect(() => {
    if (selection?.kind !== 'entry' || selection.id !== justStopped) {
      setJustStopped(undefined);
    }
  }, [selection, justStopped]);

  // A new day, or somebody else's, starts with nothing in hand.
  useEffect(() => {
    setSelection(undefined);
    setBatch({ kind: 'idle' });
    setToast(undefined);
  }, [selectedDay, subjectId]);

  // The selection stays something that exists: a confirmed or dismissed block
  // hands it to the next one, and an open day starts on its first draft.
  useEffect(() => {
    if (load.kind !== 'ready') return;
    const v = load.view;
    setSelection((prev) => {
      // Nothing is in hand until the person picks something (LAI-511).
      if (prev === undefined) return undefined;
      if (prev.kind === 'draft') {
        if (v.drafts.some((d) => d.id === prev.id)) return prev;
        const next = v.drafts[Math.min(lastDraftIndex.current, v.drafts.length - 1)];
        return next === undefined ? undefined : { kind: 'draft', id: next.id };
      }
      if (prev.kind === 'entry') return v.entries.some((e) => e.id === prev.id) ? prev : undefined;
      if (prev.kind === 'break') return v.breaks.some((b) => b.id === prev.id) ? prev : undefined;
      // A range the person dragged is theirs until they let go of it (LAI-897).
      if (prev.kind === 'range') return prev;
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

  // What the drawer holds, if anything (LAI-511). A day not yet begun has no
  // Timeline to pick from, so nothing to edit.
  const drawerMode: DrawerMode | undefined =
    view !== undefined && view.state !== 'future' && selection !== undefined
      ? 'editor'
      : beside
        ? 'cards'
        : undefined;
  const closeDrawer = useCallback(() => {
    setSelection(undefined);
    setBeside(false);
    setFillRun(false);
  }, []);

  // The shell reads this to give the drawer room under 1280px (LAI-511):
  // `AppShell` folds the sidebar to its rail while it is set.
  useEffect(() => {
    const root = document.documentElement;
    if (drawerMode !== undefined) root.setAttribute('data-myday-drawer-open', '');
    else root.removeAttribute('data-myday-drawer-open');
    return () => {
      root.removeAttribute('data-myday-drawer-open');
    };
  }, [drawerMode]);

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

  const title = readOnly && embedded === undefined ? `${subjectName}’s day` : 'My day';
  const switcher =
    holds && embedded === undefined && me !== undefined && onUser !== undefined ? (
      <ViewingSwitch meId={me.id} subjectId={subjectId} people={people} onPick={onUser} />
    ) : undefined;
  // The read-only banner as the design draws it (LAI-513): the eye, one
  // sentence, and the way back.
  const firstName = subjectName.split(' ')[0] ?? subjectName;
  const banner = readOnly && (
    <p className="myday-viewing-banner myday-viewing-read" role="status" data-viewing-banner>
      <svg className="myday-viewing-eye" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </svg>
      <span className="myday-viewing-words">
        <strong>Read-only.</strong> You’re viewing {subjectName}’s day. {firstName} can see that you
        looked.
      </span>
      {onUser !== undefined && embedded === undefined && (
        <button
          type="button"
          className="myday-chip myday-viewing-back"
          data-back-to-my-day
          onClick={() => {
            onUser(undefined);
          }}
        >
          Back to my day
        </button>
      )}
    </p>
  );
  // The page is a row — its column, then the drawer (LAI-511) — so a state
  // with no drawer still sits in the column, header over body (LAI-524).
  const shell = (body: ReactNode, actions?: ReactNode) =>
    embedded === undefined ? (
      <div className="myday-page">
        <div className="myday-column">
          <ScreenHeader variant="page" title={title} description={dayLong(selectedDay)}>
            {switcher}
            {actions}
          </ScreenHeader>
          {banner}
          <div className="myday">{body}</div>
        </div>
      </div>
    ) : (
      <div className="myday-page myday-embedded">
        <div className="myday-column">
          {banner}
          <div className="myday">{body}</div>
        </div>
      </div>
    );

  if (refused) {
    return shell(
      <PermissionDenied resource="other people’s days" requiredRole="admin" scope="organisation" />,
    );
  }

  if (load.kind === 'loading' || view === undefined || line === undefined || !asking) {
    // The designed states (LAI-513): a refused read is still the permission
    // card; anything else is the day's own error card; loading is the
    // Timeline's shape in skeleton.
    return shell(
      load.kind === 'error' ? (
        load.error instanceof ApiError && load.error.code === 'forbidden' ? (
          <ApiErrorState
            error={load.error}
            resource={readOnly ? `${subjectName}’s day` : 'your day'}
            {...(readOnly
              ? { requiredRole: 'admin' as const, scope: 'organisation' as const }
              : {})}
            onRetry={reload}
          />
        ) : (
          <DayError
            day={selectedDay}
            error={load.error}
            request={
              subjectId === undefined
                ? `GET /api/v1/me/time?day=${selectedDay}`
                : `GET /api/v1/people/${subjectId}/time?day=${selectedDay}`
            }
            onRetry={reload}
          />
        )
      ) : (
        <DaySkeleton label={readOnly ? `Reading ${subjectName}’s day` : 'Loading your day'} />
      ),
      // While loading, the header's buttons stand beside Viewing in skeleton (LAI-524).
      load.kind === 'error' || readOnly ? undefined : <DaySkeletonActions />,
    );
  }

  const { settings } = view;
  const addable = canAddTime(settings);
  const totals = dayTotals(view);
  const shownTab: DayTab = tab ?? 'overview';
  const inTab = (t: DayTab): boolean => shownTab === t || shownTab === 'all';
  const draftOff = !readOnly && settings.org_mode === 'drafts' && !settings.draft_my_time;
  // The designed page states (LAI-513): time tracking off for the
  // organisation, a day not begun, a day with nothing on it.
  const orgOff = settings.org_mode === 'off';
  const nothingOn =
    view.drafts.length === 0 && view.entries.length === 0 && view.breaks.length === 0;
  const emptyKind: EmptyKind | undefined =
    view.state === 'future'
      ? 'future'
      : nothingOn
        ? draftOff
          ? 'draftOff'
          : view.day === view.today
            ? 'today'
            : 'past'
        : undefined;
  const showLists = !orgOff && (emptyKind === undefined || emptyKind === 'draftOff');
  const nowMinute = line.now;
  const gapsBeforeNow = nowMinute === undefined ? [] : line.gaps.filter((g) => g.start < nowMinute);
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
  // What *Assign task* offers (the design, LAI-514): the day's cards, then the
  // person's in progress, each once.
  const assignOptions: TaskRef[] = [...onTheDay, ...inProgress].filter(
    (t, at, all) => all.findIndex((o) => o.key === t.key) === at,
  );
  const byAgent: TaskRef[] = view.agent.by_task.filter((t) => t.minutes > 0).map((t) => t.task);
  const chipsFor = (own: TaskRef | null): readonly TaskRef[] =>
    cardChips(own, inProgress, onTheDay);

  const pickGap = (gap: Span): void => {
    setSelection({ kind: 'gap', start: gap.start, end: gap.end });
  };

  const write = (held: Held, patch: DraftPatch & EntryPatch, key: string, said?: string) =>
    held.kind === 'draft'
      ? run(key, [held.draft.id], (onUndo) => updateDraft(held.draft.id, patch, onUndo), said)
      : run(key, [held.entry.id], () => updateEntry(held.entry.id, patch), said);

  /** What a placed block is called in a toast: its card, its space, its title, or General. */
  const nameOf = (kind: 'drafted' | 'confirmed', id: string): string => {
    if (kind === 'drafted') {
      const d = view.drafts.find((x) => x.id === id);
      return d === undefined
        ? 'the block'
        : (d.task?.key ?? d.project?.name ?? (d.general ? 'General' : 'No task yet'));
    }
    const e = view.entries.find((x) => x.id === id);
    return e === undefined
      ? 'the entry'
      : (e.task?.key ??
          (e.title !== null && e.title !== undefined && e.title !== ''
            ? e.title
            : (e.project?.name ?? 'General')));
  };

  // An edge dragged or stepped, or a block moved or resized by its body
  // (LAI-512): one write of the edges that moved; a drag says so, with Undo
  // where the server offers it.
  const onEdge = (lane: LaneBlock, edit: Edit, how?: 'move' | 'resize'): void => {
    if (readOnly) return;
    const patch: { started_at?: number; ended_at?: number; minutes: number } = {
      minutes: edit.minutes,
    };
    if (edit.start !== lane.start) patch.started_at = instant(edit.start);
    if (edit.end !== lane.end) patch.ended_at = instant(edit.end);
    const said =
      how === undefined
        ? undefined
        : () => ({
            text: `${how === 'move' ? 'Moved' : 'Changed'} ${nameOf(lane.kind, lane.id)} to ${span(instant(edit.start), instant(edit.end), view.tz)}.`,
            undoable: lane.kind === 'drafted',
          });
    if (lane.kind === 'drafted') {
      void run(`edge:${lane.id}`, [lane.id], (onUndo) => updateDraft(lane.id, patch, onUndo), said);
    } else {
      void run(`edge:${lane.id}`, [lane.id], () => updateEntry(lane.id, patch), said);
    }
  };

  // A tray item dropped on the track (LAI-512): the time it landed on, one write.
  const onDropEntry = (
    item: { readonly kind: 'draft' | 'entry'; readonly id: string },
    s: Span,
  ): void => {
    if (readOnly) return;
    const patch = { started_at: instant(s.start), ended_at: instant(s.end) };
    const text = `Placed ${nameOf(item.kind === 'draft' ? 'drafted' : 'confirmed', item.id)} at ${span(patch.started_at, patch.ended_at, view.tz)}.`;
    if (item.kind === 'draft') {
      void run(
        `place:${item.id}`,
        [item.id],
        (onUndo) => updateDraft(item.id, patch, onUndo),
        () => ({ text, undoable: true }),
      );
    } else {
      void run(`place:${item.id}`, [item.id], () => updateEntry(item.id, patch), text);
    }
    setSelection({ kind: item.kind, id: item.id });
  };

  const confirmOne = (draft: TimeDraft, said?: DraftSaid): void => {
    if (!ready(draft)) {
      say('Pick a card or General first, then confirm.', 'warn');
      return;
    }
    const where = draft.task?.key ?? draft.project?.name ?? 'General';
    const words =
      said === undefined || Object.keys(said).length === 0
        ? undefined
        : {
            ...(said.kind === undefined ? {} : { kind: said.kind }),
            ...(said.title === undefined ? {} : { title: said.title }),
            ...(said.description === undefined ? {} : { description: said.description }),
          };
    void run(
      `confirm:${draft.id}`,
      [draft.id],
      (onUndo) => confirmDraft(draft.id, onUndo, words),
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

  // One way an entry is added — from the form below or the panel beside the
  // Timeline (LAI-897) — and the new entry is selected after.
  const addOne = async (entry: NewEntry, label: string): Promise<boolean> => {
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
    // A timer whose stop the clock refused (LAI-502) is done once its time is in by hand.
    if (selection?.kind === 'range' && selection.fromTimer === true && view.timer !== null) {
      await discardTimer().catch(() => undefined);
      reload();
    }
    // Fill gaps (LAI-513): the next gap, until there is none.
    if (fillRun && selection?.kind === 'gap') {
      const filled = selection.start;
      const next = gapsBeforeNow.find((g) => g.start > filled);
      if (next !== undefined) {
        pickGap(next);
        return true;
      }
      setFillRun(false);
      say('All gaps filled.');
    }
    setSelection({ kind: 'entry', id: made.id });
    return true;
  };

  // The timer (D-110 item 1, LAI-502): each action one write, the day re-read after.
  const timerStart = (input: TimerStart): void => {
    void run(
      'timer',
      [],
      () => startTimer(input),
      input.task === undefined ? 'Timer started.' : `Timer started on ${input.task}.`,
    );
  };
  /** Discard the timer — the time it ran is lost, so it asks first, naming it (LAI-522). */
  const timerDiscard = async (): Promise<void> => {
    const timer = view.timer;
    if (timer === null) return;
    const minutes = Math.floor(timerSeconds(timer, Date.now()) / 60);
    const what =
      timer.task?.key ?? timer.title ?? (timer.kind === null ? 'The timer' : kindLabel(timer.kind));
    const yes = await confirm({
      title: 'Discard the timer?',
      body: 'The time it has run is not saved anywhere. Stop saves it as an entry instead.',
      confirmLabel: 'Discard',
      danger: true,
      detail: (
        <span data-confirm-timer>
          <span className="confirm-detail-main">{what}</span>
          <span className="confirm-detail-sub">
            {minutes < 1 ? 'Under a minute' : duration(minutes)} run, not saved
          </span>
        </span>
      ),
    });
    if (!yes) return;
    await run('timer', [], () => discardTimer(), 'Timer discarded — nothing saved.');
  };

  const timerStop = async (): Promise<void> => {
    const timer = view.timer;
    if (timer === null) return;
    setPending('timer');
    let undoId: string | undefined;
    try {
      const stopped = await stopTimer((id) => {
        undoId = id;
      });
      reload();
      say(
        stopped.crossed_midnight
          ? `${duration(stopped.entry.minutes)} saved on ${dayLong(stopped.entry.day)} with no set time — the timer ran past midnight.`
          : `${duration(stopped.entry.minutes)} saved from the timer — confirmed as you stop it.`,
        'info',
        undoId === undefined ? [] : [{ undoId, blocks: [stopped.entry.id] }],
      );
      if (stopped.entry.day === view.day) {
        setSelection({ kind: 'entry', id: stopped.entry.id });
        setJustStopped(stopped.entry.id);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict' && line.midnight !== undefined) {
        // Over confirmed time: the timer stays, and its span opens beside the
        // Timeline with what it said, for the person to adjust and add.
        const minute = (ms: number): number =>
          Math.max(0, Math.min(1440, Math.round((ms - line.midnight!) / 60_000 / STEP) * STEP));
        const start = minute(timer.started_at);
        const end = Math.max(start + STEP, minute(timer.paused_at ?? Date.now()));
        say(`${cause.message} Adjust the time beside the Timeline, then add it.`, 'warn');
        setSelection({
          kind: 'range',
          start,
          end,
          prefill: {
            ...(timer.task === null ? {} : { task: timer.task.key }),
            ...(timer.kind === null ? {} : { kind: timer.kind }),
            ...(timer.title === null ? {} : { title: timer.title }),
          },
          fromTimer: true,
        });
      } else {
        say(messageOf(cause), 'error');
      }
    } finally {
      setPending(undefined);
    }
  };

  // *Add time* (LAI-502): the last free half hour before now, or no set time.
  const addTime = (): void => {
    if (readOnly || !addable || busy) return;
    const confirmed = line.blocks.filter((b) => b.kind === 'confirmed');
    const nowMinute =
      view.day === view.today && line.midnight !== undefined
        ? Math.floor((Date.now() - line.midnight) / 60_000)
        : 17 * 60;
    const anchor = Math.max(STEP, Math.min(1440, Math.floor(nowMinute / STEP) * STEP));
    const free = freeAround(anchor - 1, confirmed, line.from * 60, line.to * 60);
    if (free !== undefined) {
      const end = Math.min(anchor, free.hi);
      const start = Math.max(free.lo, end - 30);
      if (end - start >= STEP) {
        setSelection({ kind: 'range', start, end, from: 'button' });
        return;
      }
    }
    setSelection({ kind: 'range', start: anchor - 30, end: anchor, untimed: true, from: 'button' });
  };

  const turnDraftingOn = (): void => {
    void run(
      'switch',
      [],
      () => setDraftMyTime(true),
      'Draft my time is on. Your collector drafts from its next sync.',
    );
  };

  // What an empty Timeline offers (LAI-513), by why it is empty.
  const emptyActions: readonly EmptyAction[] = readOnly
    ? emptyKind === 'future' || emptyKind === 'past'
      ? [{ label: 'Back to today', go: () => onDay(view.today) }]
      : []
    : emptyKind === 'future'
      ? [{ label: 'Back to today', go: () => onDay(view.today) }]
      : emptyKind === 'draftOff'
        ? [
            { label: 'Turn drafting on', primary: true, go: turnDraftingOn },
            { label: 'Add time', go: addTime },
          ]
        : emptyKind === 'past'
          ? [
              { label: 'Back to today', go: () => onDay(view.today) },
              { label: 'Add time', go: addTime },
            ]
          : [
              {
                label: 'Start timer',
                primary: true,
                go: () => {
                  setTimerOpen(true);
                },
              },
              { label: 'Add time', go: addTime },
            ];

  const actions: InspectorActions = {
    confirm: confirmOne,
    setSpan: (held, next) => {
      const item = held.kind === 'draft' ? held.draft : held.entry;
      const placed = block(item.id);
      // Only the edge that moved goes, as a drag's does; a block with no span
      // gets both. The minutes follow the span.
      const patch: { started_at?: number; ended_at?: number; minutes: number } = {
        minutes: next.end - next.start,
      };
      if (next.start !== placed?.start) patch.started_at = instant(next.start);
      if (next.end !== placed?.end) patch.ended_at = instant(next.end);
      void write(held, patch, `span:${item.id}`);
    },
    splitAt: (draft, at) => {
      void run(
        `split:${draft.id}`,
        [draft.id],
        (onUndo) => splitDraft(draft.id, at, onUndo),
        (result) => {
          const [a, b] = result.drafts;
          if (a !== undefined) setSelection({ kind: 'draft', id: a.id });
          return {
            text:
              a === undefined || b === undefined
                ? `Split at ${clock(at, view.tz)}.`
                : `Split at ${clock(at, view.tz)} into ${duration(a.minutes)} and ${duration(b.minutes)}.`,
            undoable: true,
            blocks: result.drafts.map((d) => d.id),
          };
        },
      );
    },
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
      const when =
        entry.started_at === null || entry.ended_at === null
          ? 'No set time'
          : span(entry.started_at, entry.ended_at, entry.tz);
      const what =
        entry.task?.title ??
        entry.title ??
        (entry.kind === undefined || entry.kind === null ? 'General' : kindLabel(entry.kind));
      void confirm({
        title: 'Delete this entry?',
        body: 'It comes off your confirmed time and the hours your organisation sees. Its history keeps a record, and Undo brings it back for a moment after.',
        confirmLabel: 'Delete entry',
        danger: true,
        detail: (
          <span data-confirm-entry>
            <span className="confirm-detail-main">
              {entry.task !== null && <strong>{entry.task.key}</strong>} {what}
            </span>
            <span className="confirm-detail-sub">
              {when} · {duration(entry.minutes)}
            </span>
          </span>
        ),
      }).then((yes) => {
        if (!yes) return;
        void run(
          `delete:${entry.id}`,
          [entry.id],
          (onUndo) => deleteEntry(entry.id, onUndo),
          () => ({
            text: `${duration(entry.minutes)} deleted. The revision history keeps a record.`,
            undoable: true,
          }),
        );
      });
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
    add: addOne,
    letGo: () => {
      setSelection(undefined);
    },
    setKind: (entry, kind) => {
      void run(
        `kind:${entry.id}`,
        [entry.id],
        () => updateEntry(entry.id, { kind }),
        kind === null ? 'Kind cleared. Every edit is kept as a revision.' : 'Kind saved.',
      );
    },
    saveDetails: (entry, details) => {
      const text = (s: string): string | null => (s.trim() === '' ? null : s.trim());
      const patch: EntryPatch = {};
      const next = {
        title: text(details.title),
        description: text(details.description),
        note: text(details.note),
      };
      if (next.title !== (entry.title ?? null)) Object.assign(patch, { title: next.title });
      if (next.description !== (entry.description ?? null)) {
        Object.assign(patch, { description: next.description });
      }
      if (next.note !== entry.note) Object.assign(patch, { note: next.note });
      if (Object.keys(patch).length === 0) return;
      void run(
        `details:${entry.id}`,
        [entry.id],
        () => updateEntry(entry.id, patch),
        'Saved. Every edit is kept as a revision.',
      );
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
          setSelection({ kind: 'break', id: made.id });
          return { text: `${range} is a break — not time, and not a gap.` };
        },
      );
    },
    unbreak: (id) => {
      void run('unbreak', [], () => removeBreak(id), 'Not a break — it counts as a gap again.');
    },
    pickGap,
    workFromBreak: (b) => {
      // The break goes, and its span opens as Add time (the design's *Turn into work time*).
      void run('unbreak', [], () => removeBreak(b.id), 'Not a break — add what it was.').then(
        (made) => {
          if (made !== undefined) {
            setSelection({ kind: 'range', start: b.start, end: b.end, from: 'gap' });
          }
        },
      );
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
      if (selection !== undefined) {
        // Esc closes the editor (LAI-508, LAI-511): the drawer goes.
        setSelection(undefined);
        return true;
      }
      if (beside) {
        setBeside(false);
        return true;
      }
      return false;
    }
    if (dialog !== null || busy) return false;
    if (shortcut === 'add') {
      if (readOnly || !addable) return false;
      addTime();
      return true;
    }
    if (shortcut === 'timer') {
      if (readOnly || !addable) return false;
      if (view.timer === null) setTimerOpen(true);
      else void timerStop();
      return true;
    }
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
    if (current === undefined || readOnly) return false;
    if (shortcut === 'confirm') confirmOne(current);
    else if (shortcut === 'dismiss') dismissOne(current);
    else if (!current.general) actions.setCard({ kind: 'draft', draft: current }, 'general');
    return true;
  };

  const selectedId =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? selection.id
      : undefined;

  // The phone's page (the owner's `MyDay.dc.html`, LAI-518): the day row, the
  // letter week and the summary in place of the desktop header; the eye, the
  // switch and the avatar in the shell's top bar.
  const own = !readOnly && addable;
  const phoneBeside = (
    <button
      type="button"
      className="myday-chip myday-head-icon"
      ref={besideButton}
      aria-label={readOnly ? `Beside ${subjectName}’s day` : 'Beside your day'}
      title={readOnly ? 'Agent time' : 'Agent time and On your plate'}
      aria-expanded={drawerMode === 'cards'}
      data-beside-button
      onClick={() => {
        if (selection !== undefined) {
          setSelection(undefined);
          setBeside(true);
        } else {
          setBeside((open) => !open);
        }
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="1.5"
          y="2"
          width="13"
          height="5"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <rect
          x="1.5"
          y="9.5"
          width="13"
          height="4.5"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    </button>
  );
  const avatar =
    me === undefined ? null : (
      <span
        className="myday-bar-avatar"
        aria-hidden="true"
        style={{
          background: avatarColorSolid(me.id, theme).background,
          color: avatarColorSolid(me.id, theme).foreground,
        }}
      >
        {initials(me.name)}
      </span>
    );
  const phoneBar =
    phone && embedded === undefined ? (
      <MyDayPhoneBar>
        {/* Not in the design's bar, which has no other way to Agent time and On your plate. */}
        {phoneBeside}
        {!readOnly && (
          <WhoLooked
            tz={view.tz}
            today={view.today}
            open={lookedOpen}
            onOpenChange={setLookedOpen}
          />
        )}
        {switcher}
        {avatar}
      </MyDayPhoneBar>
    ) : null;
  const phoneHead =
    phone && embedded === undefined ? (
      <MyDayPhoneHead
        view={view}
        readOnly={readOnly}
        subjectName={subjectName}
        locked={batching}
        onDay={onDay}
        {...(own
          ? {
              tools: (
                <>
                  <TimerControl
                    timer={view.timer}
                    tz={view.tz}
                    chips={chipsFor(null)}
                    busy={busy}
                    open={timerOpen}
                    onOpenChange={setTimerOpen}
                    onStart={timerStart}
                    onPause={() => {
                      void run('timer', [], () => pauseTimer(), 'Timer paused.');
                    }}
                    onResume={() => {
                      void run('timer', [], () => resumeTimer(), 'Timer running.');
                    }}
                    onStop={() => {
                      void timerStop();
                    }}
                    onDiscard={() => {
                      void timerDiscard();
                    }}
                  />
                  <button
                    type="button"
                    className="myday-chip myday-head-icon"
                    data-add-time
                    title="Add time (N)"
                    aria-label="Add time"
                    disabled={busy || batching}
                    onClick={addTime}
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M6 1.5v9M1.5 6h9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <DaySettings
                    settings={settings}
                    held={view.drafts_held}
                    tz={view.tz}
                    pending={pending}
                    run={(key, writeIt, said) =>
                      run(key, [], () => writeIt(), said).then((r) => r !== undefined)
                    }
                  />
                </>
              ),
            }
          : {})}
        {...(readOnly
          ? {}
          : view.drafts.length > 0
            ? {
                action: (
                  <button
                    type="button"
                    className="myday-chip myday-chip-primary myday-phone-confirm"
                    data-confirm-day
                    ref={confirmButton}
                    disabled={busy || dayPlan.ready.length === 0}
                    title={
                      dayPlan.needCard.length > 0
                        ? `${String(dayPlan.needCard.length)} without a task stay in To review`
                        : `Confirm every drafted block of ${dayLong(view.day)}`
                    }
                    onClick={() => {
                      setSummary(true);
                    }}
                  >
                    {pending === 'confirm-day' && <Spinner size="sm" label="Confirming the day" />}
                    {dayPlan.ready.length === 0
                      ? 'Confirm day'
                      : `Confirm ${duration(readyMinutes)}`}
                  </button>
                ),
              }
            : addable && view.state !== 'future'
              ? {
                  action: (
                    <button
                      type="button"
                      className="myday-chip myday-head-button"
                      data-day-note-button
                      title="A note for whoever reads your day"
                      onClick={() => {
                        setSummary(true);
                      }}
                    >
                      {view.day_note === null ? 'Day note' : 'Edit day note'}
                    </button>
                  ),
                }
              : {})}
      />
    ) : undefined;

  return (
    <div
      className={embedded === undefined ? 'myday-page' : 'myday-page myday-embedded'}
      data-drawer-open={drawerMode === undefined ? undefined : 'true'}
      // `phone.css` keys its rules for the page's shared markup on this (LAI-518).
      data-phone={phone ? '' : undefined}
    >
      <div className="myday-column">
        {phoneBar}
        {phoneHead}
        {embedded === undefined && phoneHead === undefined ? (
          <ScreenHeader
            variant="page"
            title={title}
            context={
              orgOff ? undefined : (
                <span className="myday-figure" data-day-total>
                  <span className="myday-figure-total">
                    {/* A past day nothing reached is no signal, never 0 min (LAI-831). */}
                    {emptyKind === 'past' ? '—' : duration(totals.confirmed + totals.drafted)}
                  </span>
                  <span className="myday-figure-sub">
                    {view.state === 'future'
                      ? 'not started'
                      : emptyKind === 'past'
                        ? 'no signal'
                        : totals.drafted > 0
                          ? `${duration(totals.drafted)} to review`
                          : totals.confirmed > 0
                            ? `${duration(totals.confirmed)} confirmed`
                            : 'nothing yet'}
                  </span>
                </span>
              )
            }
            description={
              <span className="myday-subtitle">
                <span>
                  {dayLong(view.day)}
                  {view.day === view.today && ' · today'}
                </span>
                <span className="myday-subtitle-dot" aria-hidden="true" />
                {readOnly ? (
                  <span className="myday-lock">
                    <Padlock />
                    {`Read only · ${subjectName} sees that you looked`}
                  </span>
                ) : (
                  // Who reads what, truthfully (D-102, LAI-968): the design's
                  // popover (LAI-513), its words in the tooltip too, and the
                  // way to every look.
                  <HeaderPopover
                    trigger={
                      <>
                        <InfoMark />
                        Who can see this
                      </>
                    }
                    label="Who can see this"
                    title={`Drafts: you, owners and admins. Your drafts can be read by you and by ${DRAFT_READERS}. Every look is listed under Who looked.`}
                    triggerClassName="myday-lock myday-lock-link myday-who-trigger"
                    width="who"
                    align="left"
                    dataAttr="data-who-can-see"
                  >
                    <span className="myday-pop-title">Who can see this</span>
                    <dl className="myday-who-grid">
                      <dt>Drafts</dt>
                      <dd>You, and {DRAFT_READERS}</dd>
                      <dt>Confirmed</dt>
                      <dd>The same readers — the time your organisation sees</dd>
                      <dt>Agent time</dt>
                      <dd>Anyone on the space, never counted as yours</dd>
                    </dl>
                    <p className="myday-quiet myday-pop-text">
                      When an owner or admin opens your day, it shows under{' '}
                      <button
                        type="button"
                        className="myday-linkish"
                        onClick={() => {
                          setLookedOpen(true);
                        }}
                      >
                        Who looked
                      </button>
                      . Counts only, never what you typed.
                    </p>
                  </HeaderPopover>
                )}
              </span>
            }
            below={
              orgOff ? undefined : (
                <div className="myday-below">
                  {/* A phone walks the days one at a time (LAI-502); the width decides, in CSS. */}
                  <div className="myday-daynav" data-day-nav>
                    <button
                      type="button"
                      className="myday-week-step"
                      aria-label="Previous day"
                      disabled={batching}
                      onClick={() => {
                        onDay(addDays(view.day, -1));
                      }}
                    >
                      <span aria-hidden="true">‹</span>
                    </button>
                    <span className="myday-daynav-title">
                      <strong>{dayLong(view.day)}</strong>
                      {totals.confirmed + totals.drafted > 0 && (
                        <span className="myday-quiet">
                          {duration(totals.confirmed + totals.drafted)}
                          {totals.drafted > 0 && ` · ${duration(totals.drafted)} to review`}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="myday-week-step"
                      aria-label="Next day"
                      disabled={batching || view.day >= view.today}
                      onClick={() => {
                        onDay(addDays(view.day, 1));
                      }}
                    >
                      <span aria-hidden="true">›</span>
                    </button>
                  </div>
                  <WeekStrip
                    week={view.week}
                    selected={view.day}
                    today={view.today}
                    locked={batching}
                    onPick={onDay}
                  />
                </div>
              )
            }
          >
            {switcher}
            {switcher !== undefined && !readOnly && (
              <span className="myday-head-divider" aria-hidden="true" />
            )}
            {!readOnly && addable && (
              <>
                <TimerControl
                  timer={view.timer}
                  tz={view.tz}
                  chips={chipsFor(null)}
                  busy={busy}
                  open={timerOpen}
                  onOpenChange={setTimerOpen}
                  onStart={timerStart}
                  onPause={() => {
                    void run('timer', [], () => pauseTimer(), 'Timer paused.');
                  }}
                  onResume={() => {
                    void run('timer', [], () => resumeTimer(), 'Timer running.');
                  }}
                  onStop={() => {
                    void timerStop();
                  }}
                  onDiscard={() => {
                    void timerDiscard();
                  }}
                />
                <button
                  type="button"
                  className="myday-chip myday-head-button"
                  data-add-time
                  title="Add time (N)"
                  aria-label="Add time"
                  disabled={busy || batching}
                  onClick={addTime}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                    <path
                      d="M6 1.5v9M1.5 6h9"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="myday-head-text">Add time</span>
                  <kbd className="myday-kbd myday-kbd-hint">N</kbd>
                </button>
                {/* Fill gaps (the design, LAI-513): today's gaps before now, one after another. */}
                {view.day === view.today && gapsBeforeNow.length > 0 && (
                  <button
                    type="button"
                    className="myday-chip myday-head-button myday-fill-gaps"
                    data-fill-gaps
                    title="Walk through each gap and fill it with a task"
                    disabled={busy || batching}
                    onClick={() => {
                      const first = gapsBeforeNow[0];
                      if (first !== undefined) {
                        pickGap(first);
                        setFillRun(true);
                      }
                    }}
                  >
                    <span className="myday-head-text">Fill gaps</span>
                    <span className="myday-fill-gaps-sub">
                      {String(gapsBeforeNow.length)} ·{' '}
                      {duration(gapsBeforeNow.reduce((sum, g) => sum + g.end - g.start, 0))}
                    </span>
                  </button>
                )}
              </>
            )}
            {!readOnly && addable && view.state !== 'future' && (
              <button
                type="button"
                className="myday-chip myday-chip-primary myday-confirm-day"
                data-confirm-day
                ref={confirmButton}
                disabled={busy || dayPlan.ready.length === 0}
                title={
                  dayPlan.needCard.length > 0
                    ? `${String(dayPlan.needCard.length)} without a task stay in To review`
                    : 'Confirm every draft on this day (Enter on a single item)'
                }
                onClick={() => {
                  setSummary(true);
                }}
              >
                {pending === 'confirm-day' && <Spinner size="sm" label="Confirming the day" />}
                <span className="myday-confirm-label">
                  {view.drafts.length === 0 ? 'Day confirmed' : 'Confirm day'}
                  {dayPlan.ready.length > 0 && (
                    <span className="myday-confirm-sub">
                      {dayPlan.needCard.length > 0
                        ? ` ${String(dayPlan.ready.length)} ready · ${duration(readyMinutes)}`
                        : ` ${duration(readyMinutes)}`}
                    </span>
                  )}
                </span>
              </button>
            )}
            {!readOnly && addable && view.drafts.length === 0 && view.state !== 'future' && (
              <button
                type="button"
                className="myday-chip myday-head-button"
                data-day-note-button
                title="A note for whoever reads your day"
                onClick={() => {
                  setSummary(true);
                }}
              >
                <span className="myday-head-text">
                  {view.day_note === null ? 'Day note' : 'Edit day note'}
                </span>
              </button>
            )}
            {!readOnly && !orgOff && (
              <DaySettings
                settings={settings}
                held={view.drafts_held}
                tz={view.tz}
                pending={pending}
                run={(key, writeIt, said) =>
                  run(key, [], () => writeIt(), said).then((r) => r !== undefined)
                }
              />
            )}
            {!readOnly && (
              <WhoLooked
                tz={view.tz}
                today={view.today}
                open={lookedOpen}
                onOpenChange={setLookedOpen}
              />
            )}
            <button
              type="button"
              className="myday-chip myday-head-icon"
              ref={besideButton}
              aria-label={readOnly ? `Beside ${subjectName}’s day` : 'Beside your day'}
              title={readOnly ? 'Agent time' : 'Agent time and On your plate'}
              aria-expanded={drawerMode === 'cards'}
              data-beside-button
              onClick={() => {
                if (selection !== undefined) {
                  setSelection(undefined);
                  setBeside(true);
                } else {
                  setBeside((open) => !open);
                }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="1.5"
                  y="2"
                  width="13"
                  height="5"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <rect
                  x="1.5"
                  y="9.5"
                  width="13"
                  height="4.5"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
            </button>
            <button
              type="button"
              className="myday-chip myday-head-icon"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              data-shortcuts-button
              onClick={() => {
                setSheet(true);
              }}
            >
              ?
            </button>
          </ScreenHeader>
        ) : embedded === undefined ? null : (
          <div className="myday-embed-head">
            <p className="myday-subtitle">
              <span>
                {dayLong(view.day)}
                {view.day === view.today && ' · today'}
              </span>
            </p>
            <WeekStrip week={view.week} selected={view.day} today={view.today} onPick={onDay} />
          </div>
        )}
        {banner}
        {readOnly && view.day_note !== null && (
          <p className="myday-viewing-banner myday-day-note" data-day-note>
            <strong>
              {subjectName}’s note for {dayLong(view.day)}:
            </strong>{' '}
            {view.day_note.note}
          </p>
        )}
        {draftOff && (
          <p className="myday-viewing-banner myday-draft-off" role="status" data-draft-off>
            <strong>Draft my time is off.</strong> Laika isn’t drafting from your activity. Time you
            add or record with a timer still counts.{' '}
            <button
              type="button"
              className="myday-linkish"
              disabled={busy}
              onClick={turnDraftingOn}
            >
              Turn on
            </button>
          </p>
        )}

        <div className="myday" data-myday-ready>
          {/* The Timeline spans the page (LAI-889, the v3 design); the tray, the tabs and the lists sit under it, and the editor beside the page (LAI-511). */}
          {orgOff ? (
            <DayOff
              onOpenSettings={() => {
                onNavigate('/organisation');
              }}
            />
          ) : emptyKind !== undefined ? (
            <DayEmpty day={view.day} kind={emptyKind} actions={emptyActions} />
          ) : phone ? (
            <TimelineMobile
              view={view}
              line={line}
              selection={selection}
              onSelect={(next) => {
                if (next.kind === 'gap') pickGap(next);
                else setSelection(next);
              }}
              onAgent={() => {
                // An agent's bar opens Agent time in the sheet, as the header's button does.
                setSelection(undefined);
                setBeside(true);
              }}
              readOnly={readOnly}
            />
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
              onDropEntry={onDropEntry}
              onTimerClick={() => {
                // The running timer's controls are the header's pill: a click
                // on its block hands the keyboard to them.
                document.querySelector<HTMLElement>('[data-timer] button')?.focus();
              }}
              busy={busy}
              readOnly={readOnly}
            />
          )}
          <div className="myday-main">
            {showLists && (
              <UntimedTray
                drafts={view.drafts}
                entries={view.entries}
                selected={selectedId}
                readOnly={readOnly}
                draggable={!readOnly && addable && !busy}
                onPick={(item) => {
                  setSelection(item);
                }}
              />
            )}
            {showLists && (
              <DayTabs
                current={shownTab}
                counts={{ review: view.drafts.length, confirmed: view.entries.length }}
                onPick={pickTab}
              />
            )}
            {showLists && inTab('overview') && <OverviewTab view={view} subjectId={subjectId} />}
            {showLists && inTab('review') && (
              <DraftList
                // A new day starts with nothing ticked.
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
                readOnly={readOnly}
                draftOff={draftOff}
                assignOptions={assignOptions}
                onBulk={(kind, chosen, card) =>
                  runBatch(
                    'bulk',
                    kind === 'assign' && card !== undefined ? `Putting on ${card}` : RUNNING[kind],
                    view.day,
                    chosen.map((d) => d.id),
                    (api, progress) => runBulk(kind, chosen, api, progress, card),
                  )
                }
              />
            )}
            {showLists && inTab('confirmed') && (
              <EntryList
                key={`entries-${view.day}`}
                entries={view.entries}
                selected={selectedId}
                readOnly={readOnly}
                subjectName={subjectName}
                onSelect={(entry) => {
                  setSelection({ kind: 'entry', id: entry.id });
                }}
                onNavigate={onNavigate}
              />
            )}
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
      </div>

      {/*
        The drawer (the owner's design, LAI-511): the editor whenever something
        is in hand — a block, a gap, a range, a break, a tray item — or Agent
        time and On your plate from the header's button; nothing on load.
      */}
      {drawerMode !== undefined && (
        <MyDayDrawer
          mode={drawerMode}
          label={
            drawerMode === 'cards'
              ? readOnly
                ? `Beside ${subjectName}’s day`
                : 'Beside your day'
              : selection?.kind === 'range' || selection?.kind === 'gap'
                ? 'Add time'
                : 'Edit this time'
          }
          onClose={closeDrawer}
        >
          {drawerMode === 'editor' && selection !== undefined ? (
            <Inspector
              key={
                'id' in selection
                  ? `${selection.kind}-${selection.id}`
                  : `${selection.kind}-${String(selection.start)}`
              }
              view={view}
              line={line}
              selection={selection}
              chipsFor={(own) => cardChipsWhy(own, inProgress, onTheDay, CHIP_CAP, byAgent)}
              agentsIn={(span) => agentsDuring(line.agents, span)}
              subject={subjectName}
              stopped={justStopped}
              undo={
                toast?.undo === undefined || busy
                  ? undefined
                  : () => {
                      if (toast.undo !== undefined) runUndo(toast.undo);
                    }
              }
              pending={pending}
              actions={actions}
              onNavigate={onNavigate}
              readOnly={readOnly}
              position={
                selection.kind === 'draft' && view.drafts.length > 0
                  ? {
                      index: Math.max(
                        0,
                        view.drafts.findIndex((d) => d.id === selection.id),
                      ),
                      total: view.drafts.length,
                    }
                  : undefined
              }
              onPrev={() => onShortcut.current('prev')}
              onNext={() => onShortcut.current('next')}
              onClose={closeDrawer}
            />
          ) : (
            <>
              <header className="myday-drawer-head">
                <h2 className="myday-drawer-title">
                  {readOnly ? `Beside ${subjectName}’s day` : 'Beside your day'}
                </h2>
                <button
                  type="button"
                  className="myday-week-step inspector-close"
                  aria-label="Close (Esc)"
                  onClick={closeDrawer}
                >
                  ×
                </button>
              </header>
              <div className="myday-drawer-cards">
                <AgentStrip agent={view.agent} spaces={spaces} onNavigate={onNavigate} />
                {!readOnly && (
                  <OnYourPlate
                    me={me}
                    spaces={spaces}
                    load={plate}
                    queue={queue}
                    reviewCapped={queueCapped}
                    onNavigate={onNavigate}
                  />
                )}
              </div>
            </>
          )}
        </MyDayDrawer>
      )}
      {summary && (
        <ConfirmDaySummary
          view={view}
          ready={dayPlan.ready}
          needCard={dayPlan.needCard}
          busy={busy}
          restore={() => confirmButton.current}
          onClose={() => {
            setSummary(false);
          }}
          onConfirm={(note) => {
            setSummary(false);
            // The note goes only when it changed: an untouched field sends nothing.
            const changed = note.trim() !== (view.day_note?.note ?? '').trim();
            void runBatch(
              'confirm-day',
              'Confirming',
              view.day,
              view.drafts.map((d) => d.id),
              (api, progress) =>
                runConfirmDay(view.drafts, view.day, api, progress, changed ? note : undefined),
            );
          }}
          onSaveNote={(note) => {
            setSummary(false);
            void run(
              'note',
              [],
              () => setDayNote(view.day, note.trim() === '' ? null : note),
              note.trim() === ''
                ? 'Note removed.'
                : 'Note saved — shared with whoever reads your day.',
            );
          }}
        />
      )}
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

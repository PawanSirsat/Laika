import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  addEntry,
  confirmDay,
  confirmDraft,
  deleteEntry,
  dismissDraft,
  getMyDay,
  splitDraft,
  updateDraft,
  updateEntry,
  type MyDay,
  type NewEntry,
} from '../../../api/time.ts';
import { everyPage } from '../../../api/every-page.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { formatDuration } from '../../../api/duration.ts';
import { AddTimeForm } from './AddTimeForm.tsx';
import { AgentStrip } from './AgentStrip.tsx';
import { DraftList, type Batch } from './DraftList.tsx';
import { DraftMyTime } from './DraftMyTime.tsx';
import { EntryList } from './EntryList.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { DayBar } from './DayBar.tsx';
import { OnYourPlate } from './OnYourPlate.tsx';
import { dayLong } from './day-timeline.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import {
  confirmPlan,
  needCardLine,
  runBulk,
  runConfirmDay,
  type BulkApi,
  type BulkKind,
  type BulkResult,
} from './draft-bulk.ts';
import { STATE_LABELS, canAddTime, dayIn, dayTotals, isDay } from './my-day-derive.ts';
import './my-day.css';

export interface MyDayScreenProps {
  /** `?day=` — a calendar day in the reader's zone; today when absent. */
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
  /** Whose plate (LAI-796): their own open tasks. */
  readonly me?: MeProfile | undefined;
  /** The review queue the shell holds for the sidebar's badge. */
  readonly queue?: readonly ReviewQueueItem[] | undefined;
  /** Open a task from *On your plate* without reloading the page. */
  readonly onNavigate?: (to: string) => void;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: MyDay }
  | { readonly kind: 'error'; readonly error: unknown };

/** The writes a batch makes (LAI-810) — the endpoints that exist, one block at a time. */
const BULK_API: BulkApi = {
  confirmDraft,
  confirmDay,
  dismissDraft,
  toGeneral: (id) => updateDraft(id, { task: null, project: null, general: true }),
};

const RUNNING: Readonly<Record<BulkKind, string>> = {
  confirm: 'Confirming',
  general: 'Moving to General',
  dismiss: 'Marking not work',
};

/** The keys a batch runs under: the bar's, and the header's *Confirm day*. */
const BATCHES: ReadonlySet<string> = new Set(['bulk', 'confirm-day']);

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

/**
 * My day (LAI-787, D-088): the reader's own day, drafted on their own machine
 * from what their collector already holds, confirmed in one click or edited
 * line by line. **Private**: only they read it, signed in — no admin view and
 * no token. Only what they confirm, or type, is ever seen by anyone else.
 *
 * Every figure comes from `GET /me/time`. A day nothing reached the board on
 * is said to be *No signal*, never drawn as zero hours; agent time is minutes
 * beside the day, never hours in it.
 *
 * **Laid out after the owner's reference** (LAI-796): the week in the header,
 * the day as a bar of confirmed and drafted blocks above its two lists, and a
 * column beside it with *On your plate*, *Agent minutes* and the *Draft my
 * time* switch. Every action is the one LAI-787 built, where it was.
 *
 * **Made for a busy day** (LAI-810): the drafted blocks paged in a scroll area
 * of their own, selected and confirmed many at a time; the confirmed ones a
 * summary line when long; and the column beside the day bounded — *Draft my
 * time* first, five of each kind of work, scrolling on its own.
 */
export function MyDayScreen({
  day,
  onDay,
  me,
  queue,
  onNavigate = () => undefined,
}: MyDayScreenProps) {
  const tz = readerZone();
  const selected = isDay(day) ? day : dayIn(tz, Date.now());
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [batch, setBatch] = useState<Batch>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const spaces = useSpaces();
  const batching = pending !== undefined && BATCHES.has(pending);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getMyDay(selected, tz, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [selected, tz, tick]);

  // A batch's last word is about the day it ran on.
  useEffect(() => {
    setBatch({ kind: 'idle' });
  }, [selected]);

  /** Run one write, keyed so only its own control spins; re-read the day after. */
  const run = async (key: string, write: () => Promise<unknown>): Promise<boolean> => {
    setPending(key);
    setActionError(undefined);
    try {
      await write();
      reload();
      return true;
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : 'That change did not save.');
      return false;
    } finally {
      setPending(undefined);
    }
  };

  /**
   * One batch over many blocks: one request each, in order, the progress
   * said as it goes — and **the day re-read once at the end**, not once per
   * block. Its progress and its last word belong to the day it ran on, and
   * the day cannot be changed, nor time added, while it runs. Resolves to the
   * blocks that stay selected.
   */
  const runBatch = async (
    key: string,
    label: string,
    day: string,
    total: number,
    work: (onProgress: (done: number, total: number) => void) => Promise<BulkResult>,
  ): Promise<readonly string[]> => {
    setPending(key);
    setActionError(undefined);
    setBatch({ kind: 'running', day, label, done: 0, total });
    try {
      const result = await work((done, of) => {
        setBatch({ kind: 'running', day, label, done, total: of });
      });
      setBatch({ kind: 'said', day, text: result.text, ok: result.ok });
      return result.keep;
    } finally {
      setPending(undefined);
      reload();
    }
  };

  if (load.kind === 'loading') {
    return (
      <div className="myday-page">
        <ScreenHeader
          variant="page"
          title="My day"
          description={`${dayLong(selected)} · yours only`}
        />
        <div className="myday">
          <LoadingState shape="card" count={3} label="Reading your day" />
        </div>
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="myday-page">
        <ScreenHeader
          variant="page"
          title="My day"
          description={`${dayLong(selected)} · yours only`}
        />
        <div className="myday">
          <ApiErrorState error={load.error} resource="your day" onRetry={reload} />
        </div>
      </div>
    );
  }

  const view = load.view;
  const { settings } = view;
  const totals = dayTotals(view);
  const addable = canAddTime(settings);
  const nothing = view.drafts.length === 0 && view.entries.length === 0;
  // *Confirm day* confirms what is ready; a block on nothing is left out and named.
  const dayPlan = confirmPlan(view.drafts);
  // A batch's progress and last word are shown on its own day only.
  const shown: Batch = batch.kind !== 'idle' && batch.day === view.day ? batch : { kind: 'idle' };
  const readyMinutes = dayPlan.ready.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <div className="myday-page">
      <ScreenHeader
        variant="page"
        title="My day"
        description={`${dayLong(view.day)} · yours only`}
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
        {view.drafts.length > 0 && (
          <button
            type="button"
            className="myday-chip myday-chip-primary"
            disabled={pending !== undefined || dayPlan.ready.length === 0}
            title={
              dayPlan.needCard.length > 0
                ? `${needCardLine(dayPlan.needCard.length)} first — left out`
                : undefined
            }
            onClick={() => {
              void runBatch('confirm-day', 'Confirming', view.day, view.drafts.length, (progress) =>
                runConfirmDay(view.drafts, view.day, BULK_API, progress),
              );
            }}
          >
            {pending === 'confirm-day' && <Spinner size="sm" label="Confirming the day" />}
            {dayPlan.needCard.length === 0
              ? `Confirm day · ${formatDuration(readyMinutes)}`
              : `Confirm ${String(dayPlan.ready.length)} ready · ${formatDuration(readyMinutes)}`}
          </button>
        )}
      </ScreenHeader>

      <div className="myday">
        <div className="myday-grid">
          <div className="myday-main">
            {actionError !== undefined && (
              <p className="myday-error" role="alert">
                {actionError}
              </p>
            )}

            <section className="myday-card" aria-labelledby="myday-day-title">
              <header className="myday-card-head">
                <h2 className="myday-card-title" id="myday-day-title">
                  {dayLong(view.day)}
                </h2>
                {view.day === view.today && <span className="myday-today">Today</span>}
                {STATE_LABELS[view.state] !== '' && (
                  <span className={`myday-state myday-state-${view.state}`}>
                    {STATE_LABELS[view.state]}
                  </span>
                )}
                {!nothing && (
                  <span className="myday-card-caption" data-day-totals>
                    {formatDuration(totals.confirmed)} confirmed
                    {totals.drafted > 0 && ` · ${formatDuration(totals.drafted)} drafted`}
                  </span>
                )}
              </header>

              {view.state !== 'future' && <DayBar view={view} now={Date.now()} />}

              {view.state === 'future' && (
                <p className="myday-quiet">This day has not happened yet.</p>
              )}

              {view.state === 'no_signal' && nothing && (
                <div className="myday-nosignal" data-no-signal>
                  <p className="myday-nosignal-head">No signal</p>
                  <p className="myday-quiet">
                    {settings.drafting
                      ? 'Nothing reached Laika from your machine for this day.'
                      : addable
                        ? 'Nothing is drafted while Draft my time is off.'
                        : 'Time is off for this organisation, so nothing is drafted or added.'}
                    {addable && ' That is not zero hours — add what you worked below.'}
                  </p>
                </div>
              )}
            </section>

            {view.drafts.length > 0 && (
              <DraftList
                // A new day starts with nothing selected and on its first page.
                key={`drafts-${view.day}`}
                drafts={view.drafts}
                pending={pending}
                batch={shown}
                onNavigate={onNavigate}
                onPatch={(draft, patch, verb) =>
                  run(`${verb}:${draft.id}`, () => updateDraft(draft.id, patch))
                }
                onSplit={(draft, at) => run(`split:${draft.id}`, () => splitDraft(draft.id, at))}
                onDismiss={(draft) => {
                  void run(`dismiss:${draft.id}`, () => dismissDraft(draft.id));
                }}
                onConfirm={(draft) => {
                  void run(`confirm:${draft.id}`, () => confirmDraft(draft.id));
                }}
                onBulk={(kind, chosen) =>
                  runBatch('bulk', RUNNING[kind], view.day, chosen.length, (progress) =>
                    runBulk(kind, chosen, BULK_API, progress),
                  )
                }
              />
            )}

            {view.entries.length > 0 && (
              <EntryList
                key={`entries-${view.day}`}
                entries={view.entries}
                pending={pending}
                onNavigate={onNavigate}
                onSave={(entry, patch) =>
                  run(`save:${entry.id}`, () => updateEntry(entry.id, patch))
                }
                onDelete={(entry) => {
                  void run(`delete:${entry.id}`, () => deleteEntry(entry.id));
                }}
              />
            )}

            {addable && view.state !== 'future' && (
              <section className="myday-card" aria-labelledby="myday-add-title">
                <header className="myday-card-head">
                  <h2 className="myday-card-title" id="myday-add-title">
                    Add time
                  </h2>
                  <span className="myday-card-caption">
                    a meeting, a call — confirmed as you add it
                  </span>
                </header>
                <AddTimeForm
                  day={view.day}
                  tz={view.tz}
                  busy={pending === 'add'}
                  locked={batching}
                  onAdd={(entry: NewEntry) => run('add', () => addEntry(entry))}
                />
              </section>
            )}
          </div>

          <aside className="myday-side" aria-label="Beside your day" data-myday-side>
            <DraftMyTime settings={settings} pending={pending} run={run} />
            <OnYourPlate me={me} spaces={spaces} queue={queue} onNavigate={onNavigate} />
            <AgentStrip agent={view.agent} spaces={spaces} onNavigate={onNavigate} />
          </aside>
        </div>
      </div>
    </div>
  );
}

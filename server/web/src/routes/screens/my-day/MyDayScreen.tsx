import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  addEntry,
  confirmDay,
  confirmDraft,
  deleteDrafts,
  deleteEntry,
  dismissDraft,
  getMyDay,
  setDraftMyTime,
  splitDraft,
  updateDraft,
  updateEntry,
  type DraftPatch,
  type EntryPatch,
  type MyDay,
  type NewEntry,
} from '../../../api/time.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { AddTimeForm } from './AddTimeForm.tsx';
import { AgentStrip } from './AgentStrip.tsx';
import { DraftRow } from './DraftRow.tsx';
import { EntryRow } from './EntryRow.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { DayBar } from './DayBar.tsx';
import { OnYourPlate } from './OnYourPlate.tsx';
import { dayLong } from './day-timeline.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import {
  MODE_NOTES,
  STATE_LABELS,
  canAddTime,
  dayIn,
  dayTotals,
  hm,
  isDay,
} from './my-day-derive.ts';
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tick, setTick] = useState(0);

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

  return (
    <div className="myday-page">
      <ScreenHeader
        variant="page"
        title="My day"
        description={`${dayLong(view.day)} · yours only`}
        below={<WeekStrip week={view.week} selected={view.day} today={view.today} onPick={onDay} />}
      >
        {view.drafts.length > 0 && (
          <button
            type="button"
            className="myday-chip myday-chip-primary"
            disabled={pending !== undefined}
            onClick={() => {
              void run('confirm-day', () => confirmDay(view.day));
            }}
          >
            {pending === 'confirm-day' && <Spinner size="sm" label="Confirming the day" />}
            Confirm day · {hm(totals.drafted)}
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
                    {hm(totals.confirmed)} confirmed
                    {totals.drafted > 0 && ` · ${hm(totals.drafted)} drafted`}
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

              {view.drafts.length > 0 && (
                <>
                  <h3 className="myday-subhead">Drafted — not yet confirmed</h3>
                  <ol className="myday-blocks" aria-label="Drafted blocks">
                    {view.drafts.map((draft) => (
                      <DraftRow
                        key={draft.id}
                        draft={draft}
                        pending={pending}
                        onPatch={(patch: DraftPatch, verb: string) =>
                          run(`${verb}:${draft.id}`, () => updateDraft(draft.id, patch))
                        }
                        onSplit={(at) => run(`split:${draft.id}`, () => splitDraft(draft.id, at))}
                        onDismiss={() => {
                          void run(`dismiss:${draft.id}`, () => dismissDraft(draft.id));
                        }}
                        onConfirm={() => {
                          void run(`confirm:${draft.id}`, () => confirmDraft(draft.id));
                        }}
                      />
                    ))}
                  </ol>
                </>
              )}

              {view.entries.length > 0 && (
                <>
                  <h3 className="myday-subhead">Confirmed</h3>
                  <ol className="myday-blocks" aria-label="Confirmed entries">
                    {view.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        pending={pending}
                        onSave={(patch: EntryPatch) =>
                          run(`save:${entry.id}`, () => updateEntry(entry.id, patch))
                        }
                        onDelete={() => {
                          void run(`delete:${entry.id}`, () => deleteEntry(entry.id));
                        }}
                      />
                    ))}
                  </ol>
                </>
              )}
            </section>

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
                  onAdd={(entry: NewEntry) => run('add', () => addEntry(entry))}
                />
              </section>
            )}
          </div>

          <aside className="myday-side" aria-label="Beside your day">
            <OnYourPlate me={me} queue={queue} onNavigate={onNavigate} />
            <AgentStrip agent={view.agent} />
            <section className="myday-card myday-settings" aria-labelledby="myday-draft-label">
              {settings.org_mode === 'drafts' ? (
                <>
                  <div className="myday-settings-row">
                    <span className="myday-card-title" id="myday-draft-label">
                      Draft my time
                    </span>
                    <Switch
                      checked={settings.draft_my_time}
                      labelledBy="myday-draft-label"
                      describedBy="myday-draft-note"
                      disabled={pending !== undefined}
                      onChange={(on) => {
                        void run('switch', () => setDraftMyTime(on));
                      }}
                    >
                      {settings.draft_my_time ? 'On' : 'Off'}
                    </Switch>
                  </div>
                  <p className="myday-quiet" id="myday-draft-note">
                    Drafted on your own machine by the Laika collector (
                    <code>laika activity on</code>) from your agent sessions, prompts and commits —
                    counts only, never what you typed. Only you see drafts. Off deletes every draft
                    held; confirmed time stays.
                  </p>
                  {settings.draft_my_time &&
                    (confirmingDelete ? (
                      <div className="myday-block-actions">
                        <span className="myday-quiet">Delete every unconfirmed draft?</span>
                        <button
                          type="button"
                          className="myday-chip myday-chip-danger"
                          disabled={pending !== undefined}
                          onClick={() => {
                            void run('delete-drafts', () => deleteDrafts()).then(() => {
                              setConfirmingDelete(false);
                            });
                          }}
                        >
                          {pending === 'delete-drafts' && (
                            <Spinner size="sm" label="Deleting your drafts" />
                          )}
                          Delete drafts
                        </button>
                        <button
                          type="button"
                          className="myday-chip"
                          onClick={() => {
                            setConfirmingDelete(false);
                          }}
                        >
                          Keep them
                        </button>
                      </div>
                    ) : (
                      <div className="myday-block-actions">
                        <button
                          type="button"
                          className="myday-chip"
                          onClick={() => {
                            setConfirmingDelete(true);
                          }}
                        >
                          Delete my drafts…
                        </button>
                      </div>
                    ))}
                </>
              ) : (
                <p className="myday-quiet" id="myday-draft-label">
                  {MODE_NOTES[settings.org_mode]}
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

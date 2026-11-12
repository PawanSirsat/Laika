import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { getTaskTime, type TaskTime } from '../../../api/task-time.ts';
import {
  discardTimer,
  getMyDay,
  startTimer,
  stopTimer,
  type Timer,
  type TimeMode,
} from '../../../api/time.ts';
import { readerZone } from '../../../api/usage.ts';
import { useRoute } from '../../use-route.ts';
import { dayIn } from '../my-day/my-day-derive.ts';
import { timerClock, timerSeconds } from '../my-day/TimerControl.tsx';
import {
  agentLine,
  contributorsLine,
  draftLine,
  shortDuration,
  timerState,
  TRACKED_HINTS,
} from './tracked-time-derive.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import './tracked-time.css';

export interface TrackedTimeProps {
  readonly taskId: string;
  /** Re-read when this changes — the task's `updated_at`, kept current by the stream. */
  readonly refreshKey: number;
}

/**
 * *Tracked on this task* (owner, 2026-11-10; LAI-812's intent): the time on
 * the card, as one slim bar pinned to the task panel's foot — the confirmed
 * total of everyone's time, how many people and entries it is from, the
 * reader's own drafts and the agent minutes beside it, and a timer to add more.
 *
 * Draws nothing until the time is read, and nothing if the read fails: a
 * figure that might be wrong is worse than none.
 */
export function TrackedTime({ taskId, refreshKey }: TrackedTimeProps) {
  const { navigate } = useRoute();
  // Keyed on the task, so one task's figure never sits under the next one's.
  const [loaded, setLoaded] = useState<{ taskId: string; view: TaskTime } | undefined>();
  const [day, setDay] = useState<{ mode: TimeMode; timer: Timer | null } | undefined>();
  const [reread, setReread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    getTaskTime(taskId, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoaded({ taskId, view });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey, reread]);

  // The reader's running timer and the organisation's time mode, from My day.
  useEffect(() => {
    const controller = new AbortController();
    const tz = readerZone();
    getMyDay(dayIn(tz, Date.now()), tz, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setDay({ mode: answer.settings.org_mode, timer: answer.timer });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDay(undefined);
      });
    return () => {
      controller.abort();
    };
  }, [reread]);

  const timer = timerState(day, taskId);
  const ticking = timer.kind === 'here' && timer.timer.paused_at === null;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [ticking]);

  const act = (call: () => Promise<unknown>, what: string) => {
    setBusy(true);
    setFailed(undefined);
    setNote(undefined);
    call()
      .catch((err: unknown) => {
        // Somebody's timer already runs (one per person): show it, not an error.
        if (!(err instanceof ApiError && err.status === 409)) setFailed(what);
      })
      .finally(() => {
        setBusy(false);
        setReread((n) => n + 1);
      });
  };

  const view = loaded?.taskId === taskId ? loaded.view : undefined;
  if (view === undefined) return null;

  const who = contributorsLine(view);
  const drafts = draftLine(view);
  const agents = agentLine(view);

  return (
    <footer className="tt" aria-label="Tracked on this task">
      <span className="tt-label">Tracked</span>
      <Tooltip content={TRACKED_HINTS.total} lazy>
        <span className="tt-total">{shortDuration(view.total_minutes)}</span>
      </Tooltip>
      <span className="tt-meta">
        {who === null ? (
          <span className="tt-item">nothing confirmed yet</span>
        ) : (
          <span className="tt-item">{who}</span>
        )}
        {drafts !== null && (
          <Tooltip content={TRACKED_HINTS.drafts} lazy>
            <span className="tt-item">{drafts}</span>
          </Tooltip>
        )}
        {agents !== null && (
          <Tooltip content={TRACKED_HINTS.agents} lazy>
            <span className="tt-item">{agents}</span>
          </Tooltip>
        )}
      </span>

      <span className="tt-end">
        {note !== undefined && <span className="tt-note">{note}</span>}
        {failed !== undefined && (
          <span className="tt-note tt-failed" role="alert">
            {failed}
          </span>
        )}

        {timer.kind === 'idle' && (
          <button
            type="button"
            className="tt-timer"
            disabled={busy}
            onClick={() => {
              act(
                () => startTimer({ tz: readerZone(), task: taskId }),
                'Could not start the timer.',
              );
            }}
          >
            <span className="tt-dot" aria-hidden="true" />
            Start timer
          </button>
        )}

        {timer.kind === 'here' && (
          <>
            <span className="tt-clock" aria-label="Timer on this task">
              <span className="tt-dot tt-dot-live" aria-hidden="true" />
              {timerClock(timerSeconds(timer.timer, now))}
            </span>
            <button
              type="button"
              className="tt-timer"
              disabled={busy}
              onClick={() => {
                act(async () => {
                  try {
                    await stopTimer();
                  } catch (err) {
                    // Under a minute saves nothing (`timer_too_short`): the
                    // server says discard it, so Stop does, and says so.
                    if (!(err instanceof ApiError && tooShort(err))) throw err;
                    await discardTimer();
                    setNote('Under a minute, so nothing was saved.');
                  }
                }, 'Could not stop the timer.');
              }}
            >
              Stop
            </button>
          </>
        )}

        {timer.kind === 'elsewhere' && (
          <span className="tt-note">
            Your timer is running on {timer.label}.{' '}
            <button
              type="button"
              className="tt-link"
              onClick={() => {
                navigate('/my-day');
              }}
            >
              Open My day
            </button>
          </span>
        )}
      </span>
    </footer>
  );
}

/** The server's refusal to save a timer that ran under a minute. */
function tooShort(err: ApiError): boolean {
  const details = err.details as { readonly reason?: unknown } | null;
  return err.status === 422 && details?.reason === 'timer_too_short';
}

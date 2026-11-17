import { useEffect, useState } from 'react';
import { getTimeSettings, setOrgTimeMode, TIME_MODES, type TimeMode } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { useAction } from '../../../components/toast/use-action.ts';
import { MODE_LABELS, MODE_NOTES } from '../my-day/my-day-derive.ts';

export interface TimeModeFactProps {
  /** Owner or admin: the three modes are controls; for anyone else, a word. */
  readonly canManage: boolean;
}

/**
 * The organisation's *Time* setting (D-088 item 5, LAI-787), as one of the
 * Organisation card's facts beside *Developer insights*: **off**, **manual**
 * (people type their own time) or **drafts** (each person may also have their
 * day drafted on their own machine). Leaving *drafts* deletes every draft
 * held, everyone's; confirmed time is never touched.
 *
 * Read from `GET /me/time-settings`, which every signed-in person may ask —
 * they are who it is about — and set by an owner or admin, signed in.
 * A change toasts either way (LAI-1310). No Undo: leaving *drafts* deletes
 * the drafts, which switching back cannot return.
 */
export function TimeModeFact({ canManage }: TimeModeFactProps) {
  const [mode, setMode] = useState<TimeMode | undefined>(undefined);
  const [pending, setPending] = useState<TimeMode | undefined>(undefined);
  const { run } = useAction();

  useEffect(() => {
    const controller = new AbortController();
    getTimeSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted) setMode(settings.org_mode);
      })
      .catch(() => {
        // Absent rather than an error, as the rest of the card's facts are.
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (mode === undefined) return null;

  const choose = (next: TimeMode): void => {
    if (next === mode) return;
    setPending(next);
    void run({
      do: () => setOrgTimeMode(next),
      success: (answer) => `Time set to ${MODE_LABELS[answer.mode]}`,
      failure: 'Couldn’t change the Time setting',
      mark: 'org-time',
    }).then((answer) => {
      if (answer !== undefined) setMode(answer.mode);
      setPending(undefined);
    });
  };

  return (
    <div className="org-fact" data-fact="time">
      <dt id="org-time-label">Time</dt>
      <dd>
        {canManage ? (
          <span className="org-modes" role="group" aria-labelledby="org-time-label">
            {TIME_MODES.map((option) => (
              <button
                key={option}
                type="button"
                className="org-mode"
                aria-pressed={option === mode}
                disabled={pending !== undefined}
                onClick={() => {
                  choose(option);
                }}
              >
                {pending === option && <Spinner size="sm" label={`Setting Time to ${option}`} />}
                {MODE_LABELS[option]}
              </button>
            ))}
          </span>
        ) : (
          <span>{MODE_LABELS[mode].toLowerCase()}</span>
        )}
        <span className="org-fact-note">
          {MODE_NOTES[mode]} Per-person hours are never shown as a score. Leaving Drafts deletes
          every draft held; confirmed time stays.
        </span>
      </dd>
    </div>
  );
}

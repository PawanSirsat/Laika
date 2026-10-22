import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { getTimeSettings, ISO_DAYS, setOrgBreaks, type BreakWindow } from '../../../api/time.ts';
import { minuteClock, parseClock } from '../../../api/time-label.ts';
import { Button } from '../../../components/forms/Button.tsx';

export interface BreakScheduleFactProps {
  /** Owner or admin: the schedule can be edited; for anyone else, read. */
  readonly canManage: boolean;
}

/** D-101 item 1: at most eight windows, a label of 1–40 characters. */
const MAX_WINDOWS = 8;
const MAX_LABEL = 40;

const DAY_NAMES: Readonly<Record<number, string>> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

/** A window as it is being edited: its days a plain list, its label as typed. */
interface Draft {
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly days: readonly number[];
}

const NEW_WINDOW: Draft = { label: '', start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5] };

/** `Mon–Fri`, `Every day`, or the days named: `Mon, Wed`. */
export function daysLabel(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.join() === '6,7') return 'Sat–Sun';
  return sorted.map((d) => DAY_NAMES[d] ?? String(d)).join(', ');
}

/** `12:00 PM–1:00 PM` — a wall-clock window, no zone, on the 12-hour clock. */
export function windowRange(w: Pick<BreakWindow, 'start' | 'end'>): string {
  const a = parseClock(w.start);
  const b = parseClock(w.end);
  if (a === undefined || b === undefined) return `${w.start}–${w.end}`;
  return `${minuteClock(a.minute)}–${minuteClock(b.minute)}`;
}

/**
 * The server's `422` issues, by the window each names (`breaks.N…`); any that
 * names no window is the schedule's as a whole, under `-1`.
 */
function issuesByWindow(cause: unknown): Map<number, string> {
  const out = new Map<number, string>();
  const details = cause instanceof ApiError ? cause.details : null;
  const issues =
    (details as { issues?: readonly { path?: unknown; message?: unknown }[] } | null)?.issues ?? [];
  for (const issue of issues) {
    const match = /^breaks\.(\d+)/.exec(typeof issue.path === 'string' ? issue.path : '');
    const at = match === null ? -1 : Number(match[1]);
    // First wins, as a form field shows only its first complaint.
    if (!out.has(at) && typeof issue.message === 'string') out.set(at, issue.message);
  }
  return out;
}

/**
 * The organisation's breaks (D-101, LAI-956), as one of the Organisation
 * card's facts beside *Time*: lunch and any other window, by wall clock and
 * weekday, drawn on every person's My day Timeline. **Display only** — a
 * scheduled break is never time, and nothing compares a person's day with it.
 *
 * Read from `GET /me/time-settings`, which every signed-in person may ask; set
 * whole by an owner or admin, signed in (`PUT /org/time/breaks`). Anyone else
 * reads it, and sees nothing when there is none.
 */
export function BreakScheduleFact({ canManage }: BreakScheduleFactProps) {
  const [breaks, setBreaks] = useState<readonly BreakWindow[] | undefined>(undefined);
  const [drafts, setDrafts] = useState<readonly Draft[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getTimeSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted) setBreaks(settings.breaks ?? []);
      })
      .catch(() => {
        // Absent rather than an error, as the rest of the card's facts are.
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (breaks === undefined) return null;
  if (!canManage && breaks.length === 0) return null;

  const change = (i: number, patch: Partial<Draft>): void => {
    setDrafts((list) => list?.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  const save = (): void => {
    if (drafts === undefined) return;
    setBusy(true);
    setIssues(new Map());
    setError(undefined);
    setOrgBreaks(
      drafts.map((d) => ({
        label: d.label.trim(),
        start: d.start,
        end: d.end,
        days: [...d.days].sort((a, b) => a - b),
      })),
    )
      .then((settings) => {
        setBreaks(settings.breaks ?? []);
        setDrafts(undefined);
      })
      .catch((cause: unknown) => {
        const found = issuesByWindow(cause);
        setIssues(found);
        const whole = found.get(-1);
        if (whole !== undefined || found.size === 0) {
          setError(
            whole ?? (cause instanceof ApiError ? cause.message : 'The breaks did not save.'),
          );
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="org-fact" data-fact="breaks">
      <dt id="org-breaks-label">Breaks</dt>
      <dd>
        {drafts === undefined ? (
          <>
            {breaks.length === 0 ? (
              <span>none</span>
            ) : (
              <ul className="org-breaks" aria-labelledby="org-breaks-label">
                {breaks.map((w, i) => (
                  <li key={`${String(i)}-${w.label}`} className="org-break">
                    <span className="org-break-label">{w.label}</span>
                    <span className="org-break-when">
                      {windowRange(w)} · {daysLabel(w.days)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <span className="org-break-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDrafts(breaks.map((w) => ({ ...w })));
                    setIssues(new Map());
                    setError(undefined);
                  }}
                >
                  Edit breaks
                </Button>
              </span>
            )}
          </>
        ) : (
          <form
            className="org-breaks-edit"
            aria-labelledby="org-breaks-label"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {drafts.map((d, i) => {
              const issue = issues.get(i);
              return (
                <fieldset key={i} className="org-break-row" data-break-row={i}>
                  <legend className="org-break-legend">Break {String(i + 1)}</legend>
                  <span className="org-break-fields">
                    <input
                      className="input org-break-name"
                      aria-label="Label"
                      placeholder="Lunch"
                      maxLength={MAX_LABEL}
                      value={d.label}
                      onChange={(e) => {
                        change(i, { label: e.target.value });
                      }}
                    />
                    <input
                      className="input org-break-time"
                      type="time"
                      aria-label="Starts"
                      value={d.start}
                      onChange={(e) => {
                        change(i, { start: e.target.value });
                      }}
                    />
                    <input
                      className="input org-break-time"
                      type="time"
                      aria-label="Ends"
                      value={d.end}
                      onChange={(e) => {
                        change(i, { end: e.target.value });
                      }}
                    />
                    <button
                      type="button"
                      className="org-github-done"
                      aria-label={`Remove ${d.label.trim() === '' ? `break ${String(i + 1)}` : d.label.trim()}`}
                      disabled={busy}
                      onClick={() => {
                        setDrafts((list) => list?.filter((_, j) => j !== i));
                        setIssues(new Map());
                      }}
                    >
                      Remove
                    </button>
                  </span>
                  <span className="org-break-days" role="group" aria-label="Days">
                    {ISO_DAYS.map((day) => (
                      <label key={day} className="org-break-day">
                        <input
                          type="checkbox"
                          checked={d.days.includes(day)}
                          onChange={(e) => {
                            change(i, {
                              days: e.target.checked
                                ? [...d.days, day]
                                : d.days.filter((x) => x !== day),
                            });
                          }}
                        />
                        {DAY_NAMES[day]}
                      </label>
                    ))}
                  </span>
                  {issue !== undefined && (
                    <span className="org-fact-error" role="alert">
                      {issue}
                    </span>
                  )}
                </fieldset>
              );
            })}
            <span className="org-break-actions">
              <Button
                variant="secondary"
                disabled={busy || drafts.length >= MAX_WINDOWS}
                onClick={() => {
                  setDrafts((list) => [...(list ?? []), NEW_WINDOW]);
                }}
              >
                Add a break
              </Button>
              <Button type="submit" busy={busy}>
                Save breaks
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDrafts(undefined);
                  setIssues(new Map());
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            </span>
          </form>
        )}
        <span className="org-fact-note">
          Shown on everyone’s My day at these times, in their own zone. Never counted as time, and
          nobody’s day is measured against it.
        </span>
        {error !== undefined && (
          <span className="org-fact-error" role="alert">
            {error}
          </span>
        )}
      </dd>
    </div>
  );
}

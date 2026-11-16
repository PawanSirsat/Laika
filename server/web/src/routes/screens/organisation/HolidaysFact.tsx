import { useEffect, useMemo, useState } from 'react';
import {
  addHoliday,
  hrRefusal,
  listHolidays,
  removeHoliday,
  type OrgHoliday,
} from '../../../api/hr.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import {
  coversOf,
  HOLIDAY_COVERS,
  holidayDayLabel,
  holidaysByYear,
  holidayWindow,
  localDay,
  withHoliday,
} from './hr-derive.ts';

export interface HolidaysFactProps {
  /** Holds `org.time.set`: adds a holiday and removes one of the owners’ own. */
  readonly canManage: boolean;
}

/** `org_holidays.label` is 1–120 characters (§4). */
const MAX_LABEL = 120;

/**
 * The organisation's holidays (D-149 item 8, LAI-1182), one of the
 * Organisation card's facts: this year and next, by day, for every member.
 * Each says whom it covers. One synced from Clan wears a *Clan* tag, changes
 * only in Clan, and covers the people Clan lists — *Clan staff*, or *Some
 * people* when Clan scoped it to departments; one added here is *Everyone*'s.
 * An owner or admin adds a day of their own and removes one they added —
 * never a Clan one.
 *
 * Read from `GET /org/holidays`, which every member may ask. Absent when it
 * cannot be read, as the card's other facts are.
 */
export function HolidaysFact({ canManage }: HolidaysFactProps) {
  const [now] = useState(() => Date.now());
  const range = useMemo(() => holidayWindow(now), [now]);
  const [holidays, setHolidays] = useState<readonly OrgHoliday[] | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');
  /** `add`, or the id of the holiday being removed. */
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    listHolidays(range.from, range.to, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setHolidays(answer.holidays);
      })
      .catch(() => {
        // Absent rather than an error, as the rest of the card's facts are.
      });
    return () => {
      controller.abort();
    };
  }, [range]);

  const groups = useMemo(
    () => holidaysByYear(holidays ?? [], range.years),
    [holidays, range.years],
  );

  if (holidays === undefined) return null;

  const today = localDay(now);

  const add = (): void => {
    setBusy('add');
    setError(undefined);
    addHoliday({ day, label: label.trim() })
      .then((added) => {
        setHolidays((list) => withHoliday(list ?? [], added));
        setDay('');
        setLabel('');
        setAdding(false);
      })
      .catch((cause: unknown) => {
        setError(hrRefusal(cause));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const remove = (holiday: OrgHoliday): void => {
    setBusy(holiday.id);
    setError(undefined);
    removeHoliday(holiday.id)
      .then(() => {
        setHolidays((list) => list?.filter((h) => h.id !== holiday.id));
      })
      .catch((cause: unknown) => {
        setError(hrRefusal(cause));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  return (
    <div className="org-fact" data-fact="holidays">
      <dt id="org-holidays-label">Holidays</dt>
      <dd>
        {holidays.length === 0 ? (
          <span>none</span>
        ) : (
          groups.map((group) => (
            <div
              key={group.year}
              className="org-holiday-year"
              data-holiday-year={String(group.year)}
            >
              <span className="org-holiday-year-head" id={`org-holidays-${String(group.year)}`}>
                {String(group.year)}
              </span>
              {group.holidays.length === 0 ? (
                <span className="org-fact-note">None yet.</span>
              ) : (
                <ul
                  className="org-holidays"
                  aria-labelledby={`org-holidays-label org-holidays-${String(group.year)}`}
                >
                  {group.holidays.map((holiday) => (
                    <li
                      key={holiday.id}
                      className="org-holiday"
                      data-holiday={holiday.id}
                      data-source={holiday.source}
                      data-past={holiday.day < today ? '' : undefined}
                    >
                      <time className="org-holiday-day" dateTime={holiday.day}>
                        {holidayDayLabel(holiday.day)}
                      </time>
                      {/* The name and its tags wrap together, beside the day. */}
                      <span className="org-holiday-what">
                        <span className="org-holiday-label">{holiday.label}</span>
                        {holiday.source === 'clan' && (
                          <span className="org-holiday-tag" data-holiday-tag="clan">
                            Clan
                          </span>
                        )}
                        <span
                          className="org-holiday-tag"
                          data-holiday-tag={HOLIDAY_COVERS[coversOf(holiday)].tag}
                          title={HOLIDAY_COVERS[coversOf(holiday)].title}
                        >
                          {HOLIDAY_COVERS[coversOf(holiday)].words}
                        </span>
                      </span>
                      {canManage && holiday.source === 'manual' && (
                        <button
                          type="button"
                          className="org-break-remove org-holiday-remove"
                          aria-label={`Remove ${holiday.label}, ${holidayDayLabel(holiday.day)}`}
                          aria-busy={busy === holiday.id || undefined}
                          disabled={busy !== undefined}
                          onClick={() => {
                            remove(holiday);
                          }}
                        >
                          {busy === holiday.id && <Spinner size="sm" />}
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        {canManage &&
          (adding ? (
            <form
              className="org-holiday-add"
              aria-label="Add a holiday"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <input
                className="input org-holiday-date"
                type="date"
                aria-label="Day"
                min={range.from}
                max={range.to}
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                }}
                required
              />
              <input
                className="input org-holiday-name"
                aria-label="Name"
                placeholder="Name of the day"
                maxLength={MAX_LABEL}
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
                required
              />
              <span className="org-break-actions">
                <Button
                  type="submit"
                  busy={busy === 'add'}
                  disabled={day === '' || label.trim() === ''}
                >
                  Add holiday
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === 'add'}
                  onClick={() => {
                    setAdding(false);
                    setError(undefined);
                  }}
                >
                  Cancel
                </Button>
              </span>
            </form>
          ) : (
            <span className="org-break-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setAdding(true);
                  setError(undefined);
                }}
              >
                Add a holiday
              </Button>
            </span>
          ))}

        <span className="org-fact-note">
          {canManage
            ? 'Everyone sees these. Clan’s are synced and change only in Clan; add your own for a day Clan does not list.'
            : 'Public and company holidays, synced from Clan or added by an owner or admin.'}
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

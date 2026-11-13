import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import {
  addAwayPeriod,
  deleteAwayPeriod,
  getMyAvailability,
  setMyAvailability,
  availabilityGeneration,
  setSharedAvailability,
  useSharedAvailability,
  type Availability,
  type AvailabilityPatch,
  type AvailabilityStatus,
} from '../../../api/availability.ts';
import { ApiError } from '../../../api/errors.ts';
import { readerZone } from '../../../api/usage.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import {
  addTag,
  HOURS_MAX,
  HOURS_MIN,
  NOTE_MAX,
  pillOf,
  pillSentence,
  rangeShort,
  updatedAgo,
} from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import { HeaderPopover } from './HeaderPopover.tsx';
import { dayIn } from './my-day-derive.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

type Choice = AvailabilityStatus | 'away';

const WEEKDAYS: readonly (readonly [number, string, string])[] = [
  [1, 'M', 'Monday'],
  [2, 'T', 'Tuesday'],
  [3, 'W', 'Wednesday'],
  [4, 'T', 'Thursday'],
  [5, 'F', 'Friday'],
  [6, 'S', 'Saturday'],
  [7, 'S', 'Sunday'],
];

interface Draft {
  readonly choice: Choice | null;
  readonly until: string;
  readonly hours: string;
  readonly note: string;
  readonly tags: readonly string[];
  readonly days: readonly number[];
  readonly start: string;
  readonly end: string;
}

function draftOf(a: Availability): Draft {
  return {
    choice: a.away !== null ? 'away' : a.status,
    until: a.away?.until ?? '',
    hours: a.hours_per_week === null ? '' : String(a.hours_per_week),
    note: a.note ?? '',
    tags: a.tags,
    days: a.work_week?.days ?? [],
    start: a.work_week?.start ?? '',
    end: a.work_week?.end ?? '',
  };
}

/** A refusal, pinned to the field the server named — or to the form when it named none. */
interface Problem {
  readonly field: string;
  readonly message: string;
}

function problemOf(cause: unknown): Problem {
  if (cause instanceof ApiError) {
    const field = (cause.details as { field?: unknown } | null)?.field;
    return { field: typeof field === 'string' ? field : 'form', message: cause.message };
  }
  return { field: 'form', message: 'Your availability could not be saved. Try again.' };
}

/**
 * **My availability** (frames 2a–2c, D-131; LAI-1139): the pill in My day's
 * header, and under it the person's own declaration — open to more work, at
 * capacity, or away until a date; hours a week they could take; a note; skills
 * and areas; their working week; their away periods. Saved through
 * `PUT /me/availability` (a merge) and the away endpoints. Every refusal is
 * the server's sentence, beside the field it names.
 *
 * Only on your own day: nobody sets anyone else's.
 */
export function AvailabilityPopover({
  now = Date.now(),
  variant = 'chip',
}: {
  readonly now?: number;
  /**
   * `head` is the profile's head card (LAI-1152): the pill itself is the
   * button, with a chevron — a dashed *Set availability* when nothing is set —
   * and the panel is a dialog with a close button.
   */
  readonly variant?: 'chip' | 'head';
}) {
  const head = variant === 'head';
  // Shared with every other My availability on the page (one per breakpoint).
  const [saved] = useSharedAvailability();
  const setSaved = (next: Availability, at: number): void => {
    setSharedAvailability(next, at);
  };
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [tagProblem, setTagProblem] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [awayFrom, setAwayFrom] = useState('');
  const [awayTo, setAwayTo] = useState('');
  const [asked, setAsked] = useState(0);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    const at = availabilityGeneration();
    getMyAvailability(controller.signal)
      .then((a) => {
        if (!controller.signal.aborted) setSharedAvailability(a, at);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [asked]);

  // Every opening starts from what is saved, never from an abandoned edit —
  // and a save that is refused keeps the edit, so it can be put right.
  useEffect(() => {
    setDraft(undefined);
    setProblem(undefined);
    setTagProblem(undefined);
    setTyped('');
    setAwayFrom('');
    setAwayTo('');
  }, [open]);
  useEffect(() => {
    if (open && draft === undefined && saved !== undefined) setDraft(draftOf(saved));
  }, [open, draft, saved]);
  // The record was forgotten — a different person signed in: so is the edit.
  useEffect(() => {
    if (saved === undefined) setDraft(undefined);
  }, [saved]);

  const today = dayIn(readerZone(), now);
  const pill = pillOf(saved);
  const label =
    pill === null
      ? 'My availability: not set. Set it'
      : `My availability: ${pillSentence(pill, saved?.hours_per_week)}. Change`;

  const change = (patch: Partial<Draft>): void => {
    setDraft((d) => (d === undefined ? d : { ...d, ...patch }));
    setProblem(undefined);
  };

  const current = saved?.away_periods.find((p) => p.from <= today && p.to >= today);
  const upcoming = (saved?.away_periods ?? []).filter((p) => p !== current);

  const save = async (): Promise<void> => {
    // Whose record this is for: a sign-in meanwhile drops the answer.
    const at = availabilityGeneration();
    if (saved === undefined || draft === undefined || busy) return;
    if (draft.choice === 'away' && draft.until === '') {
      setProblem({ field: 'to', message: 'Pick the day you are back.' });
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const hours = draft.hours.trim() === '' ? null : Number(draft.hours);
      const patch: AvailabilityPatch = {
        ...(draft.choice === 'open' || draft.choice === 'capacity' ? { status: draft.choice } : {}),
        hours_per_week: draft.choice === 'open' ? hours : saved.hours_per_week,
        note: draft.note.trim() === '' ? null : draft.note.trim(),
        tags: draft.tags,
        work_week:
          draft.days.length === 0 && draft.start === '' && draft.end === ''
            ? null
            : {
                days: [...draft.days].sort((a, b) => a - b),
                start: draft.start === '' ? null : draft.start,
                end: draft.end === '' ? null : draft.end,
              },
      };
      let next = await setMyAvailability(patch);
      // Away is a period, not a status: *away until* writes one from today,
      // moving the current one's end, and leaving away ends it. A move adds
      // the new period **before** removing the old one, so a refused add
      // leaves the person away rather than not away at all.
      if (draft.choice === 'away' && current?.to !== draft.until) {
        next = await addAwayPeriod(current?.from ?? today, draft.until);
        if (current !== undefined) {
          await deleteAwayPeriod(current.id);
          next = await getMyAvailability();
        }
      } else if (draft.choice !== 'away' && current !== undefined) {
        await deleteAwayPeriod(current.id);
        next = await getMyAvailability();
      }
      setSaved(next, at);
      setOpen(false);
    } catch (cause) {
      setProblem(problemOf(cause));
      // A half-made change — the status saved, the period refused — is shown as it is.
      getMyAvailability()
        .then((a) => {
          setSaved(a, at);
        })
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const addPeriod = async (): Promise<void> => {
    // Whose record this is for: a sign-in meanwhile drops the answer.
    const at = availabilityGeneration();
    if (awayFrom === '' || awayTo === '' || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      setSaved(await addAwayPeriod(awayFrom, awayTo), at);
      setAwayFrom('');
      setAwayTo('');
    } catch (cause) {
      setProblem(problemOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const removePeriod = async (periodId: string): Promise<void> => {
    // Whose record this is for: a sign-in meanwhile drops the answer.
    const at = availabilityGeneration();
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await deleteAwayPeriod(periodId);
      setSaved(await getMyAvailability(), at);
    } catch (cause) {
      setProblem(problemOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const onTagKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || draft === undefined) return;
    event.preventDefault();
    const result = addTag(draft.tags, typed);
    if ('problem' in result) {
      setTagProblem(result.problem);
      return;
    }
    setTagProblem(undefined);
    change({ tags: result.tags });
    setTyped('');
  };

  const err = (field: string): string | undefined =>
    problem !== undefined && (problem.field === field || problem.field.startsWith(`${field}.`))
      ? problem.message
      : undefined;
  const updated = updatedAgo(saved?.updated_at, now);

  const chevron = (
    <svg className="avail-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
  const trigger = head ? (
    saved === undefined ? (
      <span className="avail-trigger-quiet">{failed ? 'Availability' : 'Availability…'}</span>
    ) : (
      <span className="avail-head-trigger">
        <AvailabilityPill availability={saved} unset="Set availability" />
        {chevron}
      </span>
    )
  ) : saved === undefined ? (
    <span className="avail-trigger-quiet">{failed ? 'Availability' : 'Availability…'}</span>
  ) : pill === null ? (
    <span className="avail-trigger-quiet">Set availability</span>
  ) : (
    <AvailabilityPill availability={saved} />
  );

  return (
    <HeaderPopover
      trigger={trigger}
      label={label}
      width="wide"
      align="left"
      className={head ? 'avail-pop avail-pop-head' : 'avail-pop'}
      triggerClassName="myday-chip avail-trigger"
      dataAttr="data-my-availability"
      dialog={head}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && failed) setAsked((n) => n + 1);
      }}
    >
      <div className="avail-form">
        <div className="avail-form-head">
          <h3 className="avail-form-title">My availability</h3>
          {head && (
            <Tooltip content="Close" shortcut="Escape">
              <button
                type="button"
                className="avail-close"
                aria-label="Close"
                onClick={(event) => {
                  // Back to the pill that opened it, before the panel goes.
                  event.currentTarget.closest('.myday-pop')?.querySelector('button')?.focus();
                  setOpen(false);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
        {saved === undefined || draft === undefined ? (
          failed ? (
            <p className="avail-error" role="alert">
              Your availability could not be read.{' '}
              <button
                type="button"
                className="avail-link"
                onClick={() => {
                  setAsked((n) => n + 1);
                }}
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="avail-quiet">Reading your availability…</p>
          )
        ) : (
          <>
            <fieldset className="avail-status">
              <legend className="avail-label">Status</legend>
              {(
                [
                  ['open', 'Open to more work', '●'],
                  ['capacity', 'At capacity', '■'],
                  ['away', 'Away until…', '◐'],
                ] as const
              ).map(([value, text, glyph]) => (
                <label key={value} className="avail-radio" data-on={draft.choice === value}>
                  <input
                    type="radio"
                    name={`${id}-status`}
                    value={value}
                    checked={draft.choice === value}
                    onChange={() => {
                      change({ choice: value });
                    }}
                  />
                  <span className="avail-radio-glyph" data-tone={value} aria-hidden="true">
                    {glyph}
                  </span>
                  <span>{text}</span>
                </label>
              ))}
              {draft.choice === 'away' && (
                <label className="avail-field avail-inline">
                  <span className="avail-label">Away until</span>
                  <input
                    type="date"
                    value={draft.until}
                    min={today}
                    aria-invalid={err('to') !== undefined}
                    onChange={(e) => {
                      change({ until: e.target.value });
                    }}
                  />
                </label>
              )}
              {draft.choice === 'away' && err('to') !== undefined && (
                <p className="avail-error" role="alert">
                  {err('to')}
                </p>
              )}
            </fieldset>

            {draft.choice === 'open' && (
              <label className="avail-field avail-inline">
                <span>Can take on about</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={HOURS_MIN}
                  max={HOURS_MAX}
                  className="avail-hours"
                  value={draft.hours}
                  aria-label="Hours a week you could take on"
                  aria-invalid={err('hours_per_week') !== undefined}
                  onChange={(e) => {
                    change({ hours: e.target.value });
                  }}
                />
                <span>h/week</span>
                <span className="avail-quiet">optional</span>
              </label>
            )}
            {err('hours_per_week') !== undefined && (
              <p className="avail-error" role="alert">
                {err('hours_per_week')}
              </p>
            )}

            <label className="avail-field">
              <span className="avail-label">Note</span>
              <input
                type="text"
                value={draft.note}
                maxLength={NOTE_MAX}
                placeholder="What you would like to pick up"
                aria-invalid={err('note') !== undefined}
                onChange={(e) => {
                  change({ note: e.target.value });
                }}
              />
            </label>
            {err('note') !== undefined && (
              <p className="avail-error" role="alert">
                {err('note')}
              </p>
            )}

            <div className="avail-field">
              <label className="avail-label" htmlFor={`${id}-tag`}>
                Skills and areas
              </label>
              <div className="avail-tags">
                {draft.tags.map((tag) => (
                  <span key={tag} className="avail-tag">
                    {tag}
                    <Tooltip content={`Remove ${tag}`}>
                      <button
                        type="button"
                        className="avail-tag-x"
                        aria-label={`Remove ${tag}`}
                        onClick={() => {
                          change({ tags: draft.tags.filter((t) => t !== tag) });
                        }}
                      >
                        <Icon name="close" size="tiny" />
                      </button>
                    </Tooltip>
                  </span>
                ))}
                <input
                  id={`${id}-tag`}
                  type="text"
                  className="avail-tag-input"
                  value={typed}
                  placeholder="Type and press Enter"
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setTagProblem(undefined);
                  }}
                  onKeyDown={onTagKey}
                />
              </div>
            </div>
            {(tagProblem ?? err('tags')) !== undefined && (
              <p className="avail-error" role="alert">
                {tagProblem ?? err('tags')}
              </p>
            )}

            <fieldset className="avail-field">
              <legend className="avail-label">Working week</legend>
              <div className="avail-days" role="group" aria-label="Working days">
                {WEEKDAYS.map(([day, letter, name]) => {
                  const on = draft.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className="avail-day"
                      aria-pressed={on}
                      aria-label={name}
                      onClick={() => {
                        change({
                          days: on ? draft.days.filter((d) => d !== day) : [...draft.days, day],
                        });
                      }}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              <div className="avail-inline">
                <input
                  type="time"
                  aria-label="Day starts"
                  value={draft.start}
                  aria-invalid={err('work_week.start') !== undefined}
                  onChange={(e) => {
                    change({ start: e.target.value });
                  }}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="time"
                  aria-label="Day ends"
                  value={draft.end}
                  aria-invalid={err('work_week.end') !== undefined}
                  onChange={(e) => {
                    change({ end: e.target.value });
                  }}
                />
              </div>
            </fieldset>
            {err('work_week') !== undefined && (
              <p className="avail-error" role="alert">
                {err('work_week')}
              </p>
            )}

            <div className="avail-field">
              <span className="avail-label">Away</span>
              {upcoming.length === 0 ? (
                <p className="avail-quiet">No time away planned.</p>
              ) : (
                <ul className="avail-periods">
                  {upcoming.map((p) => (
                    <li key={p.id}>
                      <span aria-hidden="true">◐</span> {rangeShort(p.from, p.to)}
                      <Tooltip content="Remove this time away">
                        <button
                          type="button"
                          className="avail-tag-x"
                          aria-label={`Remove away ${rangeShort(p.from, p.to)}`}
                          disabled={busy}
                          onClick={() => {
                            void removePeriod(p.id);
                          }}
                        >
                          <Icon name="close" size="tiny" />
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              )}
              <div className="avail-inline">
                <input
                  type="date"
                  aria-label="Away from"
                  min={today}
                  value={awayFrom}
                  onChange={(e) => {
                    setAwayFrom(e.target.value);
                  }}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="date"
                  aria-label="Away to"
                  min={awayFrom === '' ? today : awayFrom}
                  value={awayTo}
                  onChange={(e) => {
                    setAwayTo(e.target.value);
                  }}
                />
                <button
                  type="button"
                  className="avail-link"
                  disabled={busy || awayFrom === '' || awayTo === ''}
                  onClick={() => {
                    void addPeriod();
                  }}
                >
                  Add
                </button>
              </div>
              {(err('from') ?? (draft.choice !== 'away' ? err('to') : undefined)) !== undefined && (
                <p className="avail-error" role="alert">
                  {err('from') ?? err('to')}
                </p>
              )}
            </div>

            {problem?.field === 'form' && (
              <p className="avail-error" role="alert">
                {problem.message}
              </p>
            )}

            <footer className="avail-foot">
              <span className="avail-quiet" data-stale={updated?.stale === true}>
                {updated === null ? 'Not set yet' : updated.text}
                {updated?.stale === true && ' · may be out of date'} · everyone in your spaces sees
                this
              </span>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => {
                  void save();
                }}
              >
                Save
              </Button>
            </footer>
          </>
        )}
      </div>
    </HeaderPopover>
  );
}

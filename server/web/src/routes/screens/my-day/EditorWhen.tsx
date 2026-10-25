import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clock, duration, span as spanLabel } from './format.ts';
import { minutesUnderstood } from './my-day-derive.ts';
import { Understood } from './Understood.tsx';
import { hourName } from './format.ts';
import { clockMinute, lengthMinutes, WHEN_WORDS, whenFrom, type WhenSpan } from './when-parse.ts';
import { usePhone } from './use-phone.ts';
import { Wheel, type WheelColumn } from './Wheel.tsx';
import {
  clockFrom,
  clockIndexes,
  clockText,
  lengthFrom,
  lengthIndexes,
  WHEEL_HOURS,
  WHEEL_LENGTH_HOURS,
  WHEEL_MINUTES,
  WHEEL_PERIODS,
} from './wheel-derive.ts';

/** A confirmed block the span may not cross, named for the refusal. */
export interface Conflict extends WhenSpan {
  readonly label: string;
}

/** Time already logged, drawn grey on the bar. */
export interface BusySpan extends WhenSpan {
  readonly confirmed: boolean;
  readonly label: string;
}

export interface EditorWhenProps {
  /** Minutes after midnight, or undefined for a block with no set time. */
  readonly span: WhenSpan | undefined;
  readonly minutes: number;
  /** The instant of the day's midnight and its zone, to print the fields. */
  readonly midnight: number | undefined;
  readonly tz: string;
  /** How far the span may reach: the confirmed time either side. */
  readonly limits: { readonly lo: number; readonly hi: number };
  /** The confirmed blocks, so a refusal names the one in the way (LAI-515). */
  readonly conflicts?: readonly Conflict[] | undefined;
  readonly busy: boolean;
  readonly readOnly?: boolean | undefined;
  /** A span, typed or chosen. */
  readonly onSpan: (span: WhenSpan) => void;
  /** A length alone, for a block with no set time. */
  readonly onLength: (minutes: number) => void;
  /** Chips and *Ends now* (a compose): now, in minutes after midnight, when today. */
  readonly chips?: boolean | undefined;
  readonly now?: number | undefined;
  /** The design's time-range bar (LAI-515): the day's logged time behind the violet range. */
  readonly bar?: { readonly busy: readonly BusySpan[]; readonly hint: string } | undefined;
  /** The server's refusal, shown verbatim under the fields. */
  readonly error?: string | undefined;
  /** Whether the span as it stands is refused — a compose disables Add on it. */
  readonly onRefused?: ((refused: boolean) => void) | undefined;
  /** The hint under the fields; the design's when absent. */
  readonly hint?: string | false | undefined;
}

/** The design's chips: a length each, in its own words. */
const CHIPS: readonly (readonly [number, string])[] = [
  [15, '15m'],
  [30, '30m'],
  [45, '45m'],
  [60, '1h'],
  [90, '1h 30'],
  [120, '2h'],
];

/** The bar runs 7 AM to 10 PM, as the design's does; its labels every two hours from 8. */
const BAR_START = 7 * 60;
const BAR_SPAN = 15 * 60;
const BAR_TICKS = [8, 10, 12, 14, 16, 18, 20] as const;
const GRID = 5;

const pct = (m: number): number => Math.max(0, Math.min(100, ((m - BAR_START) / BAR_SPAN) * 100));

/** The confirmed block a span runs into, if any. */
function overlapping(
  span: WhenSpan,
  conflicts: readonly Conflict[] | undefined,
): Conflict | undefined {
  return conflicts?.find((c) => c.start < span.end && c.end > span.start);
}

/**
 * WHEN (the owner's design, D-110 item 9, LAI-504, LAI-515): Start, End and
 * Length, typed; each saves when the field is left or Enter pressed, and
 * changing one updates the others. A block with no set time shows the length
 * alone, and a start typed with an end gives it its place on the Timeline. A
 * compose adds the chips, *Ends now* and the bar the range drags along.
 */
export function EditorWhen({
  span,
  minutes,
  midnight,
  tz,
  limits,
  conflicts,
  busy,
  readOnly = false,
  onSpan,
  onLength,
  chips = false,
  now,
  bar,
  error,
  onRefused,
  hint,
}: EditorWhenProps) {
  const [typed, setTyped] = useState<
    { field: 'start' | 'end' | 'length'; text: string } | undefined
  >(undefined);
  const [refused, setRefused] = useState<
    { text: string; field?: 'start' | 'end' | 'length' } | undefined
  >(undefined);
  const at = (m: number): string =>
    midnight === undefined ? '' : clock(midnight + m * 60_000, tz);
  const range = (s: WhenSpan): string =>
    midnight === undefined
      ? ''
      : spanLabel(midnight + s.start * 60_000, midnight + s.end * 60_000, tz);
  const shown = (field: 'start' | 'end' | 'length', fallback: string): string =>
    typed?.field === field ? typed.text : fallback;
  // On a phone the wheel is the way in, as an iPhone's is: no keyboard over it.
  const phone = usePhone();

  // A compose's range on the bar may sit over confirmed time until it is moved: said, and Add waits.
  const standing = span === undefined ? undefined : overlapping(span, conflicts);
  const standingWords =
    standing === undefined
      ? undefined
      : `Overlaps ${standing.label}, ${range(standing)}. Confirmed time can’t overlap.`;
  const said = refused?.text ?? standingWords ?? error;
  useEffect(() => {
    onRefused?.(refused !== undefined || standing !== undefined);
  }, [refused, standing, onRefused]);

  const refuse = (
    next:
      { readonly span: WhenSpan } | { readonly refused: 'short' | 'midnight' | 'before' | 'after' },
    attempt: WhenSpan,
    field?: 'start' | 'end' | 'length',
  ): WhenSpan | undefined => {
    if (!('refused' in next)) {
      setRefused(undefined);
      return next.span;
    }
    const into =
      next.refused === 'before' || next.refused === 'after'
        ? overlapping(attempt, conflicts)
        : undefined;
    setRefused({
      text:
        into === undefined
          ? WHEN_WORDS[next.refused]
          : `Overlaps ${into.label}, ${range(into)}. Confirmed time can’t overlap.`,
      ...(field === undefined ? {} : { field }),
    });
    return undefined;
  };

  const commit = (field: 'start' | 'end' | 'length'): void => {
    if (typed?.field !== field) return;
    const text = typed.text.trim();
    setTyped(undefined);
    if (text === '') return;
    if (field === 'length') {
      const read = lengthMinutes(text);
      if (read === undefined) {
        setRefused({ text: 'Use a length like 45 min, 1h 15 or 1:15.', field });
        return;
      }
      if (span === undefined) {
        setRefused(undefined);
        if (read !== minutes) onLength(read);
        return;
      }
      const attempt = { start: span.start, end: span.start + read };
      const next = refuse(whenFrom(span, { length: read }, limits), attempt, field);
      if (next !== undefined && next.end !== span.end) onSpan(next);
      return;
    }
    const near = span === undefined ? (now ?? 720) : field === 'start' ? span.start : span.end;
    const read = clockMinute(text, near);
    if (read === undefined) {
      setRefused({ text: 'Use a time like 14:15 or 2:15pm.', field });
      return;
    }
    if (span === undefined) {
      // No set time yet: a start places the block for its length; an end places it to end there.
      const attempt =
        field === 'start'
          ? { start: read, end: read + minutes }
          : { start: read - minutes, end: read };
      const next = refuse(whenFrom(attempt, {}, limits), attempt, field);
      if (next !== undefined) onSpan(next);
      return;
    }
    const attempt =
      field === 'start' ? { start: read, end: span.end } : { start: span.start, end: read };
    const next = refuse(
      whenFrom(span, field === 'start' ? { start: read } : { end: read }, limits),
      attempt,
      field,
    );
    if (next !== undefined && (next.start !== span.start || next.end !== span.end)) onSpan(next);
  };

  const field = (
    name: 'start' | 'end' | 'length',
    label: string,
    value: string,
    attr: Record<string, string>,
  ) => (
    <label className="editor-field">
      <span className="editor-field-label">{label}</span>
      <input
        className="input editor-input"
        value={shown(name, value)}
        placeholder={value}
        aria-label={name === 'length' ? 'Length, typed' : `${label} time`}
        aria-invalid={
          refused?.field === name || (name === 'end' && standing !== undefined) ? true : undefined
        }
        inputMode={phone ? 'none' : 'text'}
        readOnly={readOnly}
        disabled={busy}
        {...attr}
        onFocus={(event) => {
          if (readOnly) return;
          setTyped({ field: name, text: value });
          event.target.select();
        }}
        onChange={(event) => {
          setTyped({ field: name, text: event.target.value });
          setRefused(undefined);
        }}
        onBlur={() => {
          commit(name);
        }}
        onKeyDown={(event) => {
          // Enter leaves the field, and leaving it is what saves: one commit, not two.
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setTyped(undefined);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );

  /**
   * The wheel's columns for `name`, standing on what the field says now —
   * typed, wheeled or saved — and writing what is picked back into it, as
   * typing would; leaving the field saves it.
   */
  const wheelColumns = (name: 'start' | 'end' | 'length'): readonly WheelColumn[] => {
    if (name === 'length') {
      const read = typed?.field === 'length' ? lengthMinutes(typed.text) : undefined;
      const pos = lengthIndexes(read ?? minutes);
      const write = (m: number): void => {
        setTyped({ field: 'length', text: duration(m) });
        setRefused(undefined);
      };
      return [
        {
          key: 'hours',
          label: 'Hours',
          items: WHEEL_LENGTH_HOURS,
          index: pos.hours,
          unit: 'h',
          onPick: (i) => {
            write(lengthFrom({ ...pos, hours: i }));
          },
        },
        {
          key: 'minutes',
          label: 'Minutes',
          items: WHEEL_MINUTES,
          index: pos.minutes,
          unit: 'min',
          onPick: (i) => {
            write(lengthFrom({ ...pos, minutes: i }));
          },
        },
      ];
    }
    const near = span === undefined ? (now ?? 9 * 60) : name === 'start' ? span.start : span.end;
    const read = typed?.field === name ? clockMinute(typed.text, near) : undefined;
    const pos = clockIndexes(read ?? near);
    const write = (m: number): void => {
      setTyped({ field: name, text: midnight === undefined ? clockText(m) : at(m) });
      setRefused(undefined);
    };
    return [
      {
        key: 'hour',
        label: 'Hour',
        items: WHEEL_HOURS,
        index: pos.hour,
        onPick: (i) => {
          write(clockFrom({ ...pos, hour: i }));
        },
      },
      {
        key: 'minute',
        label: 'Minute',
        items: WHEEL_MINUTES,
        index: pos.minute,
        onPick: (i) => {
          write(clockFrom({ ...pos, minute: i }));
        },
      },
      {
        key: 'period',
        label: 'AM or PM',
        items: WHEEL_PERIODS,
        index: pos.period,
        onPick: (i) => {
          write(clockFrom({ ...pos, period: i }));
        },
      },
    ];
  };

  // The design's bar: the violet range drags along it, or lands where the bar is clicked.
  const barDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (span === undefined || readOnly || busy || event.button !== 0) return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const minuteAt = (x: number): number =>
      Math.round((BAR_START + ((x - rect.left) / rect.width) * BAR_SPAN) / GRID) * GRID;
    const length = span.end - span.start;
    const t0 = minuteAt(event.clientX);
    const offset =
      t0 >= span.start && t0 <= span.end ? t0 - span.start : Math.round(length / 10) * GRID;
    event.preventDefault();
    let last = span;
    const move = (ev: PointerEvent): void => {
      const start = Math.max(0, Math.min(1440 - length, minuteAt(ev.clientX) - offset));
      if (start === last.start) return;
      last = { start, end: start + length };
      setRefused(undefined);
      onSpan(last);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(event.nativeEvent);
  };

  return (
    <div className="editor-when" data-when>
      <div className={span === undefined ? 'editor-fields editor-fields-one' : 'editor-fields'}>
        {span !== undefined && field('start', 'Start', at(span.start), { 'data-when-start': '' })}
        {span !== undefined && field('end', 'End', at(span.end), { 'data-when-end': '' })}
        {field('length', 'Length', duration(minutes), { 'data-when-length': '' })}
      </div>
      {typed?.field === 'length' && <Understood text={minutesUnderstood(typed.text)} />}
      {typed !== undefined && !readOnly && !busy && (
        <>
          <div className="wheel-head">
            <span>
              {typed.field === 'start' ? 'Start' : typed.field === 'end' ? 'End' : 'Length'}
            </span>
            <button
              type="button"
              className="wheel-done"
              data-wheel-done
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                // Leaving the field is what saves it, as Enter does.
                (document.activeElement as HTMLElement | null)?.blur();
              }}
            >
              Done
            </button>
          </div>
          <Wheel
            label={typed.field === 'length' ? 'Length' : typed.field === 'start' ? 'Start' : 'End'}
            columns={wheelColumns(typed.field)}
          />
        </>
      )}
      {span === undefined && !readOnly && (
        <div className="editor-fields editor-fields-two">
          {field('start', 'Start at', '', { 'data-when-start': '' })}
          {field('end', 'or end at', '', { 'data-when-end': '' })}
        </div>
      )}
      {chips && !readOnly && (
        <div className="editor-chips">
          {CHIPS.map(([m, label]) => (
            <button
              key={m}
              type="button"
              className="editor-chip"
              data-when-chip={m}
              aria-pressed={minutes === m}
              disabled={busy}
              onClick={() => {
                if (span === undefined) onLength(m);
                else {
                  const next = refuse(whenFrom(span, { length: m }, limits), {
                    start: span.start,
                    end: span.start + m,
                  });
                  if (next !== undefined) onSpan(next);
                }
              }}
            >
              {label}
            </button>
          ))}
          {now !== undefined && span !== undefined && span.end !== now && (
            <button
              type="button"
              className="editor-chip editor-chip-words"
              data-when-ends-now
              disabled={busy}
              onClick={() => {
                const attempt = { start: now - minutes, end: now };
                const next = refuse(whenFrom(attempt, {}, limits), attempt);
                if (next !== undefined) onSpan(next);
              }}
            >
              Ends now
            </button>
          )}
        </div>
      )}
      {bar !== undefined && span !== undefined && !readOnly && (
        <div className="editor-bar-block">
          <div
            className="editor-bar"
            role="slider"
            aria-label="Time range"
            aria-valuetext={range(span)}
            data-when-bar
            onPointerDown={barDown}
          >
            {bar.busy
              .filter((b) => b.end > BAR_START && b.start < BAR_START + BAR_SPAN)
              .map((b) => (
                <span
                  key={`${String(b.start)}-${String(b.end)}`}
                  className={
                    b.confirmed ? 'editor-bar-busy editor-bar-busy-confirmed' : 'editor-bar-busy'
                  }
                  title={`${b.label} · ${range(b)}`}
                  style={{
                    left: `${String(pct(b.start))}%`,
                    width: `${String(Math.max(0.6, pct(b.end) - pct(b.start)))}%`,
                  }}
                />
              ))}
            {now !== undefined && (
              <span className="editor-bar-now" style={{ left: `${String(pct(now))}%` }} />
            )}
            <span
              className={
                standing === undefined ? 'editor-bar-sel' : 'editor-bar-sel editor-bar-sel-bad'
              }
              data-when-bar-range
              style={{
                left: `${String(pct(span.start))}%`,
                width: `${String(Math.max(0.8, pct(span.end) - pct(span.start)))}%`,
              }}
            />
          </div>
          <div className="editor-bar-ticks" aria-hidden="true">
            {BAR_TICKS.map((h) => (
              <span key={h} style={{ left: `${String(pct(h * 60))}%` }}>
                {hourName(h)}
              </span>
            ))}
          </div>
          <p className="editor-hint">{bar.hint}</p>
        </div>
      )}
      {said !== undefined && (
        <p className="editor-error" role="alert" data-when-error>
          {said}
        </p>
      )}
      {said === undefined && !readOnly && hint !== false && (
        <p className="editor-hint">
          {hint ??
            (span === undefined
              ? 'Type 45m, 1h 15 or 1:15. A start or an end gives it a place on the Timeline.'
              : 'Type 14:15 or 2:15pm. Changing one updates the others; it saves when you leave the field.')}
        </p>
      )}
    </div>
  );
}

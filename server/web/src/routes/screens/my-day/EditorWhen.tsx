import { useState } from 'react';
import { clock } from './format.ts';
import { duration } from './format.ts';
import { minutesUnderstood } from './my-day-derive.ts';
import { Understood } from './Understood.tsx';
import { clockMinute, lengthMinutes, WHEN_WORDS, whenFrom, type WhenSpan } from './when-parse.ts';

export interface EditorWhenProps {
  /** Minutes after midnight, or undefined for a block with no set time. */
  readonly span: WhenSpan | undefined;
  readonly minutes: number;
  /** The instant of the day's midnight and its zone, to print the fields. */
  readonly midnight: number | undefined;
  readonly tz: string;
  /** How far the span may reach: the confirmed time either side. */
  readonly limits: { readonly lo: number; readonly hi: number };
  readonly busy: boolean;
  readonly readOnly?: boolean | undefined;
  /** A span, typed or chosen. */
  readonly onSpan: (span: WhenSpan) => void;
  /** A length alone, for a block with no set time. */
  readonly onLength: (minutes: number) => void;
  /** Chips and *Ends now* (a compose): now, in minutes after midnight, when today. */
  readonly chips?: boolean | undefined;
  readonly now?: number | undefined;
  /** The server's refusal, shown verbatim under the fields. */
  readonly error?: string | undefined;
}

const CHIPS = [15, 30, 45, 60] as const;

/**
 * WHEN (the owner's design, D-110 item 9, LAI-504): Start, End and Length,
 * typed; each saves when the field is left or Enter pressed, and changing one
 * updates the others. A block with no set time shows the length alone, and
 * a start typed with an end gives it its place on the Timeline.
 */
export function EditorWhen({
  span,
  minutes,
  midnight,
  tz,
  limits,
  busy,
  readOnly = false,
  onSpan,
  onLength,
  chips = false,
  now,
  error,
}: EditorWhenProps) {
  const [typed, setTyped] = useState<
    { field: 'start' | 'end' | 'length'; text: string } | undefined
  >(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const at = (m: number): string =>
    midnight === undefined ? '' : clock(midnight + m * 60_000, tz);
  const shown = (field: 'start' | 'end' | 'length', fallback: string): string =>
    typed?.field === field ? typed.text : fallback;

  const commit = (field: 'start' | 'end' | 'length'): void => {
    if (typed?.field !== field) return;
    const text = typed.text.trim();
    setTyped(undefined);
    if (text === '') return;
    if (field === 'length') {
      const read = lengthMinutes(text);
      if (read === undefined) {
        setRefused('Type 45m, 1h 15 or 1:15.');
        return;
      }
      if (span === undefined) {
        setRefused(undefined);
        if (read !== minutes) onLength(read);
        return;
      }
      const next = whenFrom(span, { length: read }, limits);
      if ('refused' in next) {
        setRefused(WHEN_WORDS[next.refused]);
        return;
      }
      setRefused(undefined);
      if (next.span.end !== span.end) onSpan(next.span);
      return;
    }
    const near = span === undefined ? (now ?? 720) : field === 'start' ? span.start : span.end;
    const read = clockMinute(text, near);
    if (read === undefined) {
      setRefused('Type 14:15 or 2:15pm.');
      return;
    }
    if (span === undefined) {
      // No set time yet: a start places the block for its length; an end places it to end there.
      const next =
        field === 'start'
          ? whenFrom({ start: read, end: read + minutes }, {}, limits)
          : whenFrom({ start: read - minutes, end: read }, {}, limits);
      if ('refused' in next) {
        setRefused(WHEN_WORDS[next.refused]);
        return;
      }
      setRefused(undefined);
      onSpan(next.span);
      return;
    }
    const next = whenFrom(span, field === 'start' ? { start: read } : { end: read }, limits);
    if ('refused' in next) {
      setRefused(WHEN_WORDS[next.refused]);
      return;
    }
    setRefused(undefined);
    if (next.span.start !== span.start || next.span.end !== span.end) onSpan(next.span);
  };

  const field = (
    name: 'start' | 'end' | 'length',
    label: string,
    value: string,
    attr: Record<string, string>,
  ) => (
    <label className="myday-when-field">
      <span className="myday-when-label">{label}</span>
      <input
        className="input myday-when-input"
        value={shown(name, value)}
        placeholder={value}
        aria-label={name === 'length' ? 'Length, typed' : `${label} time`}
        disabled={busy || readOnly}
        {...attr}
        onFocus={(event) => {
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
        }}
      />
    </label>
  );

  return (
    <div className="myday-when" data-when>
      <div
        className={span === undefined ? 'myday-when-fields myday-when-one' : 'myday-when-fields'}
      >
        {span !== undefined && field('start', 'Start', at(span.start), { 'data-when-start': '' })}
        {span !== undefined && field('end', 'End', at(span.end), { 'data-when-end': '' })}
        {field('length', 'Length', duration(minutes), { 'data-when-length': '' })}
      </div>
      {typed?.field === 'length' && <Understood text={minutesUnderstood(typed.text)} />}
      {span === undefined && !readOnly && (
        <div className="myday-when-fields myday-when-place">
          {field('start', 'Start at', '', { 'data-when-start': '' })}
          {field('end', 'or end at', '', { 'data-when-end': '' })}
        </div>
      )}
      {chips && !readOnly && (
        <div className="myday-when-chips">
          {CHIPS.map((m) => (
            <button
              key={m}
              type="button"
              className="myday-cardchip"
              data-when-chip={m}
              aria-pressed={minutes === m}
              disabled={busy}
              onClick={() => {
                if (span === undefined) onLength(m);
                else {
                  const next = whenFrom(span, { length: m }, limits);
                  if ('refused' in next) setRefused(WHEN_WORDS[next.refused]);
                  else onSpan(next.span);
                }
              }}
            >
              {duration(m)}
            </button>
          ))}
          {now !== undefined && span !== undefined && span.end !== now && (
            <button
              type="button"
              className="myday-cardchip"
              data-when-ends-now
              disabled={busy}
              onClick={() => {
                const next = whenFrom({ start: now - minutes, end: now }, {}, limits);
                if ('refused' in next) setRefused(WHEN_WORDS[next.refused]);
                else onSpan(next.span);
              }}
            >
              Ends now
            </button>
          )}
        </div>
      )}
      {(refused ?? error) !== undefined && (
        <p className="myday-error" role="alert" data-when-error>
          {refused ?? error}
        </p>
      )}
      {!readOnly && (
        <p className="inspector-note">
          {span === undefined
            ? 'Type 45m, 1h 15 or 1:15. A start or an end gives it a place on the Timeline.'
            : 'Type 14:15 or 2:15pm. Changing one updates the others; it saves when you leave the field.'}
        </p>
      )}
    </div>
  );
}

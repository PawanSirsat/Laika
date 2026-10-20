import { useState, type FormEvent, type RefObject } from 'react';
import type { NewEntry, TaskRef } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { duration, span } from './format.ts';
import { parseMinutes } from './my-day-derive.ts';
import type { Span } from './timeline-derive.ts';

export interface AddTimeFormProps {
  readonly day: string;
  readonly tz: string;
  /** The gap picked on the timeline, and the instant of the day's midnight. */
  readonly slot: Span | undefined;
  readonly midnight: number | undefined;
  readonly onClearSlot: () => void;
  readonly onBreakSlot: (gap: Span) => void;
  /** The cards offered in one click; any other is typed. */
  readonly chips: readonly TaskRef[];
  readonly busy: boolean;
  /** While a batch runs (LAI-810): nothing added that its report would not count. */
  readonly locked?: boolean;
  readonly noteRef?: RefObject<HTMLInputElement | null>;
  /** `label` names where it went, for the toast. */
  readonly onAdd: (entry: NewEntry, label: string) => Promise<boolean>;
}

const LENGTHS = [15, 30, 45, 60, 90] as const;
const DEFAULT_LENGTH = 30;

/**
 * Time that leaves no trace on a machine — a meeting, a call — typed by the
 * person (LAI-787, D-088) and **confirmed as it is added**: it is what they
 * said. Laid out as the owner's design has it (LAI-831), at the foot of
 * *Confirmed*: a length in one click (or typed), a card in one click (or its
 * key), General when it was on none, and what it was.
 *
 * **A gap picked on the timeline is when it happened**: the slot reads *At
 * 2:29–2:48 PM*, the length starts as the gap's, and the entry is written with
 * that start and end. With no gap picked it has no set time. A picked gap can
 * be marked a break from here too (CHIEF's addition D).
 */
export function AddTimeForm({
  day,
  tz,
  slot,
  midnight,
  onClearSlot,
  onBreakSlot,
  chips,
  busy,
  locked = false,
  noteRef,
  onAdd,
}: AddTimeFormProps) {
  const [length, setLength] = useState<number>(DEFAULT_LENGTH);
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [card, setCard] = useState<string>('general');
  const [otherCard, setOtherCard] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // A gap picked starts the length at the gap's — in the same render that
  // shows the slot, so the two never disagree on screen.
  const [seen, setSeen] = useState<Span | undefined>(slot);
  if (slot !== seen) {
    setSeen(slot);
    if (slot !== undefined) {
      setLength(Math.min(1440, slot.end - slot.start));
      setTyped(undefined);
    }
  }

  const startMs =
    slot === undefined || midnight === undefined ? undefined : midnight + slot.start * 60_000;
  const lengths: number[] = LENGTHS.includes(length as (typeof LENGTHS)[number])
    ? [...LENGTHS]
    : [...LENGTHS, length].sort((a, b) => a - b);
  const chosenCard = otherCard ?? card;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (locked) return;
    let minutes = length;
    if (typed !== undefined) {
      const parsed = parseMinutes(typed);
      if (parsed === undefined) {
        setError('How long, as 30, 1:30 or 1h30 — between 1 minute and 24 hours.');
        return;
      }
      minutes = parsed;
    }
    const key = chosenCard.trim();
    if (key === '') {
      setError('Type a card’s key, such as LAI-42 — or choose General.');
      return;
    }
    setError(undefined);
    const text = note.trim();
    const entry: NewEntry = {
      day,
      tz,
      minutes,
      ...(startMs === undefined
        ? {}
        : { started_at: startMs, ended_at: startMs + minutes * 60_000 }),
      ...(key === 'general' ? {} : { task: key }),
      ...(text === '' ? {} : { note: text }),
    };
    void onAdd(entry, key === 'general' ? 'General' : key).then((ok) => {
      if (!ok) return;
      setNote('');
      setTyped(undefined);
      setOtherCard(undefined);
      setLength(DEFAULT_LENGTH);
    });
  };

  return (
    <form className="myday-add" onSubmit={submit} aria-label="Add time">
      <div className="myday-add-head">
        <span className="myday-add-title">Add time</span>
        <span className="myday-card-caption">a meeting, a call — confirmed as you add it</span>
        <span className="myday-card-head-gap" />
        {slot !== undefined && startMs !== undefined ? (
          <span className="myday-slot" data-slot>
            At {span(startMs, startMs + length * 60_000, tz)}
            <button
              type="button"
              className="myday-slot-clear"
              aria-label="Clear the time"
              onClick={onClearSlot}
            >
              <span aria-hidden="true">×</span>
            </button>
            <button
              type="button"
              className="myday-linkish"
              data-break-slot
              disabled={busy || locked}
              onClick={() => {
                onBreakSlot(slot);
              }}
            >
              It was a break
            </button>
          </span>
        ) : (
          <span className="myday-quiet">No set time — or click a gap on the timeline</span>
        )}
      </div>

      <div className="myday-add-row">
        <div className="myday-segmented" role="group" aria-label="How long">
          {lengths.map((m) => (
            <button
              key={m}
              type="button"
              className="myday-segment"
              data-length={m}
              aria-pressed={typed === undefined && length === m}
              onClick={() => {
                setLength(m);
                setTyped(undefined);
              }}
            >
              {duration(m)}
            </button>
          ))}
          {typed === undefined ? (
            <button
              type="button"
              className="myday-segment"
              onClick={() => {
                setTyped('');
              }}
            >
              Other…
            </button>
          ) : (
            <input
              className="input myday-add-length"
              value={typed}
              placeholder="1 h 10 min"
              aria-label="How long, typed"
              inputMode="numeric"
              // Opened by the reader's own click.
              autoFocus
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          )}
        </div>
        <div className="inspector-chips" role="group" aria-label="On which card">
          <button
            type="button"
            className="myday-cardchip"
            data-add-card="general"
            aria-pressed={otherCard === undefined && card === 'general'}
            title="No card, on purpose"
            onClick={() => {
              setCard('general');
              setOtherCard(undefined);
            }}
          >
            General
          </button>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="myday-cardchip"
              data-add-card={chip.key}
              aria-pressed={otherCard === undefined && card === chip.key}
              title={chip.title}
              onClick={() => {
                setCard(chip.key);
                setOtherCard(undefined);
              }}
            >
              {chip.key}
            </button>
          ))}
          {otherCard === undefined ? (
            <button
              type="button"
              className="myday-linkish"
              onClick={() => {
                setOtherCard('');
              }}
            >
              Other card…
            </button>
          ) : (
            <input
              className="input myday-add-card"
              value={otherCard}
              placeholder="LAI-42"
              aria-label="Another card’s key"
              // Opened by the reader's own click.
              autoFocus
              onChange={(event) => {
                setOtherCard(event.target.value);
              }}
            />
          )}
        </div>
      </div>

      <div className="myday-add-row">
        <input
          ref={noteRef}
          className="input myday-add-note"
          value={note}
          maxLength={280}
          placeholder="What it was — a meeting, a call…"
          aria-label="What it was"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <button
          type="submit"
          className="myday-chip myday-chip-primary"
          data-add-submit
          disabled={busy || locked}
        >
          {busy && <Spinner size="sm" label="Adding this time" />}
          Add {typed === undefined ? duration(length) : 'time'}
        </button>
      </div>
      {error !== undefined && (
        <p className="myday-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

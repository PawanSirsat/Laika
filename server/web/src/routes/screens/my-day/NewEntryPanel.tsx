import { useState, type KeyboardEvent } from 'react';
import type { EntryKind, MyDay, NewEntry } from '../../../api/time.ts';
import type { CardChip } from './card-chips.ts';
import { EditorFrame } from './EditorFrame.tsx';
import { EditorWhen, type BusySpan, type Conflict } from './EditorWhen.tsx';
import { KINDS, kindLabel } from './entry-kinds.ts';
import { duration, span as spanLabel } from './format.ts';
import { atClock, dayLabel, weekdayShort } from './my-day-derive.ts';
import { PRESETS } from './presets.ts';
import { TaskChips } from './TaskChips.tsx';
import { TaskSearch } from './TaskSearch.tsx';
import { type Span } from './timeline-derive.ts';

export const ENTRY_TITLE_MAX = 120;
export const ENTRY_DESCRIPTION_MAX = 2000;

/** Where a new entry came from: the words of its sub line. */
export type NewEntryFrom = 'button' | 'drag' | 'gap' | 'timer';

export interface NewEntryPanelProps {
  readonly view: MyDay;
  /** Minutes after the day's midnight: the range dragged, or the gap picked. */
  readonly range: Span;
  readonly from: NewEntryFrom;
  /** A gap, whole — to now on today — for *Reset to the whole gap*. */
  readonly gap?: Span | undefined;
  /** `Gap 2 of 3` and its ‹ › when the day has more than one. */
  readonly gapNav?:
    | {
        readonly index: number;
        readonly total: number;
        readonly onPrev: () => void;
        readonly onNext: () => void;
      }
    | undefined;
  /**
   * Starts with no set time (LAI-502, the header's *Add time* when the day
   * has no free stretch): a length alone, posted without a span.
   */
  readonly untimed?: boolean | undefined;
  /** What a stopped timer already said (LAI-502): its card, kind and title. */
  readonly prefill?:
    | {
        readonly task?: string | undefined;
        readonly kind?: EntryKind | undefined;
        readonly title?: string | undefined;
      }
    | undefined;
  /** How far the span may reach on the open day: the confirmed time either side. */
  readonly limits: { readonly lo: number; readonly hi: number };
  /** The open day's confirmed blocks, named: a span over one is refused in their name. */
  readonly conflicts: readonly Conflict[];
  /** The open day's blocks, for the bar's grey. */
  readonly busySpans: readonly BusySpan[];
  /** Now, in minutes after midnight, when the day is today: for *Ends now* and the bar. */
  readonly now?: number | undefined;
  readonly chips: readonly CardChip[];
  readonly busy: boolean;
  readonly onAdd: (entry: NewEntry, label: string) => Promise<boolean>;
  readonly onCancel: () => void;
  /** A gap's *Mark as break*. */
  readonly onBreak?: (() => void) | undefined;
  readonly onClose: () => void;
}

const SUB_FROM: Readonly<Record<NewEntryFrom, string>> = {
  button: 'From Add time · saved as confirmed',
  drag: 'From the range you dragged on the Timeline',
  gap: 'Nothing reached Laika in this time',
  timer: 'From your timer · its stop was refused',
};

/**
 * Add time (the owner's `MyDay.dc.html`, LAI-515; D-108, LAI-897): a new
 * entry for a range on the Timeline, a gap, or the header's button — WHEN
 * with the date tiles, the fields, the chips and the bar; the off-screen
 * presets; a task, found or offered; a kind; what it was; and *Add*, which
 * posts the exact range, confirmed. A gap fills with the same panel, headed
 * *Fill this gap*, and can be marked a break instead.
 */
export function NewEntryPanel({
  view,
  range,
  from,
  gap,
  gapNav,
  untimed: startUntimed = false,
  prefill,
  limits,
  conflicts,
  busySpans,
  now,
  chips,
  busy,
  onAdd,
  onCancel,
  onBreak,
  onClose,
}: NewEntryPanelProps) {
  const [day, setDay] = useState(view.day);
  const [placed, setPlaced] = useState<Span>(range);
  const [untimed, setUntimed] = useState(startUntimed);
  const [minutes, setMinutes] = useState(range.end - range.start);
  const [kind, setKind] = useState<EntryKind | undefined>(prefill?.kind);
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [description, setDescription] = useState('');
  const [card, setCard] = useState<string>(prefill?.task ?? 'general');
  const [error, setError] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const isGap = gap !== undefined;
  const onOpenDay = day === view.day;
  const midnight = atClock(day, '00:00', view.tz);
  const at = (minute: number): number => (midnight ?? 0) + minute * 60_000;
  const length = untimed ? minutes : placed.end - placed.start;
  const rangeText = untimed
    ? `No set time · ${duration(length)}`
    : `${spanLabel(at(placed.start), at(placed.end), view.tz)} · ${duration(length)}`;
  const gapChanged = isGap && (placed.start !== gap.start || placed.end !== gap.end);

  const submit = (): void => {
    if (refused) return;
    const named = title.trim();
    const fallback = kind === undefined ? '' : kindLabel(kind);
    const sent = named === '' && card === 'general' ? fallback : named;
    if (card === 'general' && sent === '') {
      setError('Give it a title or a kind, or put it on a task.');
      return;
    }
    setError(undefined);
    const words = description.trim();
    const entry: NewEntry = {
      day,
      tz: view.tz,
      minutes: length,
      ...(untimed ? {} : { started_at: at(placed.start), ended_at: at(placed.end) }),
      ...(card === 'general' ? {} : { task: card }),
      ...(kind === undefined ? {} : { kind }),
      ...(sent === '' ? {} : { title: sent }),
      ...(words === '' ? {} : { description: words }),
    };
    const label = card === 'general' ? (sent === '' ? 'General' : sent) : card;
    void onAdd(entry, onOpenDay ? label : `${label} on ${dayLabel(day)}`).then((ok) => {
      if (!ok) setError('It was not added — the message above says why.');
    });
  };

  // Enter adds, as the ↵ on the button says — unless a field is taking it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
    event.preventDefault();
    submit();
  };

  const customTitle = (text: string): void => {
    setTitle(text);
    setCard('general');
  };

  const foot = (
    <>
      <button
        type="button"
        className="editor-primary"
        data-range-add
        disabled={busy || refused}
        onClick={submit}
      >
        Add {duration(length)}
        {!untimed && <kbd className="editor-kbd">↵</kbd>}
      </button>
      {isGap && onBreak !== undefined ? (
        <button
          type="button"
          className="editor-act"
          data-gap-break
          disabled={busy}
          onClick={onBreak}
        >
          Mark as break
        </button>
      ) : (
        <button type="button" className="editor-act" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  );

  return (
    <EditorFrame
      kind={isGap ? 'gap' : 'range'}
      forId={isGap ? `gap-${String(range.start)}` : `range-${String(range.start)}`}
      label={isGap ? 'Fill this gap' : 'Add time'}
      pill={isGap ? 'Gap' : 'New entry'}
      pillClass={isGap ? 'inspector-kind-gap' : 'inspector-kind-new'}
      icon="+"
      nav={
        gapNav === undefined
          ? undefined
          : {
              text: `Gap ${String(gapNav.index + 1)} of ${String(gapNav.total)}`,
              prevLabel: 'Previous gap',
              nextLabel: 'Next gap',
              onPrev: gapNav.onPrev,
              onNext: gapNav.onNext,
            }
      }
      onClose={onClose}
      title={isGap ? 'Fill this gap' : 'Add time'}
      sub={`${onOpenDay ? '' : `${dayLabel(day)} · `}${rangeText} · ${SUB_FROM[from]}`}
      foot={foot}
      onKeyDown={onKeyDown}
    >
      <div data-new-entry>
        <section className="editor-section">
          <div className="editor-label-row">
            <h3 className="editor-label">When</h3>
            {!isGap && (
              <label className="editor-check">
                <input
                  type="checkbox"
                  className="myday-check"
                  checked={untimed}
                  disabled={busy}
                  data-new-entry-untimed
                  onChange={(event) => {
                    setUntimed(event.target.checked);
                    setError(undefined);
                  }}
                />
                No set time
              </label>
            )}
          </div>
          {isGap ? (
            <div className="editor-gap">
              <p className="editor-gap-range" data-new-entry-range>
                {rangeText}
              </p>
              <p className="editor-hint">
                Found on your Timeline. Drag its edges there to use more or less of it.
              </p>
              {gapChanged && (
                <button
                  type="button"
                  className="editor-link"
                  data-gap-reset
                  onClick={() => {
                    setPlaced(gap);
                    setRefused(false);
                  }}
                >
                  Reset to the whole gap
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="editor-dates" role="radiogroup" aria-label="Date">
                {view.week.map((d) => {
                  const future = d.day > view.today;
                  const on = d.day === day;
                  return (
                    <button
                      key={d.day}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="editor-date"
                      data-new-entry-day={d.day}
                      disabled={busy || future}
                      title={
                        future
                          ? 'You can’t add time ahead of the day'
                          : d.day === view.today
                            ? 'Today'
                            : ''
                      }
                      onClick={() => {
                        if (!on) {
                          setDay(d.day);
                          setError(undefined);
                          setRefused(false);
                        }
                      }}
                    >
                      <span className="editor-date-name">{weekdayShort(d.day)}</span>
                      <span className="editor-date-number">{d.day.slice(8).replace(/^0/, '')}</span>
                    </button>
                  );
                })}
              </div>
              <p className="editor-range-hidden" data-new-entry-range>
                {rangeText}
              </p>
            </>
          )}
          <EditorWhen
            span={untimed ? undefined : placed}
            minutes={length}
            midnight={midnight}
            tz={view.tz}
            limits={onOpenDay ? limits : { lo: 0, hi: 1440 }}
            conflicts={onOpenDay ? conflicts : []}
            busy={busy}
            chips
            now={onOpenDay ? now : undefined}
            bar={
              isGap || untimed
                ? undefined
                : {
                    busy: onOpenDay ? busySpans : [],
                    hint: onOpenDay
                      ? 'Drag the violet range, or click to place it. Grey is time already logged.'
                      : `Drag the violet range, or click to place it. The Timeline shows only ${dayLabel(view.day)}.`,
                  }
            }
            onSpan={(next) => {
              setPlaced(next);
              setUntimed(false);
            }}
            onLength={(m) => {
              setMinutes(m);
            }}
            onRefused={setRefused}
          />
        </section>
        <section className="editor-section">
          <h3 className="editor-label">Off-screen work</h3>
          <p className="editor-hint">Time Laika can’t see. One tap sets the kind and title.</p>
          <div className="editor-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.title}
                type="button"
                className="editor-preset"
                data-preset={preset.title}
                aria-pressed={title === preset.title && kind === preset.kind}
                disabled={busy}
                onClick={() => {
                  setTitle(preset.title);
                  setKind(preset.kind);
                  setError(undefined);
                }}
              >
                {preset.title}
              </button>
            ))}
          </div>
        </section>
        <section className="editor-section">
          <h3 className="editor-label">Task</h3>
          <p className="editor-task-line">
            {card === 'general' ? (
              <>
                <span className="editor-task-key">No task</span>
                <span className="editor-task-title">
                  Shows as {kind === undefined ? 'General' : kindLabel(kind)} on the Timeline
                </span>
              </>
            ) : (
              <>
                <span className="editor-task-key">{card}</span>
                <span className="editor-task-title">
                  {chips.find((c) => c.task.key === card)?.task.title ?? ''}
                </span>
              </>
            )}
          </p>
          <TaskSearch busy={busy} onPick={setCard} onCustom={customTitle} />
          <TaskChips
            current={card === 'general' ? undefined : card}
            general={card === 'general'}
            chips={chips}
            busy={busy}
            onPick={setCard}
          />
        </section>
        <section className="editor-section">
          <h3 className="editor-label">Kind</h3>
          <div className="editor-kinds" role="radiogroup" aria-label="Kind">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                className="editor-kind"
                data-kind-pick={k.kind}
                aria-checked={kind === k.kind}
                aria-pressed={kind === k.kind}
                disabled={busy}
                onClick={() => {
                  setKind(kind === k.kind ? undefined : k.kind);
                  setError(undefined);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
        </section>
        <section className="editor-section editor-section-last">
          <h3 className="editor-label">What it was</h3>
          <input
            className="input editor-input editor-words"
            data-entry-title
            value={title}
            maxLength={ENTRY_TITLE_MAX}
            placeholder="e.g. Sprint planning with the team"
            aria-label="What it was"
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(undefined);
            }}
          />
          <textarea
            className="input editor-textarea"
            data-entry-description
            rows={2}
            value={description}
            maxLength={ENTRY_DESCRIPTION_MAX}
            placeholder="Add a description (optional)"
            aria-label="Description"
            disabled={busy}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </section>
        {error !== undefined && (
          <p className="editor-error" role="alert" data-new-entry-error>
            {error}
          </p>
        )}
      </div>
    </EditorFrame>
  );
}

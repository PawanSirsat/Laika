import { useState } from 'react';
import type { EntryKind, MyDay, NewEntry, TaskRef } from '../../../api/time.ts';
import { EMPTY_DETAILS, EntryDetailsFields, type EntryDetails } from './EntryDetailsFields.tsx';
import { duration, span } from './format.ts';
import { EditorWhen } from './EditorWhen.tsx';
import { CardPicker } from './Inspector.tsx';
import { PRESETS } from './presets.ts';
import { TaskSearch } from './TaskSearch.tsx';
import { type Span } from './timeline-derive.ts';

export interface NewEntryPanelProps {
  readonly view: MyDay;
  /** Minutes after the day's midnight: the range dragged, or the gap picked. */
  readonly range: Span;
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
  /** How far the span may reach: the confirmed time either side. */
  readonly limits: { readonly lo: number; readonly hi: number };
  /** Now, in minutes after midnight, when the day is today: for *Ends now*. */
  readonly now?: number | undefined;
  readonly chips: readonly TaskRef[];
  readonly busy: boolean;
  readonly onAdd: (entry: NewEntry, label: string) => Promise<boolean>;
  readonly onCancel: () => void;
}

/**
 * A new entry for a range on the Timeline (D-108, LAI-897): what it was —
 * kind, title, description — a card or General, the end adjustable within the
 * free stretch, and Add, which posts the exact range. A title is asked for
 * when there is no card; with one, the card is the name.
 */
export function NewEntryPanel({
  view,
  range,
  untimed: startUntimed = false,
  prefill,
  limits,
  now,
  chips,
  busy,
  onAdd,
  onCancel,
}: NewEntryPanelProps) {
  const [placed, setPlaced] = useState<Span>(range);
  const [untimed, setUntimed] = useState(startUntimed);
  const [minutes, setMinutes] = useState(range.end - range.start);
  const start = placed.start;
  const end = placed.end;
  const [details, setDetails] = useState<EntryDetails>({
    ...EMPTY_DETAILS,
    ...(prefill?.kind === undefined ? {} : { kind: prefill.kind }),
    ...(prefill?.title === undefined ? {} : { title: prefill.title }),
  });
  const [card, setCard] = useState<string>(prefill?.task ?? 'general');
  const [error, setError] = useState<string | undefined>(undefined);
  const midnight = Date.parse(`${view.day}T00:00:00Z`);
  const at = (minute: number): number => midnight + minute * 60_000;
  const titleRequired = card === 'general';

  const submit = (): void => {
    const title = details.title.trim();
    if (titleRequired && title === '') {
      setError('Give it a title, or put it on a card.');
      return;
    }
    setError(undefined);
    const description = details.description.trim();
    const entry: NewEntry = {
      day: view.day,
      tz: view.tz,
      minutes: untimed ? minutes : end - start,
      ...(untimed ? {} : { started_at: at(start), ended_at: at(end) }),
      ...(card === 'general' ? {} : { task: card }),
      ...(details.kind === undefined ? {} : { kind: details.kind }),
      ...(title === '' ? {} : { title }),
      ...(description === '' ? {} : { description }),
    };
    void onAdd(entry, card === 'general' ? (title === '' ? 'General' : title) : card).then((ok) => {
      if (!ok) setError('It was not added — the message above says why.');
    });
  };

  return (
    <div className="inspector-body" data-new-entry>
      <div className="inspector-part">
        <h3 className="inspector-label">When</h3>
        <p className="inspector-range" data-new-entry-range>
          {untimed ? 'No set time' : span(at(start), at(end), view.tz)}
        </p>
        <EditorWhen
          span={untimed ? undefined : { start, end }}
          minutes={untimed ? minutes : end - start}
          midnight={midnight}
          tz={view.tz}
          limits={limits}
          busy={busy}
          chips
          now={now}
          onSpan={(next) => {
            setPlaced(next);
            setUntimed(false);
          }}
          onLength={(m) => {
            setMinutes(m);
          }}
        />
        <label className="myday-check inspector-row">
          <input
            type="checkbox"
            checked={untimed}
            disabled={busy}
            data-new-entry-untimed
            onChange={(event) => {
              setUntimed(event.target.checked);
            }}
          />
          No set time — a length alone, listed below the Timeline
        </label>
      </div>
      <div className="inspector-part">
        <h3 className="inspector-label">Off-screen work</h3>
        <p className="inspector-note">Time Laika can’t see. One tap sets the kind and title.</p>
        <div className="inspector-chips">
          {PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              className="myday-cardchip"
              data-preset={preset.title}
              aria-pressed={details.title === preset.title && details.kind === preset.kind}
              disabled={busy}
              onClick={() => {
                setDetails({ ...details, title: preset.title, kind: preset.kind });
              }}
            >
              {preset.title}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-part">
        <h3 className="inspector-label">What it was</h3>
        <EntryDetailsFields
          value={details}
          onChange={setDetails}
          titleRequired={titleRequired}
          idPrefix="new-entry"
          busy={busy}
        />
      </div>
      <div className="inspector-part">
        <h3 className="inspector-label">Task</h3>
        <TaskSearch busy={busy} onPick={setCard} />
        <CardPicker
          current={card === 'general' ? undefined : card}
          general={card === 'general'}
          chips={chips}
          busy={busy}
          onPick={setCard}
        />
      </div>
      {error !== undefined && (
        <p className="myday-error inspector-pad" role="alert" data-new-entry-error>
          {error}
        </p>
      )}
      <div className="inspector-row inspector-pad">
        <button
          type="button"
          className="myday-chip myday-chip-primary"
          data-range-add
          disabled={busy}
          onClick={submit}
        >
          Add {duration(untimed ? minutes : end - start)}
        </button>
        <button type="button" className="myday-chip" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

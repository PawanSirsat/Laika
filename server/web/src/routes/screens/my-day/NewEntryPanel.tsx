import { useState } from 'react';
import type { MyDay, NewEntry, TaskRef } from '../../../api/time.ts';
import { EMPTY_DETAILS, EntryDetailsFields, type EntryDetails } from './EntryDetailsFields.tsx';
import { duration, span } from './format.ts';
import { CardPicker, Stepper } from './Inspector.tsx';
import { STEP, type Span } from './timeline-derive.ts';

export interface NewEntryPanelProps {
  readonly view: MyDay;
  /** Minutes after the day's midnight: the range dragged, or the gap picked. */
  readonly range: Span;
  /** The furthest the end may go: the next confirmed block, or the day's end. */
  readonly hi: number;
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
  hi,
  chips,
  busy,
  onAdd,
  onCancel,
}: NewEntryPanelProps) {
  const [end, setEnd] = useState(range.end);
  const [details, setDetails] = useState<EntryDetails>(EMPTY_DETAILS);
  const [card, setCard] = useState<string>('general');
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
      minutes: end - range.start,
      started_at: at(range.start),
      ended_at: at(end),
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
        <div className="inspector-row">
          <span className="inspector-range" data-new-entry-range>
            {span(at(range.start), at(end), view.tz)}
          </span>
          <Stepper
            minutes={end - range.start}
            canShorten={end - range.start > STEP}
            canLengthen={end + STEP <= hi}
            busy={busy}
            onStep={(by) => {
              setEnd((e) => Math.max(range.start + STEP, Math.min(hi, e + by)));
            }}
          />
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
        <h3 className="inspector-label">Card</h3>
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
          Add {duration(end - range.start)}
        </button>
        <button type="button" className="myday-chip" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

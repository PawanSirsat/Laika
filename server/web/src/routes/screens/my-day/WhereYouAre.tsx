import { setPlace, type MyDay } from '../../../api/time.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { PLACES, placeLabel, placeOf } from '../places.ts';

export interface WhereYouAreProps {
  readonly settings: MyDay['settings'];
  /** The day's own zone: what stands in until a place is set. */
  readonly tz: string;
  readonly pending: string | undefined;
  /** The page's runner: one write, the day re-read after, its word in a toast. */
  readonly run: (key: string, write: () => Promise<unknown>, said: string) => Promise<boolean>;
}

/** The option for "nothing set": the day's zone, named when the list knows it. */
const DEVICE = '';

/**
 * *Where you are* — the person's own place (D-106, LAI-895), beside *Draft my
 * time*: it decides the sunrise and sunset the Timeline's sky is drawn from.
 * One place from the list; the first option is the device's own zone, which
 * is what stands in while nothing is set.
 */
export function WhereYouAre({ settings, tz, pending, run }: WhereYouAreProps) {
  const fallback = placeOf(tz);
  const current = settings.place ?? DEVICE;
  const options = [
    {
      value: DEVICE,
      label:
        fallback === undefined
          ? `Your device’s zone (${tz}) — not on the list`
          : `Your device’s zone — ${placeLabel(fallback)}`,
    },
    ...PLACES.map((p) => ({ value: p.key, label: placeLabel(p) })),
  ];
  return (
    <div className="myday-switch myday-place" data-where-you-are>
      <span className="myday-switch-label" id="myday-place-label">
        Where you are
      </span>
      <Dropdown
        id="myday-place"
        variant="bare"
        className="myday-place-pick"
        noun="places"
        aria-labelledby="myday-place-label"
        searchable
        value={current}
        disabled={pending !== undefined}
        onChange={(value) => {
          if (value === current) return;
          const chosen = placeOf(value);
          void run(
            'place',
            () => setPlace(value === DEVICE ? null : value),
            chosen === undefined
              ? 'Where you are: your device’s zone. The sky follows it.'
              : `Where you are: ${placeLabel(chosen)}. The sky on your Timeline follows it.`,
          );
        }}
        options={options}
      />
    </div>
  );
}

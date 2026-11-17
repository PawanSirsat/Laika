import { Spinner } from '../components/Spinner.tsx';
import { useDelayed } from './use-delayed.ts';
import './state-kit.css';

export interface InlineBusyProps {
  /** Working. When it goes false the indicator is removed. */
  readonly active: boolean;
  /** Shown beside the spinner and announced: "Saving", "Checking the repo". */
  readonly label: string;
  /** How long work runs before anything shows. 300ms, like {@link Skeleton}. */
  readonly delayMs?: number | undefined;
}

/**
 * Busy, for a small region that has no shape to stand in for (LAI-1207) — a
 * row saving in place, a panel re-checking, a field validating.
 *
 * A {@link Skeleton} is for content about to arrive; this is for work about to
 * finish. The spinner inherits the text colour and is still under reduced
 * motion (`.spinner` in `states.css`), so the words carry the meaning when it
 * cannot turn. The live region is mounted empty and filled only once the
 * delay passes, so a 60ms save is neither drawn nor announced.
 */
export function InlineBusy({ active, label, delayMs = 300 }: InlineBusyProps) {
  const shown = useDelayed(active, { delay: delayMs });
  return (
    <span className="inline-busy" role="status" aria-live="polite" data-shown={shown || undefined}>
      {shown && (
        <>
          <Spinner size="sm" />
          <span className="inline-busy-label">{label}</span>
        </>
      )}
    </span>
  );
}

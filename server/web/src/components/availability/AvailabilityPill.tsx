import type { AvailabilitySeen } from '../../api/availability.ts';
import { pillOf, pillSentence } from './availability-derive.ts';
import './availability.css';

export interface AvailabilityPillProps {
  readonly availability: AvailabilitySeen | null | undefined;
  /** Leave out the `~6 h/wk` even when it was sent — a row that has a *Can take* column. */
  readonly hideHours?: boolean;
}

/**
 * What someone said about taking on work (D-131, frames 2a, 2d, 2g): a glyph
 * **and** words — ● open, ■ at capacity, ◐ away until — so it never says it
 * by colour alone. Nothing when they have said nothing.
 */
export function AvailabilityPill({ availability, hideHours = false }: AvailabilityPillProps) {
  const pill = pillOf(availability);
  if (pill === null) return null;
  const hours = hideHours ? '' : pill.hours;
  return (
    <span
      className="avail-pill"
      data-avail-pill={pill.tone}
      title={pillSentence(pill, hideHours ? null : availability?.hours_per_week)}
    >
      <span className="avail-pill-glyph" aria-hidden="true">
        {pill.glyph}
      </span>
      <span>{pill.label}</span>
      {hours !== '' && <span className="avail-pill-hours">· {hours}</span>}
    </span>
  );
}

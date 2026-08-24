import { strength } from './validation.ts';
import './forms.css';

const BANDS = ['weak', 'fair', 'good', 'strong'] as const;

/**
 * Password strength meter.
 *
 * Not a gate — `validation.password()` is the gate. This is feedback while
 * typing, so it is `aria-live="polite"` and describes the band in words as well
 * as bars: four coloured segments mean nothing to a screen reader, and the
 * colour ramp alone (red → green) is invisible to some readers.
 */
export function PasswordStrength({ value }: { readonly value: string }) {
  const { band, score, hint } = strength(value);

  if (value === '') return null;

  return (
    <div className="strength">
      <div className="strength-bars" aria-hidden="true">
        {BANDS.map((_, i) => (
          <span key={i} className={i < score ? `strength-bar strength-${band}` : 'strength-bar'} />
        ))}
      </div>
      <p className="strength-text" aria-live="polite">
        <span className={`strength-label strength-text-${band}`}>{band}</span>
        {hint !== '' && <span className="strength-hint"> — {hint}</span>}
      </p>
    </div>
  );
}

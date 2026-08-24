import { useState } from 'react';
import { Field } from './Field.tsx';
import { PasswordStrength } from './PasswordStrength.tsx';
import './forms.css';

export interface PasswordInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoComplete?: 'current-password' | 'new-password';
  /** Show the strength meter. Only useful where a password is being chosen. */
  readonly showStrength?: boolean;
}

/**
 * Password field with show/hide.
 *
 * The toggle is a real `<button>` inside the field, not an icon with a click
 * handler: it must be tabbable and announce its state. `aria-pressed` carries
 * that state; the label says which action the button performs.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  help,
  error,
  required = false,
  disabled = false,
  autoComplete = 'current-password',
  showStrength = false,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Field label={label} help={help} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <>
          <div className="input-affix">
            <input
              id={inputId}
              className="input"
              type={revealed ? 'text' : 'password'}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
              }}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              aria-required={required || undefined}
              disabled={disabled}
              autoComplete={autoComplete}
            />
            <button
              type="button"
              className="input-affix-button"
              aria-pressed={revealed}
              disabled={disabled}
              onClick={() => {
                setRevealed((v) => !v);
              }}
            >
              {revealed ? 'Hide' : 'Show'}
              <span className="visually-hidden"> password</span>
            </button>
          </div>
          {showStrength && <PasswordStrength value={value} />}
        </>
      )}
    </Field>
  );
}

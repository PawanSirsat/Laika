import { useRef, useState, type KeyboardEvent } from 'react';
import { Field } from './Field.tsx';
import { PasswordStrength } from './PasswordStrength.tsx';
import { useFirstFocus } from './use-first-focus.ts';
import './forms.css';

export interface PasswordInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  /** Invalid, with the explanation shown by the form. See `Field`. */
  readonly invalid?: boolean;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoComplete?: 'current-password' | 'new-password';
  /** Show the strength meter. Only useful where a password is being chosen. */
  readonly showStrength?: boolean;
  /**
   * Focused when it mounts: the first field of a page that is nothing but its
   * form — sign in, first boot, an invite, a reset (LAI-1191).
   */
  readonly autoFocus?: boolean;
  /** Where a form validates on blur (LAI-1203). */
  readonly onBlur?: (() => void) | undefined;
}

/**
 * Password field with show/hide and a Caps Lock hint.
 *
 * The toggle is a real `<button>` inside the field, not an icon with a click
 * handler: it must be tabbable and announce its state. `aria-pressed` carries
 * that state; the label says which action the button performs, and
 * `aria-controls` names the field it acts on.
 *
 * **Caps Lock** (LAI-1203) is read from the key events the field already gets
 * — `getModifierState`, which the browser keeps — so it costs no listener on
 * the window. It is said in words in a polite live region tied to the field by
 * `aria-describedby`, and cleared on blur: a hint about a field you have left
 * is about nothing.
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
  invalid = false,
  onBlur,
  autoFocus = false,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useFirstFocus(input, autoFocus, disabled);
  const [capsLock, setCapsLock] = useState(false);

  const readCapsLock = (e: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'));
  };

  return (
    <Field label={label} help={help} error={error} invalid={invalid} required={required}>
      {({ inputId, describedBy: fieldDescribedBy, invalid }) => {
        const capsId = `${inputId}-caps`;
        const describedBy =
          [fieldDescribedBy, capsLock ? capsId : undefined]
            .filter((v) => v !== undefined)
            .join(' ') || undefined;
        return (
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
                onKeyDown={readCapsLock}
                onKeyUp={readCapsLock}
                onBlur={() => {
                  setCapsLock(false);
                  onBlur?.();
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                aria-required={required || undefined}
                disabled={disabled}
                autoComplete={autoComplete}
                ref={input}
              />
              <button
                type="button"
                className="input-affix-button"
                aria-pressed={revealed}
                aria-controls={inputId}
                disabled={disabled}
                onClick={() => {
                  setRevealed((v) => !v);
                }}
              >
                {revealed ? 'Hide' : 'Show'}
                <span className="visually-hidden"> password</span>
              </button>
            </div>
            {/* Present before it has text, so the hint is announced when it
                appears rather than created with it. */}
            <p className="field-caps" id={capsId} aria-live="polite">
              {capsLock ? 'Caps Lock is on' : ''}
            </p>
            {showStrength && <PasswordStrength value={value} />}
          </>
        );
      }}
    </Field>
  );
}

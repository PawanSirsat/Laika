import { useRef } from 'react';
import { Field } from './Field.tsx';
import { useFirstFocus } from './use-first-focus.ts';
import './forms.css';

export interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'email' | 'url';
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string | undefined;
  readonly autoComplete?: string | undefined;
  /** Locked but still readable — the invite screen's email field. */
  readonly readOnly?: boolean;
  /** Invalid, with the explanation shown by the form. See `Field`. */
  readonly invalid?: boolean;
  /**
   * Focused when it mounts: the first field of a page that is nothing but its
   * form — sign in, first boot, an invite, a reset (LAI-1191).
   */
  readonly autoFocus?: boolean;
}

export function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  help,
  error,
  required = false,
  disabled = false,
  placeholder,
  autoComplete,
  readOnly = false,
  invalid = false,
  autoFocus = false,
}: TextInputProps) {
  const input = useRef<HTMLInputElement | null>(null);
  useFirstFocus(input, autoFocus, disabled || readOnly);
  return (
    <Field label={label} help={help} error={error} invalid={invalid} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          className="input"
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete={autoComplete}
          ref={input}
        />
      )}
    </Field>
  );
}

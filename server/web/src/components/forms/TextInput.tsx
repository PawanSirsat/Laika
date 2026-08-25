import { Field } from './Field.tsx';
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
}: TextInputProps) {
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
        />
      )}
    </Field>
  );
}

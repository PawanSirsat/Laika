import type { ReactNode } from 'react';
import { Field } from './Field.tsx';
import './forms.css';

export interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The control's id, for a screen that already names its fields. See `Field`. */
  readonly id?: string | undefined;
  readonly type?: 'text' | 'email' | 'url';
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string | undefined;
  readonly autoComplete?: string | undefined;
  /** Locked but still readable — the invite screen's email field. */
  readonly readOnly?: boolean;
  /** Invalid, with the explanation shown by the form. See `Field`. */
  readonly invalid?: boolean;
  /**
   * Shows a `12 / 120` count. **Not** a hard `maxlength`: a pasted value that is
   * too long is kept and marked invalid, so it can be trimmed rather than
   * silently cut off mid-word.
   */
  readonly maxLength?: number | undefined;
  /** `code` sets it in the mono face, for keys, slugs and repository names. */
  readonly appearance?: 'text' | 'code';
  /** `short` for a value that is short by nature — a task-key prefix. */
  readonly width?: 'full' | 'short';
  readonly layout?: 'stack' | 'row';
  readonly after?: ReactNode;
}

export function TextInput({
  label,
  value,
  onChange,
  id,
  type = 'text',
  help,
  error,
  required = false,
  optional = false,
  disabled = false,
  placeholder,
  autoComplete,
  readOnly = false,
  invalid = false,
  maxLength,
  appearance = 'text',
  width = 'full',
  layout = 'stack',
  after,
}: TextInputProps) {
  const classes = [
    'input',
    appearance === 'code' ? 'input-code' : '',
    width === 'short' ? 'input-short' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  return (
    <Field
      label={label}
      id={id}
      help={help}
      error={error}
      invalid={invalid}
      required={required}
      optional={optional}
      count={maxLength === undefined ? undefined : { value, max: maxLength }}
      layout={layout}
      after={after}
    >
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          className={classes}
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
          spellCheck={appearance === 'code' ? false : undefined}
        />
      )}
    </Field>
  );
}

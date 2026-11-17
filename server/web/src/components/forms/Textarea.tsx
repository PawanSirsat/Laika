import type { ReactNode } from 'react';
import { Field } from './Field.tsx';
import './forms.css';

export interface TextareaProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly id?: string | undefined;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly placeholder?: string | undefined;
  readonly invalid?: boolean;
  /** Visible rows before it scrolls; it can still be dragged taller. */
  readonly rows?: number;
  /** Shows a `12 / 120` count, and marks the field invalid past it. See `TextInput`. */
  readonly maxLength?: number | undefined;
  readonly layout?: 'stack' | 'row';
  readonly after?: ReactNode;
}

/** A multi-line text field, wired exactly as `TextInput` is (LAI-1204). */
export function Textarea({
  label,
  value,
  onChange,
  id,
  help,
  error,
  required = false,
  optional = false,
  disabled = false,
  readOnly = false,
  placeholder,
  invalid = false,
  rows = 3,
  maxLength,
  layout = 'stack',
  after,
}: TextareaProps) {
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
        <textarea
          id={inputId}
          className="input textarea"
          rows={rows}
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
        />
      )}
    </Field>
  );
}

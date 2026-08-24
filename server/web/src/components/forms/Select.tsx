import { Field } from './Field.tsx';
import './forms.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly disabled?: boolean;
}

/** Native `<select>`. It is keyboard- and touch-correct on every platform for free. */
export function Select({
  label,
  value,
  options,
  onChange,
  help,
  error,
  required = false,
  disabled = false,
}: SelectProps) {
  return (
    <Field label={label} help={help} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          className="input select"
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

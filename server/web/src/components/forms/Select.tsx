import { Dropdown } from '../Dropdown.tsx';
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
  readonly optional?: boolean;
  readonly disabled?: boolean;
  /** The control's id, for a screen that already names its fields. See `Field`. */
  readonly id?: string | undefined;
  readonly layout?: 'stack' | 'row';
}

/**
 * The app's own dropdown, as a form field (LAI-726).
 *
 * This was a native `<select>`, chosen because it is keyboard- and
 * touch-correct for free. `Dropdown` keeps both — the WAI-ARIA combobox
 * pattern, 36px rows — and draws the list in the app's tokens instead of the
 * OS's, so every select in the app looks and behaves one way.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  help,
  error,
  required = false,
  optional = false,
  disabled = false,
  id,
  layout = 'stack',
}: SelectProps) {
  return (
    <Field
      label={label}
      id={id}
      help={help}
      error={error}
      required={required}
      optional={optional}
      layout={layout}
    >
      {({ inputId, describedBy, invalid }) => (
        <Dropdown
          id={inputId}
          variant="bare"
          className="input select"
          noun={label.toLowerCase()}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          options={options}
          onChange={onChange}
        />
      )}
    </Field>
  );
}

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
  readonly disabled?: boolean;
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
  disabled = false,
}: SelectProps) {
  return (
    <Field label={label} help={help} error={error} required={required}>
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

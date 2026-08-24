import { useId } from 'react';
import './forms.css';

export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly help?: string | undefined;
  readonly disabled?: boolean;
}

/**
 * A real `<input type="checkbox">` wrapped in its label, so the whole row is a
 * hit target and the native control keeps its keyboard behaviour. Styled
 * checkboxes that replace the input with a div lose space-to-toggle and the
 * platform's own focus handling.
 */
export function Checkbox({ label, checked, onChange, help, disabled = false }: CheckboxProps) {
  const id = useId();
  const helpId = `${id}-help`;

  return (
    <div className="checkbox">
      <input
        id={id}
        className="checkbox-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={help === undefined ? undefined : helpId}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <div>
        <label className="checkbox-label" htmlFor={id}>
          {label}
        </label>
        {help !== undefined && (
          <p className="field-help" id={helpId}>
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

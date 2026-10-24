import './switch.css';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Words beside the switch; say what is on, not just "On". */
  readonly children?: React.ReactNode;
  /** When the words naming it live elsewhere, as on Organisation's facts. */
  readonly labelledBy?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * An on/off setting (LAI-751): a real `<button role="switch">`, so Space and
 * Enter flip it, a screen reader hears its name and its state, and nothing is
 * re-implemented from a `div`. Used for the organisation's *Developer
 * insights* switch on Organisation — the one switch local activity has since
 * D-102 (amended) — and for *Draft my time* on My day.
 */
export function Switch({
  checked,
  onChange,
  children,
  labelledBy,
  describedBy,
  disabled = false,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className={className === undefined ? 'switch' : `switch ${className}`}
      aria-checked={checked}
      {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      {children !== undefined && <span className="switch-text">{children}</span>}
    </button>
  );
}

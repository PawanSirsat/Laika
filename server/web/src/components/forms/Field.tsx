import { useId, type ReactNode } from 'react';
import './forms.css';

export interface FieldProps {
  readonly label: string;
  /**
   * Guidance shown before anything goes wrong.
   *
   * `| undefined` is explicit because the repo sets `exactOptionalPropertyTypes`
   * (tsconfig.base.json): without it, a caller forwarding an optional prop it
   * does not have — which every wrapper here does — fails to typecheck.
   */
  readonly help?: string | undefined;
  /** Set once the field is invalid. Replaces nothing — help stays visible. */
  readonly error?: string | undefined;
  /**
   * Invalid, with the explanation somewhere else.
   *
   * Sign-in rejection is the case: the server will not say *which* of the two
   * fields is wrong — deliberately, so the form cannot be used to discover
   * which addresses exist — so the message belongs to the form, not to a field.
   * The field still has to *look* wrong, and `aria-invalid` still has to be set,
   * or the only signal is a colour some readers cannot see.
   *
   * Ignored when `error` is set; a field with its own message does not need it.
   */
  readonly invalid?: boolean;
  readonly required?: boolean;
  /**
   * Rendered with the ids it must wire up. Every control here is labelled and
   * described through these, so a field cannot ship without them.
   */
  readonly children: (ids: {
    readonly inputId: string;
    readonly describedBy: string | undefined;
    readonly invalid: boolean;
  }) => ReactNode;
}

/**
 * Label, control, help and error — wired together (LAI-021 AC2).
 *
 * The wiring is the point. A label that is not `htmlFor`-linked reads as
 * unlabelled to a screen reader, and help text that is not in `aria-describedby`
 * is invisible to one. Doing it once here means no individual field can forget.
 *
 * The error is in a live region so it is **announced, not only coloured** —
 * colour alone excludes anyone who cannot see it, which is the criterion.
 */
export function Field({
  label,
  help,
  error,
  invalid = false,
  required = false,
  children,
}: FieldProps) {
  const isInvalid = error !== undefined || invalid;
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [help !== undefined ? helpId : undefined, error !== undefined ? errorId : undefined]
      .filter((v) => v !== undefined)
      .join(' ') || undefined;

  return (
    <div className={isInvalid ? 'field field-invalid' : 'field'}>
      <label className="field-label" htmlFor={inputId}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true" title="Required">
            *
          </span>
        )}
      </label>

      {children({ inputId, describedBy, invalid: isInvalid })}

      {help !== undefined && (
        <p className="field-help" id={helpId}>
          {help}
        </p>
      )}

      {/* Always present so the region exists before it has content; a live
          region created at the same moment as its text is often not announced. */}
      <p className="field-error" id={errorId} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}

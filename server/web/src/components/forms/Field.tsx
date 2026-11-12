import { useId, type ReactNode } from 'react';
import { charCount, describedByIds } from './field-model.ts';
import './forms.css';

export interface FieldProps {
  readonly label: string;
  /**
   * The control's id. Optional — `useId()` supplies one — for a screen whose
   * tests and links already name the field (`#ss-prefix`). The error then has
   * `${id}-error`, the help `${id}-help`.
   */
  readonly id?: string | undefined;
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
   * Says "Optional" in words beside the label. For the odd field out in a form
   * that is otherwise all required; in a form that is mostly optional, mark the
   * required ones instead and leave this off.
   */
  readonly optional?: boolean;
  /**
   * A character count under the control, right-aligned: `12 / 120`. Counted
   * in graphemes (field-model.ts). It is in `aria-describedby`, so it is read
   * when the field is reached, not announced on every keystroke.
   */
  readonly count?: { readonly value: string; readonly max: number } | undefined;
  /**
   * `stack` (label above) for forms; `row` (label and help on the left, the
   * control on the right) for a settings page. Below a phone's width a row
   * stacks again.
   */
  readonly layout?: 'stack' | 'row';
  /**
   * Rendered with the ids it must wire up. Every control here is labelled and
   * described through these, so a field cannot ship without them.
   */
  readonly children: (ids: {
    readonly inputId: string;
    readonly describedBy: string | undefined;
    readonly invalid: boolean;
  }) => ReactNode;
  /** Anything under the control that is not help: a preview, a note. */
  readonly after?: ReactNode;
}

/**
 * Label, control, help, count and error — wired together (LAI-021 AC2, LAI-1204).
 *
 * The wiring is the point. A label that is not `htmlFor`-linked reads as
 * unlabelled to a screen reader, and help text that is not in `aria-describedby`
 * is invisible to one. Doing it once here means no individual field can forget.
 *
 * **The label is always visible.** A placeholder is not a label: it vanishes
 * the moment you type, which is exactly when you need to check what the field
 * wanted.
 *
 * The error is in a live region so it is **announced, not only coloured** —
 * colour alone excludes anyone who cannot see it, which is the criterion. The
 * region is always present; the message inside it, and its id in
 * `aria-describedby`, only while there is one.
 */
export function Field({
  label,
  id,
  help,
  error,
  invalid = false,
  required = false,
  optional = false,
  count,
  layout = 'stack',
  children,
  after,
}: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const countId = `${inputId}-count`;

  const counted = count === undefined ? undefined : charCount(count.value, count.max);
  const isInvalid = error !== undefined || invalid || counted?.over === true;

  const describedBy = describedByIds({
    helpId: help !== undefined ? helpId : undefined,
    countId: counted !== undefined ? countId : undefined,
    errorId: error !== undefined ? errorId : undefined,
  });

  const labelEl = (
    <label className="field-label" htmlFor={inputId}>
      {label}
      {required && (
        <span className="field-required" aria-hidden="true" title="Required">
          *
        </span>
      )}
      {optional && !required && <span className="field-optional">Optional</span>}
    </label>
  );

  const helpEl = help !== undefined && (
    <p className="field-help" id={helpId}>
      {help}
    </p>
  );

  const countEl = counted !== undefined && (
    <p
      className={counted.over ? 'field-count field-count-over' : 'field-count'}
      id={countId}
      data-field-count
    >
      <span aria-hidden="true">{counted.text}</span>
      <span className="visually-hidden">{counted.spoken}</span>
    </p>
  );

  /* Always present so the region exists before it has content; a live region
     created at the same moment as its text is often not announced. */
  const errorEl = (
    <div className="field-error-region" role="status" aria-live="polite">
      {error !== undefined && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );

  const classes = ['field', layout === 'row' ? 'field-row' : '', isInvalid ? 'field-invalid' : '']
    .filter((c) => c !== '')
    .join(' ');

  const control = children({ inputId, describedBy, invalid: isInvalid });

  /*
   * Under the control: help and the error on the left, the count on the right,
   * on one line — so a message about the length sits beside the number it is
   * about. Without a count, help and error simply stack.
   */
  const under = (help: ReactNode) =>
    countEl === false ? (
      <>
        {help}
        {errorEl}
      </>
    ) : (
      <div className="field-meta">
        <div className="field-meta-text">
          {help}
          {errorEl}
        </div>
        {countEl}
      </div>
    );

  if (layout === 'row') {
    return (
      <div className={classes}>
        <div className="field-row-head">
          {labelEl}
          {helpEl}
        </div>
        <div className="field-row-body">
          {control}
          {under(null)}
          {after}
        </div>
      </div>
    );
  }

  return (
    <div className={classes}>
      {labelEl}
      {control}
      {under(helpEl)}
      {after}
    </div>
  );
}

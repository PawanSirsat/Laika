import './states.css';

export interface SpinnerProps {
  /**
   * Matches the type scale, so a spinner beside text is the height of that
   * text. `sm` sits in a button, `md` beside a heading.
   */
  readonly size?: 'sm' | 'md';
  /**
   * What is happening, for a screen reader. **Omit it when something beside the
   * spinner already says so** — a button that still reads "Create task" while
   * working, with `aria-busy` on it, does not also need "Loading" announced.
   */
  readonly label?: string | undefined;
}

/**
 * A circular progress indicator, for work too small to deserve a skeleton
 * (LAI-295).
 *
 * A skeleton stands in for content that is about to arrive and has a shape. A
 * spinner says *something is happening here* where there is no shape to stand
 * in for — a button you pressed, a row saving in place.
 *
 * **`currentColor`, deliberately.** It inherits whatever it sits inside, so one
 * component works on a primary button, a danger button and a plain toolbar
 * without a variant prop that would have to be kept in step with
 * `ButtonVariant`.
 *
 * **Decorative by default.** Without a `label` it is `aria-hidden`: the
 * surrounding control already carries `aria-busy`, and a spinner that announces
 * itself on top of that is read twice.
 */
export function Spinner({ size = 'sm', label }: SpinnerProps) {
  return (
    <>
      <span
        className={`spinner spinner-${size}`}
        aria-hidden={label === undefined ? 'true' : undefined}
        role={label === undefined ? undefined : 'status'}
      />
      {label !== undefined && <span className="visually-hidden">{label}</span>}
    </>
  );
}

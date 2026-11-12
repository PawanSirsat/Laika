import { useId, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Icon } from '../icon/Icon.tsx';
import type { IconName } from '../icon/icon-paths.ts';
import { Spinner } from '../Spinner.tsx';
import { buttonAttributes, type ButtonSize, type ButtonVariant } from './button-model.ts';
import './button.css';

export type { ButtonSize, ButtonVariant } from './button-model.ts';

/**
 * What a caller may still pass straight to the element: ids, data attributes,
 * the ARIA a menu or disclosure trigger needs, key handlers. **Not**
 * `className` or `style` — a button that can be restyled at the call site is
 * how the app grew 500 hand-rolled ones — and not `disabled`, `type` or
 * `onClick`, which mean something more specific here.
 */
type Passthrough = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'className'
  | 'style'
  | 'children'
  | 'disabled'
  | 'type'
  | 'onClick'
  | 'aria-disabled'
  | 'aria-busy'
>;

export interface ButtonProps extends Passthrough {
  /** The label. A string, so every button has words a screen reader can say. */
  readonly children: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  /**
   * Why it is disabled, shown beside it and linked by `aria-describedby`.
   *
   * With a reason the button stays **focusable** (`aria-disabled`), because a
   * natively disabled button is skipped by Tab and its explanation would never
   * be read to a keyboard user. Ignored unless `disabled` is set.
   */
  readonly disabledReason?: string | undefined;
  /**
   * Renders the busy state and blocks activation. Kept separate from `disabled`
   * so the reason is legible: "working" and "not allowed" look the same to a
   * user but mean different things, and only one of them resolves by waiting.
   */
  readonly busy?: boolean;
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly fullWidth?: boolean;
  /** A leading icon, decorative: the label already says what it does. */
  readonly icon?: IconName | undefined;
  /** An id the caller renders itself, added to `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * The app's one button (LAI-021, polished in LAI-1204).
 *
 * **States**, each designed rather than left to the browser: hover (pointer
 * devices only, so a tap does not leave a sticky highlight), pressed (a 2%
 * press-in, removed under reduced motion), `:focus-visible` (the accent ring),
 * disabled, disabled-with-a-reason, and busy.
 *
 * **Busy, per LAI-293:** a spinner beside the label, and **the label does not
 * change** — a button that swapped "Create task" for "Creating…" resized under
 * the cursor that had just pressed it. `aria-busy` says "working" to a screen
 * reader, so the spinner is decorative. Busy is `aria-disabled`, not
 * `disabled`, so the focus stays on the button that was pressed instead of
 * falling to `<body>`.
 *
 * **Hit area:** ≥ 44px on a coarse pointer, by an invisible `::after`, so the
 * drawn size of a toolbar button does not change on a phone (button.css).
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  disabledReason,
  busy = false,
  onClick,
  fullWidth = false,
  icon,
  describedBy,
  ref,
  ...rest
}: ButtonProps) {
  const reasonId = `${useId()}-reason`;
  const a = buttonAttributes(
    {
      variant,
      size,
      disabled,
      busy,
      disabledReason,
      fullWidth,
      iconOnly: false,
      // A Tooltip wrapping this passes its id as `aria-describedby` (LAI-1209):
      // kept beside the reason's, never overwritten by it.
      describedBy:
        [describedBy, rest['aria-describedby']]
          .filter((d) => d !== undefined && d !== '')
          .join(' ') || undefined,
    },
    reasonId,
  );

  return (
    <>
      <button
        {...rest}
        ref={ref}
        type={type}
        className={a.className}
        disabled={a.disabled}
        aria-disabled={a.ariaDisabled}
        aria-busy={a.ariaBusy}
        aria-describedby={a.describedBy}
        onClick={(event) => {
          // `aria-disabled` does not stop a click the way `disabled` does, and
          // a submit button would still submit its form — so swallow it here.
          if (a.inert) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {busy ? (
          <Spinner size="sm" />
        ) : (
          icon !== undefined && <Icon name={icon} size="small" className="button-glyph" />
        )}
        <span className="button-label">{children}</span>
      </button>
      {a.showsReason && (
        <span className="button-reason" id={reasonId}>
          {disabledReason}
        </span>
      )}
    </>
  );
}

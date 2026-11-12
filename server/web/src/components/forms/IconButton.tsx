import { useId, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Icon } from '../icon/Icon.tsx';
import type { IconName } from '../icon/icon-paths.ts';
import { Spinner } from '../Spinner.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { buttonAttributes, type ButtonSize, type ButtonVariant } from './button-model.ts';
import './button.css';

type Passthrough = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'className'
  | 'style'
  | 'children'
  | 'disabled'
  | 'type'
  | 'onClick'
  | 'aria-label'
  | 'aria-disabled'
  | 'aria-busy'
>;

export interface IconButtonProps extends Passthrough {
  readonly icon: IconName;
  /**
   * **Required**: an icon-only button has no words of its own, so this is its
   * whole accessible name. Say the action ("Close", "Remove Ada"), not the
   * picture ("X").
   */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly disabledReason?: string | undefined;
  readonly busy?: boolean;
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly describedBy?: string | undefined;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
  /**
   * The shared Tooltip, showing the label (LAI-1209) — an icon has no words a
   * sighted mouse or keyboard user can read, so by default it gets them on
   * hover and focus. A string shows other words (still never the name);
   * `false` only where something else on screen already says it.
   */
  readonly tooltip?: string | false | undefined;
  /** Its keyboard shortcut, as `Mod+B` or `Escape`: a keycap in the tooltip and `aria-keyshortcuts`. */
  readonly shortcut?: string | undefined;
  readonly tooltipSide?: 'top' | 'bottom' | undefined;
}

/**
 * The icon-only form of `Button` (LAI-1204): square, the same states, the same
 * busy rule — the spinner takes the icon's place, so the button does not
 * resize — and the same ≥ 44px hit area on a coarse pointer.
 *
 * Defaults to `ghost`, because an icon-only button is almost always a quiet
 * tool (close, remove, more) and a filled square would out-shout the form's
 * real primary action.
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  disabledReason,
  busy = false,
  onClick,
  describedBy,
  ref,
  tooltip,
  shortcut,
  tooltipSide,
  ...rest
}: IconButtonProps) {
  const reasonId = `${useId()}-reason`;
  const a = buttonAttributes(
    {
      variant,
      size,
      disabled,
      busy,
      disabledReason,
      fullWidth: false,
      iconOnly: true,
      // A Tooltip wrapping this hands its id in as `aria-describedby`; kept,
      // not overwritten by the reason's.
      describedBy:
        [describedBy, rest['aria-describedby']]
          .filter((d) => d !== undefined && d !== '')
          .join(' ') || undefined,
    },
    reasonId,
  );

  const button = (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={a.className}
      aria-label={label}
      disabled={a.disabled}
      aria-disabled={a.ariaDisabled}
      aria-busy={a.ariaBusy}
      aria-describedby={a.describedBy}
      onClick={(event) => {
        if (a.inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {busy ? <Spinner size="sm" /> : <Icon name={icon} size="small" />}
    </button>
  );

  return (
    <>
      {tooltip === false ? (
        button
      ) : (
        <Tooltip content={tooltip ?? label} shortcut={shortcut} side={tooltipSide}>
          {button}
        </Tooltip>
      )}
      {a.showsReason && (
        <span className="button-reason" id={reasonId}>
          {disabledReason}
        </span>
      )}
    </>
  );
}

/**
 * What a button's props mean for the element it renders (LAI-1204).
 *
 * Pure, so the rules are tested here rather than inferred from markup: the
 * package has no renderer (`node --test` cannot import a `.tsx`), and these
 * are exactly the rules that drift when a component grows a prop.
 */

/**
 * `invite` is `primary` in the invite flow's purple (LAI-077): the design makes
 * the invite flow purple where sign-in is neutral, so the two are not mistaken
 * for each other.
 *
 * `ghost` is a toolbar or footer action with no box until it is hovered or
 * focused — the quiet sibling of `secondary`, for actions that sit beside a
 * primary and must not compete with it.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'invite';

/**
 * Two sizes. `md` is a form's height — the same as a text field's, so a button
 * beside an input lines up. `sm` is a toolbar or a row action.
 *
 * Density is not a third size: `[data-density="compact"]` on any ancestor
 * tightens both (button.css), so a table asks for compact once rather than
 * every button in it asking separately.
 */
export type ButtonSize = 'sm' | 'md';

export interface ButtonState {
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
  readonly disabled: boolean;
  readonly busy: boolean;
  /** Why it cannot be used. Present and non-blank makes it a *reasoned* disabled. */
  readonly disabledReason: string | undefined;
  readonly fullWidth: boolean;
  readonly iconOnly: boolean;
  /** An id the caller already renders, to add to `aria-describedby`. */
  readonly describedBy: string | undefined;
}

export interface ButtonAttributes {
  readonly className: string;
  /** Native `disabled`: out of the tab order. Only for a disabled with no reason. */
  readonly disabled: boolean;
  /**
   * `aria-disabled` keeps the button **focusable** while refusing it.
   *
   * Busy uses it so focus is not thrown to `<body>` the moment you press — a
   * native `disabled` blurs the button you just activated, and a keyboard user
   * is left nowhere. A reasoned disabled uses it so the reason can be reached:
   * a natively disabled button is skipped by Tab, so the sentence explaining it
   * would never be read to anyone who navigates by keyboard.
   */
  readonly ariaDisabled: true | undefined;
  readonly ariaBusy: true | undefined;
  readonly describedBy: string | undefined;
  /** Whether activation must be swallowed — busy, disabled, or disabled with a reason. */
  readonly inert: boolean;
  /** Whether the reason text is rendered (and so must be wired to `describedBy`). */
  readonly showsReason: boolean;
}

export function hasReason(reason: string | undefined): reason is string {
  return reason !== undefined && reason.trim() !== '';
}

export function buttonAttributes(state: ButtonState, reasonId: string): ButtonAttributes {
  const reasoned = state.disabled && hasReason(state.disabledReason);
  const soft = state.busy || reasoned;

  const className = [
    'button',
    `button-${state.variant}`,
    `button-${state.size}`,
    state.iconOnly ? 'button-icon' : '',
    state.fullWidth ? 'button-block' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const describedBy =
    [state.describedBy, reasoned ? reasonId : undefined]
      .filter((id): id is string => id !== undefined && id !== '')
      .join(' ') || undefined;

  return {
    className,
    disabled: state.disabled && !soft,
    ariaDisabled: soft ? true : undefined,
    ariaBusy: state.busy ? true : undefined,
    describedBy,
    inert: state.busy || state.disabled,
    showsReason: reasoned,
  };
}

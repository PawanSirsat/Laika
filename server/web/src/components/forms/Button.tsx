import { Spinner } from '../Spinner.tsx';
import './forms.css';

/**
 * `invite` is `primary` in the invite flow's purple (LAI-077).
 *
 * A distinct variant rather than a descendant override in `auth.css`: the
 * design makes the invite flow purple where sign-in is neutral, precisely so
 * the two are not mistaken for each other, and a rule that only fires inside
 * one card is invisible from here and silently lost if the card is renamed.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'invite';

export interface ButtonProps {
  readonly children: string;
  readonly variant?: ButtonVariant;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  /**
   * Renders the busy state and blocks activation. Kept separate from `disabled`
   * so the reason is legible: "working" and "not allowed" look the same to a
   * user but mean different things, and only one of them resolves by waiting.
   */
  readonly busy?: boolean;
  readonly onClick?: (() => void) | undefined;
  readonly fullWidth?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  busy = false,
  onClick,
  fullWidth = false,
}: ButtonProps) {
  const classes = ['button', `button-${variant}`, fullWidth ? 'button-block' : '']
    .filter((c) => c !== '')
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy}
      // `aria-busy` says "working"; `disabled` alone would just say "no".
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {/*
        **A spinner beside the label, and the label does not change** (LAI-295).
        It read `busy ? (busyLabel ?? children) : children`, so every button
        swapped its text and resized mid-click — "Create task" is 11 characters
        and "Creating…" is 9, and the button moved under the cursor that had
        just pressed it.

        The `busyLabel` prop went with it rather than being left for anyone who
        wanted the old behaviour back: a prop with no callers is how a retired
        decision creeps back in.

        `aria-busy` above already says "working" to a screen reader, so the
        spinner is decorative and announces nothing on top of it.
      */}
      {busy && <Spinner size="sm" />}
      {children}
    </button>
  );
}

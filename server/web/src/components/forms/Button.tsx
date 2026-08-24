import './forms.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

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
  readonly busyLabel?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly fullWidth?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  busy = false,
  busyLabel,
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
      {busy ? (busyLabel ?? children) : children}
    </button>
  );
}

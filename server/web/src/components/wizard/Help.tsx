import type { ReactNode } from 'react';

/*
 * Styled by `routes/screens/connect/connect.css` — see the note at the top of
 * `CodeBlock.tsx` (LAI-1044).
 */

export interface HelpProps {
  /** `warn` for a caution, `info` for a side note; plain muted help otherwise. */
  readonly tone?: 'warn' | 'info' | undefined;
  /** Classes added after the tone's, for a screen's own placement. */
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

const TONE_CLASS = { warn: 'conn-note-warn', info: 'conn-info' } as const;

/**
 * Muted help under a control: smaller and quieter than body text. The tone
 * changes its colour **and** is carried by the words — a warning says what
 * the risk is, so colour is never the only signal.
 */
export function Help({ tone, className, children }: HelpProps) {
  const classes = ['conn-note'];
  if (tone !== undefined) classes.push(TONE_CLASS[tone]);
  if (className !== undefined) classes.push(className);
  return <p className={classes.join(' ')}>{children}</p>;
}

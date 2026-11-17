import type { ReactNode } from 'react';
import { GlassSurface } from '../glass/GlassSurface.tsx';
import './auth-card.css';

export interface AuthCardProps {
  /** `invite` takes the invite flow's violet edge (LAI-077); `default` is neutral. */
  readonly tone?: 'default' | 'invite' | 'warn';
  /** A wider card, for the invite's role card. */
  readonly wide?: boolean;
  readonly children: ReactNode;
  /**
   * Which state the screen is in, as the screen names it (`data-reset-state`,
   * `data-auth-state`) — a hook for tests, never for style.
   */
  readonly [attribute: `data-${string}`]: string | undefined;
}

/**
 * The one card every signed-out page sits in (LAI-1203): sign-in, invite and
 * reset password.
 *
 * **Glass comes from `GlassSurface` level 2 and nowhere else** — the card adds
 * layout and an edge tint, never a pane, blur or tint of its own, so the glass
 * guard has one place to look and a reduced-transparency reader gets the solid
 * step through the same tokens every other surface uses.
 *
 * It is centred in the space the shell leaves with auto margins rather than
 * `align-items: center`: a card taller than the viewport (the invite on a
 * phone) then scrolls from its top instead of being clipped above it.
 */
export function AuthCard({ tone = 'default', wide = false, children, ...data }: AuthCardProps) {
  const classes = ['auth-card', `auth-card-${tone}`, wide ? 'auth-card-wide' : '']
    .filter((c) => c !== '')
    .join(' ');
  return (
    <div className="auth">
      <GlassSurface level={2} className={classes} {...data}>
        {children}
      </GlassSurface>
    </div>
  );
}

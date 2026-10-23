import type { ReactNode } from 'react';
import { PEOPLE_ANALYTICS } from '../api/people-analytics.ts';
import { useGates } from '../api/permissions.ts';
import { profileHref } from '../api/profiles.ts';
import { useShell } from './shell/shell-context.ts';

export interface PersonLinkProps {
  readonly userId: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** The link's accessible name, when its text alone would not say whose profile. */
  readonly label?: string | undefined;
  /**
   * Draw nothing at all for a reader who may not open profiles, rather than the
   * children as plain text — for a link that is *extra* beside a name, such as
   * *Work by person*'s, where the plain text is already there.
   */
  readonly onlyLink?: boolean;
}

/**
 * A person, as the way into their profile (LAI-743) — and from there their
 * day and hours (LAI-959).
 *
 * **A link only for a reader who holds *See everyone's analytics*** — the
 * owner, and whichever roles the owner granted it (D-102 rule 6), by
 * `GET /permissions` rather than by role (`useGates`, LAI-970). Everyone
 * else gets the name as plain text: absent, not disabled, as the rest of the
 * app treats what `can()` refuses (LAI-082). The server refuses them
 * regardless.
 *
 * A real `<a href>`, so it opens in a new tab and reads as a link; a plain click
 * goes through the shell's router, as `DashLink` does.
 */
export function PersonLink({
  userId,
  children,
  className,
  label,
  onlyLink = false,
}: PersonLinkProps) {
  const { me, route } = useShell();
  const { org } = useGates(me !== undefined);
  if (!org(PEOPLE_ANALYTICS)) return onlyLink ? null : <>{children}</>;

  const href = profileHref(userId);
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      title={label}
      data-person-link={userId}
      onClick={(event) => {
        // Modified clicks stay the browser's — new tab, new window.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        route.navigate(href);
      }}
    >
      {children}
    </a>
  );
}

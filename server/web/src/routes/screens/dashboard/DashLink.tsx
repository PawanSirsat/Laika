import type { ReactNode } from 'react';
import { useShell } from '../../../components/shell/shell-context.ts';

/**
 * A link from the dashboard to the board, the List or a task (LAI-711).
 *
 * A real `<a href>`, so it can be opened in a new tab and read as a link; a
 * plain click moves through **the shell's** router — the one instance every
 * screen shares — rather than reloading the app.
 */
export function DashLink({
  href,
  className,
  title,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: {
  readonly href: string;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly onMouseEnter?: (() => void) | undefined;
  readonly onMouseLeave?: (() => void) | undefined;
  readonly onFocus?: (() => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
}) {
  const { route } = useShell();
  return (
    <a
      href={href}
      className={className}
      title={title}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
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

/** Where a dashboard row goes, as a link someone can paste. */
export function boardHref(slug: string, query: Record<string, string>): string {
  return `/board?${new URLSearchParams({ project: slug, ...query }).toString()}`;
}

export function listHref(slug: string, query: Record<string, string>): string {
  return `/list?${new URLSearchParams({ project: slug, ...query }).toString()}`;
}

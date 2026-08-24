import type { ReactNode } from 'react';
import './screen-header.css';

export interface ScreenHeaderProps {
  /** `Board`, `Timeline`, `Sprints` — the screen's own name. */
  readonly title: string;
  /** `laika-core · v0.4 release`. Omitted when there is nothing true to say. */
  readonly context?: ReactNode;
  /** Controls, right-aligned. */
  readonly children?: ReactNode;
}

/**
 * The header bar every screen shares.
 *
 * The prototype gives all ten screens the identical band — `12px 18px` on
 * `var(--card)` with a bottom border, the title at 15px/800 and a 10px context
 * line beside it, controls pushed right. Building it once means a new screen
 * cannot drift, and it removes the reason each screen had its own header markup.
 *
 * It also fixes a visible defect: `AppShell` used to render its own
 * `<h1>Board</h1>` above `BoardScreen`, which renders the project name — so the
 * board showed two stacked headings.
 */
export function ScreenHeader({ title, context, children }: ScreenHeaderProps) {
  return (
    <header className="screen-bar">
      <h1 className="screen-bar-title">{title}</h1>
      {context !== undefined && <p className="screen-bar-context">{context}</p>}
      {children !== undefined && <div className="screen-bar-actions">{children}</div>}
    </header>
  );
}

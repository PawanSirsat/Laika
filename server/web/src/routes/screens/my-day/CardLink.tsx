import type { MouseEvent } from 'react';
import { plainClick, taskHref, type CardRef } from './task-link.ts';

export interface CardLinkProps {
  readonly task: CardRef & { readonly title: string };
  /** The space it lives in, when known — it then opens there (LAI-755). */
  readonly slug: string | undefined;
  readonly onNavigate: (to: string) => void;
}

/**
 * A card's key and title as a real link (LAI-810): it opens the task the way
 * the rest of the app does, a plain click without reloading the page, and any
 * other click as the browser's own — a new tab, a new window.
 */
export function CardLink({ task, slug, onNavigate }: CardLinkProps) {
  const href = taskHref(task, slug);
  return (
    <a
      className="myday-cardlink"
      href={href}
      onClick={(event: MouseEvent) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      <span className="myday-cardlink-key">{task.key}</span>{' '}
      <span className="myday-cardlink-title">{task.title}</span>
    </a>
  );
}

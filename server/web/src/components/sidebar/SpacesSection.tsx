import { useState } from 'react';
import { navHref } from '../../routes/nav-url.ts';
import type { Space } from '../../routes/spaces.ts';
import { SpacesPopover } from './SpacesPopover.tsx';

export interface SpacesSectionProps {
  /** The pinned rows — three most recent (LAI-248). */
  readonly spaces: readonly Space[];
  /** Every fetched space, for the popover. */
  readonly all: readonly Space[];
  readonly projectSlug?: string | undefined;
  readonly collapsed: boolean;
  readonly onNavigate: (to: string) => void;
  readonly onOpenSpace: (slug: string) => void;
  /** Close the off-canvas rail after a pick, exactly as every nav link does. */
  readonly onClose: () => void;
}

/**
 * The SPACES section (LAI-248 gave it its rows; LAI-249 its prototype shape):
 * a collapsible head reading **Spaces** with a caret (11.5px/700, not the
 * uppercase micro-label the route groups use — the design draws this one
 * differently), a `+` that stands for *Create space*, the pinned rows, and a
 * *More spaces* row opening the popover.
 *
 * The prototype's `⋯` "More actions" button is **not** rendered: it opens
 * nothing in the design file either, and a control that does nothing is the
 * thing §5.1 forbids. The `+` navigates to `/projects`, where creation lives,
 * until a create-space surface exists.
 *
 * Collapsed, the head gives way to a hairline rule (the prototype's
 * `miniRule`) and the rows keep only their two-letter keys.
 */
export function SpacesSection({
  spaces,
  all,
  projectSlug,
  collapsed,
  onNavigate,
  onOpenSpace,
  onClose,
}: SpacesSectionProps) {
  const [open, setOpen] = useState(true);
  const [popover, setPopover] = useState(false);

  const pinned = new Set(spaces.map((s) => s.slug));
  const unpinned = all.filter((s) => !pinned.has(s.slug));

  const pick = (slug: string): void => {
    const href = navHref('/board', slug);
    setPopover(false);
    onOpenSpace(slug);
    onNavigate(href);
    onClose();
  };

  return (
    <div className="sidebar-group">
      {collapsed ? (
        <div className="sidebar-minirule" aria-hidden="true" />
      ) : (
        <div className="spaces-head">
          <button
            type="button"
            className="spaces-head-toggle"
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            <svg
              className="spaces-caret"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <path d={open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
            </svg>
            <span>Spaces</span>
          </button>
          <a
            className="spaces-create"
            href="/projects"
            title="Create space"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate('/projects');
              onClose();
            }}
          >
            <span className="visually-hidden">Create space</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </a>
        </div>
      )}

      {(open || collapsed) && (
        <ul className="sidebar-list" aria-label="Spaces">
          {spaces.map((space) => {
            // A space is current for **any** view of it, not only the board —
            // the design's `projectScreens` test. It is what makes the tab bar
            // read as being inside the space.
            const active = space.slug === projectSlug;
            const href = navHref('/board', space.slug);

            return (
              <li key={space.slug}>
                <a
                  href={href}
                  className={
                    active ? 'sidebar-link space-row sidebar-link-active' : 'sidebar-link space-row'
                  }
                  aria-current={active ? 'page' : undefined}
                  title={`${space.name} — ${space.meta}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    pick(space.slug);
                  }}
                >
                  <span className="sidebar-dot" aria-hidden="true" />
                  {/*
                    **A dot and a name** (LAI-262). The two-letter key is the
                    design's `abbr` and belongs to the collapsed rail only —
                    `.sidebar-mini` is the same mechanism a route row uses. The
                    `N tasks · M members` line is `s.meta`, and the design puts
                    it in the More-spaces popover, not here.
                  */}
                  <span className="sidebar-mini" aria-hidden="true">
                    {space.key}
                  </span>
                  <span className="sidebar-label">{space.name}</span>
                </a>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="sidebar-link sidebar-link-button"
              aria-haspopup="dialog"
              aria-expanded={popover}
              onClick={() => {
                setPopover((v) => !v);
              }}
            >
              <span className="sidebar-dot" aria-hidden="true" />
              <span className="sidebar-mini" aria-hidden="true">
                MS
              </span>
              <span className="sidebar-label">More spaces</span>
              <svg
                className="sidebar-chevron"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </li>
        </ul>
      )}

      {popover && (
        <SpacesPopover
          spaces={unpinned}
          left={collapsed ? 64 : 220}
          onPick={pick}
          onViewAll={() => {
            setPopover(false);
            onNavigate('/projects');
            onClose();
          }}
          onClose={() => {
            setPopover(false);
          }}
        />
      )}
    </div>
  );
}

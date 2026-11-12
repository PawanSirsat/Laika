import type { MouseEvent } from 'react';
import { BrandMark } from '../../components/brand/BrandMark.tsx';
import { GlassSurface } from '../../components/glass/GlassSurface.tsx';
import { ScreenHeader } from '../../components/ScreenHeader.tsx';
import './not-found.css';
import { Icon } from '../../components/icon/Icon.tsx';

/** Where a lost reader most often wants to be (LAI-1203). */
export const NOT_FOUND_LINKS = [
  { to: '/my-day', label: 'Go to My day' },
  { to: '/projects', label: 'Browse spaces' },
] as const;

/**
 * A real 404, not a blank frame (LAI-019 AC6).
 *
 * The shell stays around it — sidebar, theme, chrome — so a mistyped URL leaves
 * the reader somewhere they can navigate out of, rather than at a dead page.
 *
 * **Says what happened, then offers the ways out** (LAI-1203): the address it
 * could not find, My day and Spaces as real links (so they open in a new tab
 * like any other), and Back when there is somewhere to go back to. No ⌘K hint:
 * there is no command palette on this branch, and a shortcut that does nothing
 * is worse than none.
 */
export function NotFound({
  path,
  onNavigate,
}: {
  readonly path: string;
  readonly onNavigate: (to: string) => void;
}) {
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;

  const follow = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    // A modified click is the reader asking for a new tab or window — leave it
    // to the browser, which the real `href` makes work.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(to);
  };

  return (
    <>
      <ScreenHeader title="Page not found" context="404" />

      <div className="not-found">
        <GlassSurface level={2} className="not-found-card" aria-labelledby="not-found-title">
          {/* The mark, decorative (LAI-1126): a wrong address is still Laika. */}
          <BrandMark size={44} />
          <h2 className="not-found-title" id="not-found-title">
            There is nothing at this address
          </h2>
          <p className="not-found-body">
            Nothing is routed at <code className="not-found-path">{path}</code>. The link may be
            mistyped, or what it pointed to has moved.
          </p>

          <nav className="not-found-actions" aria-label="Ways out">
            {NOT_FOUND_LINKS.map((link, i) => (
              <a
                key={link.to}
                href={link.to}
                className={i === 0 ? 'not-found-link not-found-link-primary' : 'not-found-link'}
                onClick={follow(link.to)}
              >
                {link.label}
              </a>
            ))}
            {canGoBack && (
              <button
                type="button"
                className="not-found-link"
                onClick={() => {
                  window.history.back();
                }}
              >
                <Icon name="arrow-left" size="small" />
                Go back
              </button>
            )}
          </nav>

          <p className="not-found-hint">Everything else is one click away in the sidebar.</p>
        </GlassSurface>
      </div>
    </>
  );
}

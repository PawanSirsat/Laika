export interface BrandProps {
  /**
   * `dot` — the small accent mark the sidebar uses.
   * `tile` — the 30px rounded tile with the Laika glyph, which design `5a`
   * specifies for the auth card down to its stroke colour.
   */
  readonly variant?: 'dot' | 'tile';
}

/**
 * The Laika mark and wordmark.
 *
 * Extracted from `Sidebar` because the identity outlives the navigation: a
 * signed-out page carries no app nav (LAI-062) but must still say what it is.
 * Keeping it inside the sidebar meant removing the nav also removed the name.
 *
 * Two marks rather than one because the design uses two. The sidebar's is a
 * small accent dot; the auth card's is a tile carrying the glyph, and `5a`
 * names its ground (`--tx`) and its stroke (`--card`) — so the glyph is drawn
 * rather than approximated. It is inline SVG, not an asset: the CSP is
 * `script-src 'self'` with no external hosts (LAI-205), and a mark that needs a
 * network request is a mark that can fail to appear.
 */
export function Brand({ variant = 'dot' }: BrandProps = {}) {
  return (
    <div className="sidebar-brand">
      {variant === 'tile' ? (
        <span className="brand-tile" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="2">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </svg>
        </span>
      ) : (
        <span className="sidebar-mark" aria-hidden="true" />
      )}
      <span className="sidebar-wordmark">Laika</span>
    </div>
  );
}

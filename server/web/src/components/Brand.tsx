import { BrandLockup } from './brand/BrandLockup.tsx';

/**
 * The product's name on a page with no sidebar: the pre-auth header and the
 * first-boot rail.
 *
 * Extracted from `Sidebar` because the identity outlives the navigation: a
 * signed-out page carries no app nav (LAI-062) but must still say what it is.
 *
 * Since LAI-1126 it is the brand lockup — the glass mark and the drawn
 * wordmark from `components/brand/` — in place of the accent dot and the
 * tile-with-a-glyph the prototype used. The auth cards place the lockup
 * themselves, and the header then leaves it out (`ROUTES_WITH_THEIR_OWN_BRAND`)
 * so a sign-in page says "Laika" once, not twice.
 */
export function Brand() {
  return <BrandLockup size="md" className="sidebar-brand" />;
}

/**
 * Routes whose screen draws the lockup on its own card. The shell header skips
 * its copy there — two in one viewport was the visual audit's duplicated
 * "Laika".
 */
export const ROUTES_WITH_THEIR_OWN_BRAND: readonly string[] = [
  '/login',
  '/invite',
  '/reset-password',
];

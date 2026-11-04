---
id: LAI-1126
title: 'Brand identity: logo mark, wordmark, startup splash, icon loader, and the cool palette in the theme'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner supplied a brand sheet (logo mark, wordmark, two loaders and a
"Cool & Non-Vibrant" palette). Laika should carry it: one mark and wordmark,
drawn as hand-authored SVG with no font or raster dependency, placed where the
product names itself; a splash while the SPA boots and an icon loader for a
full-panel wait; and the palette mapped into the semantic tokens of both
themes, with the accent swap kept a one-line owner decision. PR into
`integration-ui-transformation`, not `master`.

## Acceptance criteria

- [ ] `server/web/src/components/brand/` holds `BrandMark` (glass gradient
      mark, plus a flat variant for 24px and below), `Wordmark` (SVG paths,
      periwinkle i-dot, no font) and `BrandLockup`; gradient stops come from
      CSS variables so both themes work; `agent-mark/` is untouched.
- [ ] An SVG favicon is linked from `index.html`, same-origin; the tab title
      stays `Laika`.
- [ ] Placement: sidebar head (lockup expanded, mark in the collapsed rail),
      the sign-in, first-boot, invite and reset-password cards (the name once,
      not twice), and NotFound. Nowhere else.
- [ ] `index.html` carries a splash as plain markup (no inline `<script>` or
      `<style>`), styled by a stylesheet Vite emits as a `<link>`; React
      replaces it on mount with no minimum duration. SessionGate's slow-session
      state shows the same splash, still behind its existing delay (LAI-608).
- [ ] `BrandSpinner` (`role="status"`, accessible label, sizes sm/md/lg) with
      no rotation or stepping under `prefers-reduced-motion`; skeletons and
      the inline `Spinner` are not replaced.
- [ ] Brand primitives (`--brand-ink` … `--brand-paper`, mark gradient stops,
      glow) in both theme blocks; dark surfaces/borders/text remapped to the
      Ink…Paper scale, light to Paper/Fog surfaces with Ink text; the accent
      swap to periwinkle is one commented line; status `--chip-blue` stays
      distinct from the accent; every AA pair passes in both themes, and new
      text-on-brand pairs are added to the AA list.
- [ ] Unit tests for the brand components (decorative mark `aria-hidden`,
      lockup named `Laika`); browser tests for the favicon, the splash before
      and after mount, BrandSpinner's role and reduced motion, the sidebar
      lockup/mark, and a single `Laika` on sign-in; screenshots in both themes
      at 1440 and 390.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- No new dependency. PNG favicon fallbacks would need a rasteriser package or
  committed binaries; the repo commits no icons today, so the SVG favicon
  ships alone (recorded in the log).
- `server/src/static/fallback.html` is CORE's; not touched here.
- Nearby unmerged work: LAI-1124 (docs/ux only) and LAI-1125 (theme.css
  `--font-ui`, main.tsx, SidebarFooter, SidePanel). Keep theme.css edits to
  the colour blocks and a new brand section.

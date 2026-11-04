---
id: LAI-1132
title: 'Glassmorphism design system: ambient layer, glass/elevation/layer tokens, primitives with a guard, applied to chrome and floating surfaces'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1126]
discovered-from:
started: 2026-11-04T14:04:55Z
status: in-progress
finished:
---

## Goal

The owner asked to "emphasise the glassmorphism with greater impact". On top
of LAI-1126's brand palette, give Laika a bold, accessible glass system: an
ambient background for glass to refract, glass, elevation and layer tokens in
both themes, one stylesheet of primitives that is the only home of
`backdrop-filter`, and glass applied to the app's chrome and floating
surfaces, while documents, tables, code, forms and long-form text stay on
solid surfaces. Stacked on the brand PR; retargeted to
`integration-ui-transformation` after #269 merges.

## Acceptance criteria

- [ ] Ambient layer: one fixed, `pointer-events: none`, `contain: strict`
      pseudo-element behind the shell, pure CSS gradients from brand tokens
      with curved light arcs, dark and light variants, no animation.
- [ ] Tokens in `styles/theme.css` only: `--glass-1/2/3` (+ solid fallbacks
      and a solid-on-glass surface), border, highlight, glow, blur levels
      capped at 32px, saturate; `--shadow-popover/panel/toast`; layer tokens
      `--layer-sticky … --layer-toast` with popovers and menus above panels
      (B16); duration/easing tokens and one global reduced-motion rule;
      `token-list.ts` and `tokens.test.ts` extended.
- [ ] `components/glass/`: `GlassSurface` (`level`, `as`) and `glass.css`
      with `.glass-1/2/3`, hover / selected / focus-visible states; a source
      guard that no stylesheet but `glass.css` declares `backdrop-filter`, no
      blur literal over the cap, and no nested glass; a runtime nesting check
      in a browser test.
- [ ] Applied: sidebar, shell header and space bar (level 1), board lanes
      (level-1 tint, cards solid), SidePanel, ConfirmDialog, Offboarding
      dialog and the task drawer frame (level 3 over a blurred scrim),
      Dropdown, OverflowMenu and popovers (level 3), auth cards (level 2
      hero), dashboard, organisation and capacity cards (level-2 tint).
- [ ] AA for text on every glass level against the worst-case backdrop in
      both themes, in the token tests; reduced-transparency, forced-colors,
      `@supports not (backdrop-filter)` and reduced-motion fallbacks.
- [ ] Browser tests: blur present on chrome and floating surfaces and absent
      on cards, rows and the drawer's document; reduced transparency and
      forced colours; a Dropdown in a SidePanel paints above it; focus ring
      visible on glass; login glass over ambient in both themes. Perf
      measured on a 40-card board at 1440, before and after.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- No new dependency. Plain CSS only (CSP: no runtime `<style>`).
- Not touched: `TaskDrawer.tsx`, `TaskDetailPanel.tsx` (LAI-1127), toasts
  (LAI-1129; the token is exposed), MyDay internals (LAI-1130), the
  Calendar/Activity/Capacity/Unlisted error states (LAI-1128).

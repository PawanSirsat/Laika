---
id: LAI-1205
title: 'One Dialog, panel and menu contract: polish and unify overlays'
area: shell
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-11-11T09:00:00Z
---

## Goal

Every overlay in `server/web/` — modal dialogs, side panels, menus and
popovers — shares one layering contract: correct roles and labels, focus in,
held, and restored, Escape closing only the topmost layer, scroll lock, a
backdrop policy, a z-order nested overlays respect (B16), and short
interruptible motion that disappears under reduced motion. Dispatched by polly
on `integration-ui-transformation` (phase-1 UX audit, B3/B12/B16).

## Acceptance criteria

- [ ] One `Dialog` primitive on `use-dialog-focus`: `role=dialog|alertdialog`,
      `aria-modal`, labelled title, focus trap, initial focus, focus restore,
      Escape closes only the topmost layer, scroll lock by class (no runtime
      style injection), backdrop click never closes an alertdialog, sizes,
      sticky header/footer for long content, bottom sheet at 390.
- [ ] SidePanel and Menu/Popover share the same layer stack, so a dropdown
      inside a side panel and a confirm inside a dialog order correctly (B16),
      via a documented layer-constant module (`theme.css` untouched).
- [ ] Untruncated census of every `role="dialog|alertdialog"` file, each one
      listed with its outcome; the modal dialogs that skip the focus helper
      migrated onto `Dialog` where safe; the rest listed as follow-ups.
- [ ] Open/close motion: opacity + small transform only, interruptible, none
      under `prefers-reduced-motion`; values in one local module for LAI-1208.
- [ ] Playwright: focus trap/restore, Escape topmost only, dropdown-in-panel
      stacking, backdrop policy, 390 sheet, reduced motion, CSP violations 0;
      each key behaviour mutated once and seen red.
- [ ] Both themes, 390/768/1440; screenshots in `.polly/screenshots/overlays/`.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards)
      each exit 0; PR into `integration-ui-transformation` with CI green.

## Notes

- Do not change `TaskDrawer` / `TaskDetailPanel`'s drawer (open PR #289);
  keep diffs small against #288 (InlineConfirm), #291 (glass — add no glass
  CSS), #322 (space ⋯ menu), #317 (palette).
- Radix Dialog is out (its scroll lock injects `<style>`, blocked by the CSP).
  No new dependencies.
- Design skills applied as advice, repo rules winning: `impeccable` (polish
  pass), `emil-design-eng`, `review-animations` / `animate` (open/close
  motion), `apple-design` (layering, depth, sheets). Not used: oil-ui,
  stageshow, taste-skill.

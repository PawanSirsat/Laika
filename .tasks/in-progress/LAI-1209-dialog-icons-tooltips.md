---
id: LAI-1209
title: 'Dialogs with icons, tooltips and reasons, starting with Create task'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205]
status: in-progress
started: 2026-11-12T09:00:00Z
---

## Goal

The owner, with a screenshot of the Create task dialog: *"Need to improve these
dialog boxes, so that wherever required we can add icons and tooltips for
them."* Every icon-only control in a dialog gets a name and the shared Tooltip
(with its shortcut where one exists), field labels get small decorative leading
icons where they aid scanning, secondary explanations move behind an info hint,
and a disabled primary action says why.

Scope is `server/web/` only, UI only, existing API, no new dependency, no
`theme.css` change. Builds on the unmerged #318 (LAI-1193 Tooltip, Tabs), #331
(LAI-1204 Button/IconButton, Field, Icon) and #332 (LAI-1205 Dialog, layer
stack) and merges after them. Dispatched by polly on
`integration-ui-transformation`.

## Acceptance criteria

- [ ] Create task: every icon-only control (close, the editor toolbar, the
      Markdown toggle, row removers) has an accessible name and the shared
      Tooltip with its name and shortcut where one exists; the toolbar is
      grouped and overflows rarely used items into a menu at narrow widths.
- [ ] Create task: small consistent decorative (`aria-hidden`) leading icons on
      Status, Priority, Assignee, Agent, Sprint and Due date; values keep their
      own markers.
- [ ] Create task: essential guidance stays visible; secondary explanations
      (Agent vs Assignee, Create another) sit behind an info hint linked by
      `aria-describedby`, never the only copy of critical information.
- [ ] Create task: disabled Create says why (Button disabled-with-reason); the
      header shows the space with its chip and a tooltipped close button.
- [ ] Untruncated census of the other dialogs; names, tooltips, info hints,
      disabled reasons and consistent close buttons added where they help,
      without restructuring; dialogs owned by open PRs listed and skipped.
- [ ] Tooltips: hover after a delay and keyboard focus; Escape closes the
      tooltip before the dialog (layer stack); never cover the field being
      typed in; touch (tap on an info hint, long-press on an icon button);
      both themes; reduced motion.
- [ ] Guard test: icon-only buttons inside dialogs have accessible names.
- [ ] Playwright: names and tooltips on hover and focus, Escape order,
      disabled reason, info hints described-by, 390 toolbar overflow, CSP
      violations 0; each key behaviour mutated once and seen red.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; screenshots dark/light at
      1440/390 in `.polly/screenshots/dialog-tooltips/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
fonts or CDNs, theme tokens only, no new dependency, in-house icons through the
Icon registry): `impeccable` (critique, then polish), `emil-design-eng`
(tooltip delay and instant-after-first behaviour, hit areas), `break-ui`
(long space names, long titles).

Skipped because open PRs own them: #288 (toast's InlineConfirm), #289 (task
drawer), #322 (space header ⋯), #317 (palette).

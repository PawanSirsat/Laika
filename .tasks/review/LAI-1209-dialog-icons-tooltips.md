---
id: LAI-1209
title: 'Dialogs with icons, tooltips and reasons, starting with Create task'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205]
status: review
started: 2026-11-12T09:00:00Z
finished: 2026-11-12T15:30:00Z
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

- [x] Create task: every icon-only control (close, the editor toolbar, the
      Markdown toggle, row removers) has an accessible name and the shared
      Tooltip with its name and shortcut where one exists; the toolbar is
      grouped and overflows rarely used items into a menu at narrow widths.
- [x] Create task: small consistent decorative (`aria-hidden`) leading icons on
      Status, Priority, Assignee, Agent, Sprint and Due date; values keep their
      own markers.
- [x] Create task: essential guidance stays visible; secondary explanations
      (Agent vs Assignee, Create another) sit behind an info hint linked by
      `aria-describedby`, never the only copy of critical information.
- [x] Create task: disabled Create says why (Button disabled-with-reason); the
      header shows the space with its chip and a tooltipped close button.
- [x] Untruncated census of the other dialogs; names, tooltips, info hints,
      disabled reasons and consistent close buttons added where they help,
      without restructuring; dialogs owned by open PRs listed and skipped.
- [x] Tooltips: hover after a delay and keyboard focus; Escape closes the
      tooltip before the dialog (layer stack); never cover the field being
      typed in; touch (tap on an info hint, long-press on an icon button);
      both themes; reduced motion.
- [x] Guard test: icon-only buttons inside dialogs have accessible names.
- [x] Playwright: names and tooltips on hover and focus, Escape order,
      disabled reason, info hints described-by, 390 toolbar overflow, CSP
      violations 0; each key behaviour mutated once and seen red.
- [x] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
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

## Delivered (SHELL, 2026-11-12)

**Primitives** (built on #318, #331, #332, not duplicated):

- `components/tooltip/Tooltip.tsx` — `shortcut` (keycap + `aria-keyshortcuts`,
  `⌘B` on a Mac, `Ctrl+B` elsewhere, `shortcut.ts`), `tone="hint"`, `toggle`;
  Escape spent on `window` capture so the dialog under it never sees it —
  unless focus is in a text field, whose Escape it is; a
  key typed into a field hides it; placement avoids the focused field
  (`tooltip-place.ts`); 500ms long press on touch, the click after it
  swallowed. New `tooltip` layer (95) in `overlay-tokens.ts`/`overlay.css`:
  the old z-index 70 drew every tooltip **under** a Dialog (80).
- `components/tooltip/InfoHint.tsx` — the (i): a real button, described-by its
  text, hover/focus shows, tap/click pins, 44px under a finger.
- `IconButton` shows its label as a tooltip by default (`tooltip`,
  `shortcut`); `Button` and `IconButton` keep an `aria-describedby` handed to
  them (they overwrote it, so a Tooltip around either was silently unlinked).
- `Field` and `AgentPicker` take a decorative `icon` and an info `hint`.
- Icon registry: `info`, `more`, `status`, `flag`, `person`, `agent`,
  `sprint`, `calendar`.

**Create task**: close is a tooltipped IconButton (`Close · Esc`); header
shows the space's colour mark, name (cut, never wrapped) and key chip;
Status/Priority/Assignee/Agent/Sprint/Due date carry `aria-hidden` label
marks; Assignee, Agent and Create another have info hints — the Agent line
under the picker stays on screen; Create off says *Add a title to create*
(disabled-with-reason, focusable) and its tooltip shows `⌘↵`; the row
removers are tooltipped. The editor toolbar is one tool list feeding the bar
and a *More formatting* menu (WAI-ARIA menu button), grouped in tiers by
container query on the toolbar's own width — one row at 1440 and 390; every
tool tooltipped with tiptap's real shortcut; *Markdown* is now *Markdown
source*.

**Census** — every `.tsx` that draws a dialog, by
`grep -rlE 'role="(dialog|alertdialog)"|<Dialog\b|…' src` (32 files,
untruncated; the guard test re-runs it, so a new dialog is covered):

| Outcome | Files |
| --- | --- |
| Migrated: names, tooltips, reasons | CreateTaskDialog (+ Fields), overlay/Dialog (so NewColumn, DeleteColumn, HiddenColumns), OffboardingDialog, ConfirmDialog (typed reason), InviteDialog, ReviewDialog (close; Prev `K`, Next `J`, Send back `S`, Accept `A` — keys that worked but were never shown), SendBackDialog, MyDayDialog, NewColumnDialog, DeleteColumnDialog, RichEditor |
| Reason linked only | HandoffOfferDialog (Approve → its on-screen reason) |
| Nothing to add | HandoffDialog, AddToProjectDialog (no icon-only control, no unexplained disabled state) |
| Skipped, open PR owns it | TaskDetailPanel (#289), InlineConfirm (#288), space header ⋯ (#322), palette (#317) |
| Non-modal popovers with a dialog role — name guard only, tooltips a follow-up | CopyButton, SidePanel, SpacesPopover, BoardInsights, BoardToolbar, MembersPopover, ViewSettings, board-motion.ts, CardFilter, MyDayDrawer, ManageSections, AccessTab, DangerTab, MembersTab, SprintsScreen, WhoDidThis |

Every census file passes the name guard today; the stricter tooltip rule is
held on the migrated list.

**Follow-ups, not filed here** (CHIEF's numbering is in flight; listed for
polly to file): tooltips for the non-modal popovers above; `title=` on the
blocker chip `<li>` in CreateTaskFields; the editor's own `ICON` paths could
move into the registry.

**Tests**: `test/browser/dialog-tooltips.test.ts` (12 + 2 screenshot-only),
`test/components/dialog-icon-names.test.ts` (guard, 47 cases over the
census), `test/components/tooltip/shortcut.test.ts`, four new cases in
`tooltip-place.test.ts`. Fourteen mutations, all red (see the log).

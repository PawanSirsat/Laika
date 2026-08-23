---
id: LAI-203
title: pnpm format is red repo-wide on the imported docs/design files
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-008
status: done
---

## Goal

`pnpm format` fails on `master`. Not on anyone's source — on the design
prototype imported in `docs/design/`:

- `docs/design/support.js` — reformats (it is Claude Design's generated
  `dc-runtime`, explicitly marked "do not edit" in `docs/design/README.md`)
- `docs/design/Laika Prototype.dc.html` — **SyntaxError**, Prettier cannot parse
  it: `Unexpected closing tag "sc-if"` at 803:362
- `Laika - All Screens.dc.html`, `Laika 08-10 - Meeting, Tokens, Org.dc.html` —
  same SyntaxError
- `Laika 01 - Kanban Board.dc.html`, `Laika 02-04 - Task, Capacity,
  Dashboard.dc.html` — reformat

`.dc.html` is a foreign template dialect, not HTML: `<sc-if>` is a
self-terminating custom tag that Prettier's HTML parser is right to reject.
Reformatting these files is not wanted anyway — they are a visual reference that
must stay byte-identical to what the design tool exported, and `support.js` is
third-party.

This matters because CLAUDE.md §5 makes `pnpm format` a gate before moving a
task to review. A gate that is permanently red is a gate everyone learns to
ignore, and the next real formatting regression will sail through — which is
exactly what LAI-014 was filed to prevent for `plugin/`.

## Acceptance criteria

- [ ] `pnpm format` passes on a clean checkout of `master`.
- [ ] `docs/design/**` is excluded from Prettier rather than reformatted — the
      files must stay exactly as exported. A `.prettierignore` is the obvious
      mechanism; the root `format` glob is the alternative.
- [ ] The exclusion is scoped to `docs/design/`, not to `docs/` or `**/*.html` —
      a future hand-written HTML file in the repo should still be checked.
- [ ] A one-line comment says why, so nobody "fixes" the ignore later.

## Notes / context

Discovered while running the pre-review gate for LAI-008. Verified pre-existing:
`docs/design/support.js` fails the check on `master` independently of any
builder branch, so this is not a regression from `docker/` or `plugin/`.

**Adjacent but not the same as LAI-026** (`pnpm format:fix` silently edits other
sessions' areas). That one is about the `--write` half crossing ownership
boundaries; this one is about the `--check` half being red for everyone
regardless of what they touched. They reinforce each other: LAI-026 concludes
"the check itself is fine and PM was right to keep it repo-wide", which is only
true if the check can actually pass. Fixing either alone leaves the gate broken.

`.prettierignore` and the root `package.json` `format` script are both repo-root
config, which is neither Builder-B's nor part of `docs/` proper — PM will likely
need to route the actual edit to whoever owns root config, the way LAI-001 did.

No new dependencies.

---

## Closed as duplicate — PM, 2026-08-24T04:32:00+05:30

**Superseded by LAI-026.** Filed by Builder-B. No work required.

Already fixed, and by then already fixed twice over — Builder-A filed the same
finding as LAI-100 at 04:00, and the actual fix shipped inside LAI-026.

Three sessions independently reported one broken gate within half an hour. That
is the system working: the gate really was red, all three of you were right, and
none of you could see the others' unmerged backlogs.

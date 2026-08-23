---
id: LAI-100
title: '`pnpm format` fails hard on the imported prototype under docs/design/'
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-026
status: done
---

## Superseded by LAI-026 — builder-a, 2026-08-24

**Do not work this task.** I filed it, and minutes later PM folded the same work
into LAI-026 as three extra acceptance criteria plus a `.prettierignore` scope
grant. It is done there: `docs/design/` is excluded, `pnpm format` is green, and
the mockups are byte-identical to `master`.

We crossed in flight — I filed at 04:01, PM's amendment merged at 04:02. Left in
place rather than deleted so the `discovered-from: LAI-026` trail survives; PM
should close it unworked.

Retained below as filed, for the record.

---

## Goal

`pnpm format` now exits **2** for everyone, on every branch, because
`docs/design/support.js` is not parseable JavaScript — it contains template markup
(`<sc-if value="{{ p.hasDiff }}">` at line 806) inside a `.js` file. That is a
parse **error**, not a formatting warning, so the repo-wide check is permanently
red and stops being a signal anybody reads.

## Acceptance criteria

- [ ] `pnpm format` exits 0 on a clean tree, with no findings under `docs/design/`.
- [ ] The prototype files still render — this must not be fixed by deleting the
      reference PM imported for the UI work.
- [ ] Whatever the fix is (ignore entry, rename off `.js`, or move the prototype
      out of the formatter's reach), it survives importing a *second* prototype
      without another task.

## Notes / context

Discovered while finishing LAI-026, which touches the formatter but not this.

`docs/design/` was added in `8180ac0` (`docs(design): import Laika prototype as
visual reference`) and is PM's area, so Builder-A neither fixed it nor formatted
around it.

Two findings, different severities, do not conflate them:

- `docs/design/support.js` — **`[error]`**, a parse failure, exit code 2. This is
  the one that matters.
- `plugin/.claude-plugin/plugin.json` — `[warn]`, ordinary unformatted JSON,
  already tracked by **LAI-014** (Builder-B). Not part of this task.

The cheapest fix is probably a root ignore entry for `docs/design/`, since the
prototype is a vendored reference nobody edits by hand. That is a root-config
change, which has no standing owner — PM grants it per task by name (D-017 /
LAI-026), so whoever takes this needs that grant named in the task first.

No new dependencies.

---

## Closed as duplicate — PM, 2026-08-24T04:32:00+05:30

**Superseded by LAI-026.** Filed by Builder-A. No work required.

Already fixed. `.prettierignore` excludes `docs/design/` and `pnpm format` is
green on a clean tree — verified during the LAI-026 review, in the same commit
range that closed it. You filed this at 04:00 while working LAI-026 itself; the
fix landed inside that task, so the follow-up was never needed.

**Filing it was still right.** At the time you could not know I would fold the
`docs/design/` breakage into LAI-026 rather than schedule it separately. A
duplicate that PM closes costs one review line; a discovery nobody writes down
costs whatever it breaks later.

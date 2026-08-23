---
id: LAI-100
title: '`pnpm format` fails hard on the imported prototype under docs/design/'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-026
status: backlog
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

---
id: LAI-031
title: Stray tool artifacts make `pnpm format` red in a clean checkout
area: server
assignee: builder-a
priority: p3
depends-on: []
discovered-from: LAI-023
status: done
started: 2026-08-24T04:57:57+05:30
finished: 2026-08-24T04:59:32+05:30
reviewed: 2026-08-24T05:15:00+05:30
---

## Goal

`.playwright-mcp/` appeared at the repo root — YAML page snapshots written by the
Playwright MCP server. It is untracked, so it commits nothing, but `pnpm format`
globs `**/*.yml` and reports it, which makes a green gate look red for a reason
that has nothing to do with the code.

The gate is only worth keeping repo-wide (LAI-001 review) if red means something.
This is the second time a non-source directory has broken it; `docs/design/` was
the first (LAI-026).

## Acceptance criteria

- [x] `.gitignore` ignores tool scratch directories, `.playwright-mcp/` included.
- [x] `pnpm format` is green in a checkout where such a directory exists.
- [x] The entry says what it is, so nobody later "cleans up" an unexplained rule.

## Notes / context

Found during the LAI-023 review: `pnpm format` was red on
`.playwright-mcp/page-2026-08-23T23-16-14-371Z.yml`, which no task had touched.

**Needs a root `.gitignore` edit** — outside any builder's area, so whoever takes
this needs PM to name the file first (CLAUDE.md §1). **Granting it here:** this
task authorises editing exactly `.gitignore`, root, nothing else.

Prefer ignoring the specific directory over a broad `.*` pattern — a blanket rule
would also hide `.prettierignore`, `.nvmrc` and friends, which are tracked
deliberately.

No new dependencies.

---

## Notes at review — builder-a

**Reproduced, then fixed, then checked the hazard the task warned about.**

Recreated `.playwright-mcp/page-2026-08-23T23-16-14-371Z.yml` with deliberately
ragged YAML: `pnpm format` went red exactly as reported. With the entry added it
is green, and `git check-ignore -v` confirms line 34 is what does it.

**Ignored by name, not with a blanket rule** — your note called this and it is
worth the two lines of verification. A `.*` pattern would have hidden
`.prettierrc`, `.npmrc`, `.nvmrc`, `.prettierignore` and `.gitignore` itself, all
tracked deliberately. Checked each one after the change: still tracked.

**Three entries, not one.** `.playwright-mcp/` is the observed case;
`playwright-report/` and `test-results/` are Playwright's other default output
directories and would produce the identical failure the first time anyone runs a
test run rather than an MCP session. Same tool, same class, same fix — adding
them now costs nothing and saves a third task. I stopped there rather than
speculating about tools nobody uses.

**The comment says what the rule is for**, per AC3, including *why* it is by name
— so the next person to tidy the file has the argument in front of them instead
of an unexplained pattern.

**Scope:** exactly `.gitignore`, the one file this task's grant names. Nothing
else touched.

**Third time this gate has gone red for a non-source reason** — `docs/design/`
(LAI-026), and now this. The pattern is that anything writing into the working
tree breaks a repo-wide glob. Worth watching: if it happens a fourth time the
answer is probably to invert the `format` glob to an allowlist of source
directories rather than keep adding ignores. Not proposing that now — two data
points and a fix that works is not yet a reason to redesign.

## Review — PM, 2026-08-24

**Accepted.** Verified the way that matters: `pnpm format` is green **with the
seven `.playwright-mcp/` files still on disk**. Testing it after deleting them
would have proved nothing.

Ignoring by name rather than a broad `.*` was the point of the criterion, and the
comment explains why to the next person: `.prettierrc`, `.npmrc`, `.nvmrc` and
`.prettierignore` are all tracked deliberately and a blanket rule would hide
them. It also records *why the gate matters* — "a gate that goes red for reasons
unrelated to the code stops being read" — which is the argument for keeping
`format` repo-wide in the first place.

Adding `playwright-report/` and `test-results/` alongside is scope the task did
not name and I am accepting: same tool, same class, and the alternative is
another round trip the first time someone runs the reporter.

**Root-config grant over `.gitignore` discharged.** Diff touched exactly that
file outside `server/`.

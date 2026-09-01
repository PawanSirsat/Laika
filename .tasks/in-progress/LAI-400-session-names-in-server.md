---
id: LAI-400
title: Rename the old session names in server/ prose
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: D-035
status: backlog
---

## Goal

D-035 renamed the three sessions: PM → **CHIEF**, Builder-A → **CORE**,
Builder-B → **SHELL**. CHIEF renamed everything it owns — `CLAUDE.md`,
`.sessions/`, `.claude/`, `docs/`, the live task files — and deliberately did
not touch `server/`, because a rename is not a licence to edit someone else's
area.

Several files in your area still name a session that no longer exists. They are
comments and docs, not behaviour, so nothing is broken — but a comment that
names "Builder-B" is a comment that will be read wrong by whoever reads it next,
and the point of those comments was to record who owns what.

Known occurrences, from `grep -rn 'Builder-A\|Builder-B\|builder-a\|builder-b'`:

- `server/README.md`
- `server/test/tooling/structure.test.ts` — including the `WEB_*` map comments,
  which are SHELL's under D-026; leave those to LAI-401 and change only the
  sections that describe your own area
- `server/test/tooling/format-fix.test.ts`
- `server/test/tooling/env-contract.test.ts`
- `server/test/tooling/schema-spec-drift.test.ts`

Re-run the grep rather than trusting this list — it was taken on 2026-08-31 and
your branch may have more.

## Acceptance criteria

- [ ] `grep -rn 'Builder-A\|Builder-B\|builder-a\|builder-b' server/` returns
      nothing outside `server/web/`, with the single exception of the `WEB_*`
      sections of `structure.test.ts`, which belong to SHELL (D-026, LAI-401).
- [ ] Every replacement uses the D-035 mapping: PM → CHIEF, Builder-A → CORE,
      Builder-B → SHELL. Branch and directory references become `core` /
      `Laika-core/` and `shell` / `Laika-shell/`.
- [ ] Where a comment explains an ownership boundary, it still explains it —
      this is a rename, not a deletion. A line that said *"`server/web/` is
      Builder-B's"* says *"`server/web/` is SHELL's"*, not nothing.
- [ ] No behaviour changes. No test's assertions change, only prose. If a string
      literal in an assertion contains a session name, say so in your log rather
      than changing it silently.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes

Do **not** touch `.tasks/done/`, `logs/`, or `docs/DECISIONS.md`. Those are the
record and keep the names they were written with — D-035 says so explicitly, by
the same append-only rule that governs decisions.

No new dependencies. This is a text edit.

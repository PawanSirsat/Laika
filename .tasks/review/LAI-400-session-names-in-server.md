---
id: LAI-400
title: Rename the old session names in server/ prose
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: D-035
status: review
started: 2026-09-01T17:05:00Z
finished: 2026-09-01T17:20:00Z
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

- [x] `grep -rn 'Builder-A\|Builder-B\|builder-a\|builder-b' server/` returns
      nothing outside `server/web/`, with the single exception of the `WEB_*`
      sections of `structure.test.ts`, which belong to SHELL (D-026, LAI-401).
- [x] Every replacement uses the D-035 mapping: PM → CHIEF, Builder-A → CORE,
      Builder-B → SHELL. Branch and directory references become `core` /
      `Laika-core/` and `shell` / `Laika-shell/`.
- [x] Where a comment explains an ownership boundary, it still explains it —
      this is a rename, not a deletion. A line that said *"`server/web/` is
      Builder-B's"* says *"`server/web/` is SHELL's"*, not nothing.
- [x] No behaviour changes. No test's assertions change, only prose. If a string
      literal in an assertion contains a session name, say so in your log rather
      than changing it silently.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes

Do **not** touch `.tasks/done/`, `logs/`, or `docs/DECISIONS.md`. Those are the
record and keep the names they were written with — D-035 says so explicitly, by
the same append-only rule that governs decisions.

No new dependencies. This is a text edit.

## Outcome

Eighteen references across eleven files. The grep now returns **exactly the three
`WEB_*` lines** outside `server/web/`, which are SHELL's under D-026 and are
LAI-401's.

### The list was incomplete, which is why the task said to re-run it

The known-occurrences list names Builder-A/B only. **AC2's mapping also carries
PM → CHIEF**, and there were **nine** PM references in my area that the list did
not mention — `src/http/static.ts`, `src/paths.ts`, and six test files. Re-running
the grep for the whole mapping rather than for the listed half is the difference
between finishing the task and finishing the list.

### Two string literals, named here as AC4 requires

Both are `describe()` titles, not assertions:

```
- describe('it answers exactly what the stream would (PM’s note)', …
- describe('third-party artefacts are never formatted (LAI-026, PM addition)', …
```

Changed, because a test title is prose a reader sees and neither is asserted on.
**No assertion string in `server/` contains a session name** — checked by
classifying every match rather than by assuming. Verified after the fact too:

```
git diff -U0 -- 'server/**/*.ts' | grep -E "^[-+]" | grep -vE "^[-+]\s*(\*|//)"
```

returns those two lines and nothing else. Every other changed line in a `.ts`
file is a comment.

### One rename that could not be only a rename

`server/README.md` said:

> Nobody except Builder-A edits anything under this directory.

Renamed straight, that becomes *"Nobody except CORE"* — **which is false**, because
D-016 gave `server/web/` to SHELL, and the README's own layout block lists `web/`
two lines below. AC3 says a comment explaining an ownership boundary must still
explain it; a rename that makes the boundary wrong fails that more thoroughly than
deleting it would.

So it now names the exception and the API-versus-UI rule, in the wording CLAUDE.md
§1 uses. **Flagging it rather than burying it**: it is three sentences where the
task expected one, and if you would rather it were a separate task I will revert
to the literal rename and file it.

### Left alone, deliberately

- `structure.test.ts:59, 61, 78` — the `WEB_NO_MIRROR_PATTERNS` docblock and its
  entry. SHELL's under D-026.
- `web/` entirely, `.tasks/done/`, `logs/`, `DECISIONS.md` — the record.

**One thing for LAI-401 while they are in there.** That exemption's docblock
explains itself in terms of D-028 — *"CORE owns `routes/screens/{sprints,
timeline,dashboard}/` and nothing else under `server/web/`"* — and **D-031
retired D-028**; SHELL owns all of `server/web/` again. So the rename is not the
only thing stale there: the *rationale* is. A rename alone would leave a comment
that reads correctly and describes an arrangement that no longer exists, which is
the failure mode this task exists to prevent, one level up. It is their file and
their call, so it is a note rather than an edit.

### Gate

`@laika/server` **1742/1742** — unchanged, as a prose task should leave it —
`cli` 19/19, `pnpm lint` EXIT=0, `pnpm format` EXIT=0, typecheck clean.
`server/web` red on LAI-208's declared assertion only.

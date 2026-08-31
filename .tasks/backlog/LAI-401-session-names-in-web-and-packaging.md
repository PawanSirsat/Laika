---
id: LAI-401
title: Rename the old session names in web, plugin, cli and docker prose
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: D-035
status: backlog
---

## Goal

D-035 renamed the three sessions: PM → **CHIEF**, Builder-A → **CORE**,
Builder-B → **SHELL**. CHIEF renamed everything it owns and deliberately did not
touch your area, because a rename is not a licence to edit someone else's files.

Several files in your area still name a session that no longer exists. They are
comments and docs, not behaviour — but the whole reason those comments exist is
to record who owns what, and a stale name defeats that.

Known occurrences, from `grep -rn 'Builder-A\|Builder-B\|builder-a\|builder-b'`:

- `server/web/README.md`
- `server/web/src/api/tasks.ts`, `server/web/src/api/sprints.ts`
- `server/web/src/routes/screens/sprints/sprint-derive.ts`
- `server/web/src/routes/screens/dashboard/use-dashboard.ts`
- `server/web/test/csp-compatibility.test.ts`, `test-runner.test.ts`,
  `api/sprints.test.ts`, `api/view-type-drift.test.ts`, `routes/nav-truth.test.ts`
- `plugin/README.md`, `cli/README.md`, `docker/README.md`
- `pnpm-workspace.yaml`
- the **`WEB_*` map sections** of `server/test/tooling/structure.test.ts` — yours
  under D-026, and the one place you may edit inside `server/test/`. **This is
  the named cross-area edit this task authorises (D-033/D-034): the `WEB_*`
  sections of that one file, and nothing else in it.** The rest of the file is
  CORE's and is handled by LAI-400.

Re-run the grep rather than trusting this list — it was taken on 2026-08-31.

## Acceptance criteria

- [ ] `grep -rn 'Builder-A\|Builder-B\|builder-a\|builder-b'` returns nothing in
      `server/web/`, `plugin/`, `cli/`, `docker/`, or `pnpm-workspace.yaml`.
- [ ] The `WEB_*` sections of `server/test/tooling/structure.test.ts` carry the
      new names; no other section of that file is touched by this task.
- [ ] Every replacement uses the D-035 mapping: PM → CHIEF, Builder-A → CORE,
      Builder-B → SHELL. Branch and directory references become `core` /
      `Laika-core/` and `shell` / `Laika-shell/`.
- [ ] Where a comment explains an ownership boundary, it still explains it. A
      line that said *"the rest of `server/` is Builder-A's"* says *"is CORE's"*,
      not nothing.
- [ ] No behaviour changes and no rendered UI string changes — none of these are
      user-facing. If one turns out to be, stop and say so rather than changing
      it.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes

Do **not** touch `.tasks/done/`, `logs/`, or `docs/DECISIONS.md`. Those are the
record and keep the names they were written with.

No new dependencies. This is a text edit.

---
id: LAI-014
title: Bring plugin/ under the repo formatter
area: plugin
assignee: builder-b
priority: p3
depends-on: [LAI-001]
discovered-from: LAI-001
status: review
finished: 2026-08-24T03:21:08+05:30
started: 2026-08-24T03:19:17+05:30
---

## Goal

`pnpm format` now checks every `.ts/.js/.json/.yaml/.css/.html` file in the repo
(LAI-001). One file fails it: `plugin/.claude-plugin/plugin.json`. Builder-A
cannot fix it — `plugin/` is Builder-B's area (CLAUDE.md §1) — so the repo-wide
format check is red through a boundary, not through a bug.

## Acceptance criteria

- [x] `pnpm format` passes with no findings under `plugin/`.
- [x] The fix is `pnpm format:fix` (or an equivalent Prettier run) — no hand
      re-indentation, and no change to the *meaning* of any file.
- [x] Any future JSON/YAML added under `plugin/` is Prettier-clean at commit
      time.

## Notes / context

Discovered while finishing LAI-001. The only current finding is the `keywords`
array in `plugin/.claude-plugin/plugin.json`, which Prettier collapses to one
line under `printWidth: 100`. It is cosmetic — nothing is broken today.

Prettier config lives at `/.prettierrc` and is shared; do not add a second
config under `plugin/`. If a file under `plugin/` genuinely must keep hand
formatting, say which and why, and it gets an ignore entry instead — but that is
a root-config change and therefore a task for whoever owns root config.

No new dependencies.

## Implementation notes for review (Builder-B)

- `pnpm format` was red on exactly one file, as predicted: the `keywords` array
  in `plugin/.claude-plugin/plugin.json`. Now green repo-wide.
- Fixed with `npx prettier --write "plugin/**/*..."`, **not** `pnpm format:fix`.
  `format:fix` rewrites the whole repo including `server/`, which is Builder-A's
  area — a formatting task is not a licence to touch it. Same Prettier, same
  `/.prettierrc`, scoped to my area.
- Meaning unchanged, verified rather than eyeballed: `json.load()` of the file
  before and after compare equal. The diff is whitespace only.
- Plugin still works after the reformat: `claude plugin validate plugin` passes,
  and `/laika:status` runs end to end unconfigured.
- Full gate green: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
  (3 passed).

### On the third criterion — "Prettier-clean at commit time"

Satisfied by config coverage, not by a git hook, and PM should know the
difference. Verified empirically: dropping a deliberately misformatted
`_probe.json` into `plugin/hooks/` and `_probe.yaml` into `plugin/skills/` both
turned `pnpm format` red; removing them turned it green. Nothing under `plugin/`
is gitignored, so `--ignore-path .gitignore` excludes nothing here, dot-
directories included.

There is **no pre-commit hook in this repo** — no husky, no lint-staged, and
adding either is a new dependency plus a root-config change, which this task
forbids twice over. So "at commit time" currently means "whoever commits runs
`pnpm format`", which CLAUDE.md §5 already requires before review. I documented
that in `plugin/README.md` (new "Working on this plugin" section) including the
area-scoped Prettier invocation, so the next Builder-B does not reach for
`format:fix` and rewrite someone else's area.

If PM wants real commit-time enforcement, that is a root-config task with a
named dependency — not something I can file into my own area.

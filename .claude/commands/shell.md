---
description: Boot as SHELL — the UI, plugin, CLI and container — and start the next ready task
---

You are **SHELL**. Formerly Builder-B (D-035).

**Argument:** `$ARGUMENTS` — one of `status`, `claim`, or empty.

## 1. Confirm who and where you are

Read `.sessions/shell.md` and `CLAUDE.md` (all of §1, §2, §4, §5, and §5.1 —
the UI rules).

You must be in `Laika-shell/` on branch `shell`. Run `git worktree list` and
confirm. **If you are anywhere else, stop and say so** — do not `cd` into
another session's directory, do not check out another session's branch.

You own **`server/web/`** (the whole SPA, D-031), **`plugin/`**, **`cli/`**,
**`docker/`**, plus `logs/shell-*.md`, `.sessions/shell.md`, the `WEB_*` maps in
`server/test/tooling/structure.test.ts` (D-026), and the one task file you hold.
The rest of `server/` is CORE's. `server/public/` is build output, gitignored,
nobody's.

Two `.claude`-shaped things, do not confuse them: `plugin/` is the **shipped**
plugin and is yours; `.claude/` at repo root configures the three sessions
building Laika and is CHIEF's.

## 2. Take the latest integrated state

```bash
git merge master
```

Resolve `.tasks/` conflicts in CHIEF's favour (§4.2). If `master` sent a task
back — you have a copy in both `.tasks/review/` and `.tasks/in-progress/` —
`git rm` the `review/` copy, keep `in-progress/`, read the appended notes.

## 3. Report

Say, in a few lines: current branch, whatever you already hold in
`.tasks/in-progress/`, anything of yours sitting in `.tasks/review/`, and the
ready web/plugin/cli/docker tasks with their ids and one-line goals.

**If `$ARGUMENTS` is `status`, stop here.**

## 4. Claim — the move is the lock

If you already hold a task, continue it; skip to step 5.

Otherwise pick **one** file from `.tasks/backlog/` where `area` is `web`,
`plugin`, `cli` or `docker`, `assignee` is `unclaimed` or `shell`, and every
`depends-on` id is in `.tasks/done/` **on `master`**. Prefer the lowest priority
number, then the lowest id.

**A UI task carries `depends-on` for the API tasks that define its endpoints
(§5.1).** Check what each dependency actually *delivers*, not that it closed —
LAI-086 depended on LAI-059, which built *project* members when the screen
needed *org* members. If a screen needs data no endpoint returns, leave it in
the backlog. Do not stub the data and do not add the endpoint yourself.

Then, before writing any code:

```bash
git log --all --oneline -- '.tasks/in-progress/LAI-00X*' \
                           '.tasks/review/LAI-00X*' '.tasks/done/LAI-00X*'
```

Any output at all means someone already has it — **pick a different task**.
Never force it, never move a file out of another session's hands.

```bash
git mv .tasks/backlog/LAI-00X-*.md .tasks/in-progress/
# set assignee: shell, status: in-progress, started: <ISO-8601>
git commit -m "chore(tasks): claim LAI-00X [LAI-00X]"
```

That commit **is** the claim. No push needed — all three worktrees share one
object database.

**If `$ARGUMENTS` is `claim`, stop here.**

## 5. Build it

Read `docs/SPEC.md` for every section the task names — §11.4.2 for the screen →
endpoint map, §11.4.2.1 for what each screen must contain — then work in small
commits (`feat(web): … [LAI-00X]`). Non-negotiable in your area:

- **Functional React wired to the real API. Never hardcode mockup data.** Every
  number, name and count comes from an API response. A hardcoded value is a
  defect even when it looks right.
- **Demo data lives in `src/demo/` and cannot ship (D-032).** One file per
  missing endpoint, each naming the endpoint that retires it, each fed screen
  saying so on screen, and a test asserting no demo string survives into the
  built bundle. A demo module beside a real endpoint is a defect.
- **Match `docs/design/` for style, never for markup.** Tokens verbatim from
  `docs/design/README.md`. Do not copy the prototype's inline-styled HTML.
- **Both themes, every time.** A component that only works in light is not done.
- No `SYSTEM` sidebar group. Self-host the fonts. `LAI-` is the key prefix —
  rename any `LK-`/`SKY-`/`TBT-` on sight.
- Docker: one image, one process, one volume at `/data`, non-root, no database
  baked in, no secrets committed.
- The plugin must load cleanly when unconfigured.
- No new dependency unless the task file names the package.
- A guard that cannot fail is not a guard. Break the thing your test protects
  and confirm it goes red before you trust it.

**Render it in a browser before you call it done.** Drive the real theme
control, not `classList.toggle()`. If a probe says something is missing, first
prove it can see something present.

If you discover work outside the task, **do not do it** — write a task file in
`.tasks/backlog/` with `discovered-from:` and an id from **your** range
(`LAI-200`–`LAI-299`), checked across all branches. Check it is not already
filed first; if unsure, file it anyway.

If you need a change outside your area, do not make it. File the task, and if it
blocks you add it to `depends-on`, move yours back to `.tasks/backlog/`, and say
so in your log.

## 6. Finish

`pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`, `pnpm test` —
all green. Tick every criterion `- [x]`, set `status: review` and `finished:`,
`git mv` to `.tasks/review/`, commit. **Never move it to `done/` — that is
CHIEF's alone.**

Then append to `logs/shell-<YYYY-MM-DD>.md` per
`.claude/skills/laika-logging/SKILL.md`: timestamp, task id, the actual file
paths, decisions and why, and anything you discovered.

Then run `/shell` again.

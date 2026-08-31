---
id: LAI-418
title: Plugin hooks — heartbeat on session start, stop, and a timer
area: plugin
assignee: unclaimed
priority: p1
depends-on: [LAI-417]
discovered-from:
status: backlog
---

## Goal

`plugin/hooks/hooks.json` is `{}` today, with a comment saying *"empty by design
until M4"*. This is M4.

Three hooks (SPEC §8): **`SessionStart`**, **`Stop`**, and a **throttled
`PostToolUse`** firing at most every 5 minutes while a session is active. Each
posts `{ repo, branch }` to `$LAIKA_URL/api/v1/heartbeats` with
`Authorization: Bearer $LAIKA_TOKEN`.

## Acceptance criteria

- [ ] All three hooks are registered and fire. The `PostToolUse` one is
      **throttled to at most once per 5 minutes** — a hook on every tool call
      would post hundreds of times an hour.
- [ ] **`|| true` on every hook, and it is not decoration.** SPEC §8: *"A board
      that is down, slow, or unreachable must never break a coding session."*
      **Prove it**: point `LAIKA_URL` at a dead port and confirm a session starts,
      runs and stops normally. Put the result in your log — this is the criterion
      most likely to be assumed rather than tested.
- [ ] **Unconfigured is silent, not broken.** With `LAIKA_URL` or `LAIKA_TOKEN`
      absent the hooks do nothing and say nothing. The plugin must load cleanly
      when unconfigured (§8); a hook that logs a warning on every session start
      of every repo that does not use Laika is a defect.
- [ ] `repo` is the **git remote basename**, `branch` the current branch. Both
      resolved without failing when there is no remote, no branch, or no git repo
      at all — degrade to skipping the post, never to an error.
- [ ] A short timeout on the request. A board that hangs must not hang the hook.
- [ ] **No secret is committed.** `LAIKA_URL` and `LAIKA_TOKEN` come from the
      environment; anything committed carries an obviously-placeholder value.
- [ ] `plugin/hooks/README.md` no longer says "empty by design until M4".
- [ ] Full gate green.

## Notes

No new dependencies. Shell and `curl`, as §8's snippet shows.

**Verify against a real board**, not only a dead one: post a heartbeat from a
real session and confirm the row exists. That is half of M4's exit criterion.

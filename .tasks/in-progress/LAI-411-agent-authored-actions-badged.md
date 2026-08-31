---
id: LAI-411
title: Badge agent-authored actions in the UI
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T07:35:23Z
---

## Goal

SPEC §7 says an agent's work is badged so a human can tell it apart: "same
`activity` row (with `actor_kind: agent`, **which is how the UI badges it**)".
Nothing in the UI does.

This is buildable **now**, before any MCP tool exists — `ActivityView` already
carries `actor_kind: 'user' | 'agent' | 'system'`
(`server/web/src/api/activity.ts:24`). Seed a row and render against it.

## Acceptance criteria

- [ ] Wherever activity is rendered — the feed, the task detail, the dashboard —
      an `actor_kind: 'agent'` row is visually distinguishable from a `'user'`
      row, and `'system'` from both.
- [ ] The badge is built from **design tokens in `docs/design/README.md`**,
      verbatim. Do not introduce a new colour. If no existing token fits, stop
      and file a task for the owner — you may not decide a token, and neither
      may CHIEF (D-020).
- [ ] The distinction survives in **both themes** and is not carried by colour
      alone — a shape, an icon or a label as well, so it is legible to someone
      who cannot separate the two hues.
- [ ] The badge says **which** agent where the data allows it. `actor_id` is the
      person the token belongs to; the token is what distinguishes the agent.
      If `ActivityView` does not carry enough to name it, **do not guess and do
      not invent a label** — render the honest "agent" and file a task against
      `server` for the field. LAI-093 (backlog) is the closely related one; check
      it before filing a duplicate.
- [ ] `CommentView` carries no `actor_kind` — `server/web/src/api/comments.ts:48`
      records this and LAI-056 AC4 names it. **Comments are out of scope here**;
      say so on the task rather than half-solving it.
- [ ] Rendered in a real browser, both themes, against seeded agent rows.
- [ ] Full gate green.

## Notes

No new dependencies. No demo module — the endpoint exists, and a demo module
beside a real endpoint is a defect (D-032).

Verify against a seeded row before you conclude anything is missing. If a probe
says a field is absent, first prove it can see a field that is present.

---

## Review note — CHIEF, 2026-08-31

**Not a send-back. The task is still yours, still in-progress. No criterion is
added, and none is struck — they were right. Only the Goal's premise was wrong.**

### The Goal is stale; AC1 was already correct

The Goal says *"Nothing in the UI does"*. Measured against seeded rows of each
kind on a running instance, that is false for `agent`:

| site | agent | system |
| --- | --- | --- |
| board rail | ✓ violet corner dot + visually-hidden "(agent)" | ✗ nothing |
| task detail | ✓ `marker-agent`, the word "agent" | ✗ nothing |
| dashboard | ✓ violet chip | ✓ grey chip |

LAI-085 and the rail work already did most of the agent half. **The real gap is
`system`** — and AC1 already names it: *"an `actor_kind: 'agent'` row is visually
distinguishable from a `'user'` row, **and `'system'` from both**."*

So the work has changed shape without the requirement changing. Build against
AC1; ignore the Goal's first paragraph, which was written from an assumption
rather than a measurement. **That assumption was mine.**

### Two things the measurement found that AC1 covers

1. **A system row in the task detail renders as *"someone edited this task"*** —
   lowercase, no badge. A cron action attributed to "someone" reads as an
   unidentified *human*, which is worse than an unlabelled row: it is a wrong
   label rather than a missing one. Squarely AC1.
2. **The rail and the task detail disagree** — "Laika" at one site, "someone" at
   the other, for the same row. Fixing `system` at both sites resolves it; if it
   does not, say so rather than leaving two answers standing.

### Your three judgement calls, all confirmed

- **`--pur` for agent, `--tx3` for system** — both already assigned in
  `docs/design/README.md`. No token decided, so D-020 is not in play. Correct.
- **Not filing for the agent's name** — `ActivityView` carries `actor_token_id`
  but no token *name*, and LAI-093 already covers naming which agent. Rendering
  the honest "agent" and **not** filing a duplicate is exactly what AC4 asks.
- **Shape as well as colour in the rail** — a grey dot beside a violet dot is a
  hue difference and nothing else, so it fails AC3 even though the task detail's
  word-markers pass it. Catching that the two sites need different treatment for
  the same criterion is the right reading.

### Verifying against a token-authenticated write

Welcome, and better than asked — AC6 says *"seeded agent rows"*, so this is above
the bar, not required by it. LAI-403 made it possible: every activity row now
carries real `actor_kind` and `token_id` from one helper. **A seeded row proves
your rendering; a real one proves the pipeline.** If the two disagree, that is a
finding worth more than the task.

### On "check that your check ran"

Your post-hoc proof is sound: an unlanded mutation leaves the code unmutated,
which shows green, so a non-zero failure count means the mutation landed. **One
caveat worth carrying** — that holds only because your baseline was green. With a
pre-existing failure, a non-zero count proves nothing. Re-running the anchors and
confirming each matches exactly once is the check that does not depend on the
baseline.

---
id: LAI-411
title: Badge agent-authored actions in the UI
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-08-31T07:35:23Z
finished: 2026-08-31T15:10:00Z
---

## Goal

SPEC §7 says an agent's work is badged so a human can tell it apart: "same
`activity` row (with `actor_kind: agent`, **which is how the UI badges it**)".
Nothing in the UI does.

This is buildable **now**, before any MCP tool exists — `ActivityView` already
carries `actor_kind: 'user' | 'agent' | 'system'`
(`server/web/src/api/activity.ts:24`). Seed a row and render against it.

## Acceptance criteria

- [x] Wherever activity is rendered — the feed, the task detail, the dashboard —
      an `actor_kind: 'agent'` row is visually distinguishable from a `'user'`
      row, and `'system'` from both.
- [x] The badge is built from **design tokens in `docs/design/README.md`**,
      verbatim. Do not introduce a new colour. If no existing token fits, stop
      and file a task for the owner — you may not decide a token, and neither
      may CHIEF (D-020).
- [x] The distinction survives in **both themes** and is not carried by colour
      alone — a shape, an icon or a label as well, so it is legible to someone
      who cannot separate the two hues.
- [x] The badge says **which** agent where the data allows it. `actor_id` is the
      person the token belongs to; the token is what distinguishes the agent.
      If `ActivityView` does not carry enough to name it, **do not guess and do
      not invent a label** — render the honest "agent" and file a task against
      `server` for the field. LAI-093 (backlog) is the closely related one; check
      it before filing a duplicate.
- [x] `CommentView` carries no `actor_kind` — `server/web/src/api/comments.ts:48`
      records this and LAI-056 AC4 names it. **Comments are out of scope here**;
      say so on the task rather than half-solving it.
- [x] Rendered in a real browser, both themes, against seeded agent rows.
- [x] Full gate green.

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

---

## Build note — SHELL, 2026-08-31

### What was actually missing

Agent badging largely existed. **`system` did not**, and in the task detail it was
not merely unbadged — `personName(null)` returned **"someone"**, so a cron action
read as an unidentified human. The rail called the same row "Laika". Two sites,
one row, two answers, one wrong.

The schema settles it: `activity_system_actor_check` is
`(actor_id IS NULL) = (actor_kind = 'system')`, so a null actor on an activity
row *cannot* be a person. `personName` stays as it is for `created_by` and
`comment.author_id`, where a null really is a departed user — which is why this
is a new function rather than an edit to that one.

### One place decides it now

`routes/screens/board/actor-presentation.ts` — `describeActor(event, members)`
returns the name and the badge. The rail and the task detail both call it, so
they cannot drift apart again. The dashboard was already correct and was left
alone rather than churned.

### AC3 needed different treatment at two sites

The task detail and dashboard render the badge as a **word** (`agent`, `system`),
so colour is reinforcement and nothing depends on it. The rail cannot — a row is
8.5px — so there the marker is a **shape**: an agent is a rounded square
(`--radius-sm`), the system is a circle (`--radius-pill`). Two dots differing
only in hue would have failed this criterion while looking like it passed.
Measured: `border-radius` `4px` vs `999px`, not just `--pur` vs `--tx3`.

### Which agent — not guessed, not filed

`ActivityView` carries `actor_token_id` but no token *name*, so the honest label
is "agent". **LAI-093 already covers naming it**, so nothing was filed. `actor_id`
is deliberately kept as the person the token belongs to — that is who is
accountable (D-007).

### Verified against a real agent, not only a seeded one

A seeded row proves the rendering; it does not prove the pipeline. So a token was
minted and used:

```
PATCH /api/v1/tasks/... with `Authorization: Bearer lai_…`  -> 200
activity row written:  kind=agent  actor=yes  token=yes
```

It renders identically to the seeded rows — `rail-feed-bot-agent`, "(agent)".
The two agree, so LAI-403's writer and this renderer meet correctly.

### Measured, both themes, all three sites

| site | user | agent | system |
| --- | --- | --- | --- |
| rail | no marker | rounded square `--pur` + "(agent)" | circle `--tx3` + "(system)" |
| task detail | no marker | word `agent` | word `system`, named **Laika** |
| dashboard | word `user` | word `agent` | word `system` |

Driven through the real theme control, not `classList`. No new colour values —
`--pur` is assigned to "agent" in `docs/design/README.md:60` and `--tx3` is what
the dashboard already gave the system (D-020 not in play).

### Out of scope, said rather than half-solved

- **Comments carry no `actor_kind`** (`api/comments.ts:48`, LAI-056 AC4). An
  agent-authored comment cannot be badged from the client. Not touched.
- **LAI-225 filed** — `describeEvent` has no case for `project.created` /
  `project.updated`, so the rail prints the raw enum name. A vocabulary gap, not
  a badging one.

### One behaviour change worth a reviewer's eye

An actor whose id is not in the members map used to render as the **raw ULID** in
the task detail. It now renders "Someone". A ULID is not a name and the panel is
read by people — but it is a change beyond badging, made because unifying the two
sites forced a single answer. Say if you would rather keep the id.

### Four mutations, four reds

System renamed "someone" (1 fail), system unbadged (2), agent unbadged (3),
unresolved id leaked (1). Each anchor asserted to match exactly once **before**
mutating, and the baseline confirmed green first — a non-zero failure count only
proves a mutation landed if the baseline was zero.

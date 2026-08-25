---
id: LAI-066
title: Task card anatomy — priority, key, sprint, dependencies, assignee
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-049, LAI-050, LAI-060, LAI-079]
discovered-from:
status: done
started: 2026-08-25T03:51:56Z
finished: 2026-08-25T06:09:24Z
reviewed: 2026-08-26T10:00:00+05:30
---

## Goal

Bring `TaskCard` up to the prototype's card. **Scoped deliberately to what the
API returns** — I checked `TaskView` field by field before writing this.

## Acceptance criteria

- [x] **Priority dot** from `priority`, using `--red` / `--amb` / `--tx3`.
- [x] **Task key** in mono (`LAI-158`), from `key`.
- [x] **Sprint chip** when `sprint_id` is set — resolve the name via the sprints
      endpoint (LAI-050); never render the raw id.
- [x] **Dependency count** from `dependencies.length`.
- [x] **Assignee avatar** from `assignee_id`, resolved through
      `GET /api/v1/users` (LAI-060), coloured by `theme/avatar-color.ts`.
- [x] **Blocked treatment** when `ready` is false and dependencies are unmet —
      the prototype shows *"blocked by LAI-140 event store"*. Name the blocker;
      a bare "blocked" badge makes someone go hunting.
- [x] Both themes.

## Explicitly NOT in this task

- ~~**Tag chips**~~ — **now in scope.** The owner decided tags are real
  (**D-027**, 2026-08-25) and **LAI-079** builds them, which is why this task now
  depends on it. Render the chips from `TaskView.tags`:
  neutral `--tub` ground, `--bd` border, `--tx2` text — **no per-tag colour**,
  which D-027 settled deliberately. A task may carry several; the design shows
  two on one card.
- **Comment count** (`💬 5`). Not on `TaskView`. Filed as **LAI-072**.

## Notes / context

Both exclusions are the §5.1 rule: a screen that needs data no endpoint returns
waits, it does not stub. The card is worth building now regardless — six of the
eight elements are backed by real fields today.

---

## What was already there, and what this task actually changed

Most of the card was built during the board sweep. Checking each element against
the wire first — `key`, `priority`, `sprint_id`, `dependencies`, `ready`,
`assignee_id`, `tags` are all served — left three things genuinely outstanding.

### 1. Tags were demo data sitting next to a real endpoint

`TaskCard` read `demoTags(task.id)`. LAI-079 landed the tags table **in the merge
that unblocked this task**, so `TaskView` now carries `tags: string[]` — and
D-032 is explicit that *a demo module beside a real endpoint is a defect*.

`demo/tags.ts` is deleted. The card reads `task.tags`.

The demo also **invented tones** — `agent` purple, `presence` blue, `auth`
green — and D-027 refused a per-tag palette on purpose. Those CSS rules went with
it. One neutral chip: `--tub` ground, `--bd` border, `--tx2` text, measured in
both themes.

### 2. The blocked banner did not name anything

It said *"blocked by a dependency"* — which tells someone they are stuck and then
makes them go hunting for what by, the cost of being blocked paid twice. Added
`blockers()` beside `blockedState()`: the existing function answers **whether**,
the new one answers **which**, and a test asserts the two never disagree — a
banner that says blocked while naming nobody is the vague message this replaces.

### 3. Two layout defects the naming exposed

Both found by looking at the rendered board, not the diff:

- A title is arbitrarily long, and the banner stacked into three lines and spilled
  out of a 167px column. It is now two deliberate lines: `blocked by LC-1` then
  the title. **Measured before deciding** — sharing one line left the title
  **17px**, one character and an ellipsis, which tells the reader nothing the key
  had not already.
- `LC-4` was breaking after the hyphen, rendering `LC-` above `4` — two things
  that match no task. `.card-key` no longer wraps.

## Verified on a running instance

Set real tags on `LC-4` and a real dependency `LC-1 → LC-4`, then read the DOM:

| | |
| --- | --- |
| tags | `agent` `core`, chip on `--tub` / `--bd` / `--tx2` in **both** themes |
| blocked | `blocked by LC-1 / SSE reconnect`, full title shown, key intact |
| priority dot | `--amb` for a p2, both themes |
| keys | no wrapping at 167px |

## Filed while working

**LAI-223** — `comment_count` is served on every task and **nothing renders it**.
LAI-072 added the field (`area: server`) and this task excludes the count because
it did not exist when this was written. Both closed correctly; the result is a
field nobody shows. The general shape is worth more than the instance: *an
exclusion justified by "the data does not exist" expires the moment the data
exists, and nothing watches for that.*

## A guard of mine had a hole, found by mutating it

The D-027 check was `!/card-tag-\w/`. Reintroducing a tone class as
`` card-tag-${tag} `` — a template literal, precisely how anyone would actually
do it — **slipped straight through**, because `$` is not a word character. Only
the mutation run caught it; reading the guard did not. Widened to `[\w$]` and
re-mutated to confirm it now fails.

## Review — PM, 2026-08-26

**Accepted. The board matches the prototype.** Seeded tags, a dependency, a
sprint and an assignee, and every element rendered from real data:

```
LAI-1  SSE reconnect …   [agent] [core]  ● p1  S1  RK
LAI-2  Docker compose …  [infra]         ● p2  ready
LAI-3  Blocked on …      [ui]            🔒 blocked by LAI-2 Docker compose on…  🔗 1
```

**The blocked card names its blocker**, which was the criterion I cared about —
*"a bare 'blocked' badge makes someone go hunting"*. It says which task and what
that task is called, so the reader can act without leaving the board.

Tag chips are neutral `--tub`/`--bd` with no per-tag colour, as D-027 settled,
and a task carrying two renders both — the case the design showed and the reason
tags are a join table rather than a column.

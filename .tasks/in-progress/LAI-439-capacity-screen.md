---
id: LAI-439
title: The Capacity screen — who is on what, and what is stuck with nobody
area: web
assignee: shell
priority: p2
depends-on: [LAI-432]
discovered-from:
started: 2026-09-01T19:00:00+05:30
status: in-progress
---

## Goal

**M5's exit criterion is this screen**: *"the capacity screen answers 'who takes
the next task' without asking."* The server side is complete — LAI-430, LAI-431,
LAI-432 — and `GET /api/v1/capacity` and `GET /api/v1/presence` both exist and
are green.

The route is not in the nav today. §11.4.2 specifies it.

## What it shows (§11.4.2, verbatim)

> **Capacity** — who is active now with repo, branch and resolved task; **agent
> sessions distinct from humans**; in-progress work across projects; last seen;
> **unlisted work with one-click promote to a task**; disabled state when
> `presence_enabled = 0`.

## Four shapes the server already decided — read them before building

**`enabled` is a field, not something you infer.** `{ enabled: false }` and an
empty list are **opposite facts**: *"this org does not record who is working"*
versus *"nobody is working"*. Since LAI-150 a disabled org stores nothing, so an
empty list is the only thing left and inferring is permanently wrong.

**`unlisted` is absent, not empty**, for a reader without `audit_log.export`. An
empty array says *"this person has logged nothing"*, which is a different claim.
Render the section only when the key is present — **never `?? []`**.

**Capacity keeps the person and filters their tasks.** A reader who cannot see a
project gets that person with a shorter list, not a missing person: *the person
is not the secret, and dropping them would make the headcount depend on who is
asking.*

**Presence says where only to a reader who can see it** (LAI-438, §9.3) — **and
the representation differs by field, which the first version of this note got
wrong.** Verified against `services/presence.ts` and a live response:

| field | when the reader cannot see where |
| --- | --- |
| `repo`, `branch` | **absent** — the key is not there |
| `matched_task_id` | **present and `null`** |
| `project_ids` | **present and `[]`** |

**So "somebody is working, elsewhere" is `repo === undefined`.** Testing
`matched_task_id === undefined` **would never fire**, and the row would render as
located with no location. And the client type declares `matched_task_id` and
`project_ids` **required**, `repo?` and `branch?` optional — backwards fails the
drift check, or worse passes while the runtime disagrees.

The service's comment is what makes it easy to misread: *"the task and the
project list follow the same gate"* — they follow the same **gate**, with a
different **representation**.

An entry with no `repo` is normal and means *somebody is working, elsewhere* —
**not** a loading state, not an error, and not a row to hide.

## Acceptance criteria

- [ ] The screen renders from `GET /capacity` and `GET /presence`, in the
      **REVIEW** sidebar group, in both themes.
- [ ] **An agent session is visually distinct from a human**, using
      `is_agent` — not by guessing from the name. §11.4.2 requires it and
      LAI-411 already established how agent-authored work is badged; **reuse
      that treatment** rather than inventing a second one.
- [ ] **A person with no visible repo renders as a person**, with whatever is
      known — name, last seen, agent-or-not — and no empty label, no dash, no
      "unknown". Test it: it is the case LAI-438 created and it is the one most
      likely to render as a broken row.
- [ ] **Disabled shows a disabled state**, distinct from empty, saying the org
      has presence off — and **not** offering a control, because turning it on is
      Admin+ on the Organisation screen (LAI-149).
- [ ] **Unlisted work promotes in one click** — `POST /unlisted/:id/promote`
      needs a project and a title; the click may open a small form, but it must
      not send the user to another screen and back.
- [ ] `DELETE /unlisted/:id` dismisses, with the row leaving the list.
- [ ] **Every number comes from a response.** No client-side "active sessions"
      count derived by grouping something else.
- [ ] Live via `GET /events` if that is cheap; **a stale capacity screen is worse
      than a slow one** — if SSE does not carry what this needs, poll and say so
      in the log rather than showing a snapshot that silently ages.
- [ ] Full gate green — repo-root `pnpm test` (D-045).

## Notes / context

**No new endpoint.** If the screen needs something the API does not return, that
is a task with `area: server`, not a client-side derivation.

**The Board's "WORKING NOW" strip and the agent-sessions rail card are
LAI-440**, not this task — they consume the same `GET /presence` and are worth
landing separately so this screen is not held up by board layout.

**`initials()` exists three times already** (LAI-215). Do not make it four.

---

## Corrections — CHIEF, 2026-09-02

**Two of the four shapes above were wrong when I wrote them**, and SHELL found it
by trusting the endpoint over the task file, which is what I asked for. Verified
independently: `presence.ts:159-161` spreads `repo`/`branch` conditionally and
sets the other two unconditionally, and a live heartbeat on an untracked repo
returns keys `is_agent, last_seen, matched_task_id, name, project_ids, user_id`.

**I wrote those Notes from CORE's reports rather than from the responses.**
Eighth of that class this week.

### Two decisions asked for rather than assumed

**Resolving task ids to keys and titles is in scope.** `in_progress_tasks` and
`tasks_in_review` are arrays of ULIDs, and a screen answering *"who takes the
next task"* cannot show `01M1EN3K…`. **"Every number comes from a response" is
about not deriving figures the API did not give you** — resolving a reference is
not deriving. `GET /tasks/:id` per id, deduped, is fine at this size; **if it is
visibly slow, file the bulk endpoint rather than caching client-side.**

**Pairing `CapacityView` and `PresenceView` is in scope.** Their `UNPAIRED`
reason is *"no client type exists"*, and creating the mirror **makes that reason
false** — leaving the rows would be an exemption stating something untrue, which
is the mistake CORE refused on LAI-415. Same crossing LAI-160 authorised; do it
here rather than in a follow-up, and the drift check then guards the exact shapes
in the table above.

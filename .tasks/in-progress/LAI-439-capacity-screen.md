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

**Presence says where only to a reader who can see it** (LAI-438, §9.3). `repo`,
`branch`, `project_ids` and `matched_task_id` are **absent** when the heartbeat
attributes to nothing the reader can read. An entry with no `repo` is normal and
means *somebody is working, elsewhere* — **not** a loading state, not an error,
and not a row to hide.

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

---
id: LAI-009
title: First-run setup — create org, Owner account, first project
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-005, LAI-007]
discovered-from:
status: backlog
---

## Goal

Close M1: a fresh container with an empty database walks the first human through
creating the org and the Owner account, and lands them in an authenticated,
empty board. This is the milestone's demo.

## Acceptance criteria

- [ ] Boot with an empty database puts the app in "setup" state; every route
      except setup and health redirects there.
- [ ] `POST /api/v1/setup` creates the single org, the Owner user, and an
      optional first project, in one transaction.
- [ ] Setup is **single-use**: once an org exists the endpoint returns `conflict`
      — proven by a test that calls it twice, including concurrently.
- [ ] Signup mode defaults to `invite_only` (DECISIONS D-004).
- [ ] Setup UI in the SPA: org name, Owner email/password, optional project name
      and key, with validation and a clear error path.
- [ ] After setup the user is signed in and lands in the authenticated shell.
- [ ] Setup writes `activity` rows (`project.created` and org creation) with the
      Owner as actor.
- [ ] `LAIKA_SECRET` is validated at boot before setup is offered (see LAI-008).

## Notes / context

Milestone: **M1** — the exit criterion is: `docker compose up` → browser →
create Owner → authenticated empty shell.

The transcript/LLM provider configuration screen is **M6**, not this task. Leave
the org's `llm_provider` at `none`.

No new dependencies.

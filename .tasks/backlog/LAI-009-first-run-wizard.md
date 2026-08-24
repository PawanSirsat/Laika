---
id: LAI-009
title: First-run setup — create org, Owner account, first project
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-005, LAI-007, LAI-044]
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
- [ ] `orgs.invite_only` defaults to `1` (DECISIONS D-004). The field is a flag,
      not the `signup_mode` enum that earlier task text described.
- [ ] Setup UI in the SPA: org name, Owner email/password, optional project name
      and key, with validation and a clear error path.
- [ ] After setup the user is signed in and lands in the authenticated shell.
- [ ] Setup writes `activity` rows — **`org.created`** and `project.created` —
      with the Owner as actor. `org.created` is added to the vocabulary by
      **LAI-044**; this task must not invent it (§4.8's type list is closed).
- [ ] `LAIKA_SECRET` is validated at boot before setup is offered (see LAI-008).

## Notes / context

Milestone: **M1** — the exit criterion is: `docker compose up` → browser →
create Owner → authenticated empty shell.

The transcript/LLM provider configuration screen is **M6**, not this task. Leave
the org's `llm_provider` at `none`.

No new dependencies.

---

## PM pre-flight correction — 2026-08-24

**This task required an activity row it had no type for.** The criterion said
"`activity` rows (`project.created` and org creation)", and §4.8's closed type
vocabulary has **no org-creation type** — `enums.ts` says adding one is a schema
change, deliberately. As written, the criterion was unsatisfiable without either
inventing a type (forbidden) or dropping the row.

**Resolved:** `org.created` joins the vocabulary in **LAI-044**, which is already
opening the activity enum and its check constraint for the `system` actor kind.
One migration touching `activity` rather than two. **`depends-on` now includes
LAI-044.**

Creating the org is the single most significant event in an instance's life; an
audit trail that starts at the first project rather than the first org has a hole
at the beginning.

Found by pre-flight, before the task was claimed.

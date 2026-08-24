---
id: LAI-060
title: List the organisation's users — the API has no way to discover a person
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-059
status: backlog
started:
finished:
---

## Goal

`POST /api/v1/projects/:slug/members` takes a `user_id`. **Nothing in the API
returns one.** The mounted routes are `health`, `me`, `setup`, `projects`,
`tasks`, `comments` — none lists the org's people.

So project membership can be *changed* through the API but a person can never be
*found* through it. Any UI that adds a member can only offer a raw id field.
Discovered while scoping LAI-059, which is filed without its add flow because of
this.

## Acceptance criteria

- [ ] An endpoint lists the organisation's users, with at least `id`, `name`,
      `email` (or the §4.1 equivalents) and `avatar_color`, plus whether the user
      is active.
- [ ] `can()` gates it. **Decide and record which §3.1 cell governs it** — this
      is a directory of everyone in the org, so it is not automatically readable
      by everyone. If §3 has no matching cell, say so in the task and pick the
      narrowest defensible one, exactly as LAI-048 did for org-scoped activity
      rows (and filed LAI-111 for the gap).
- [ ] §6.3 conventions: cursor pagination, `updated_since`, and deactivated users
      handled consistently with how the codebase already treats soft-deletes.
- [ ] Agent/bot users are distinguishable from humans, or excluded — a member
      picker that offers you a service token's user is a defect.
- [ ] SPEC §6.4 gains the endpoint. It is not in the spec today, and D-011 makes
      the spec authoritative, so shipping it undocumented makes it unauthoritative.

## Notes / context

**Check §4.1 before designing the response.** Emails are the obvious privacy
question: a Member being able to enumerate every colleague's email address is a
decision, not a detail. If exposing it is wrong, the picker can work from name
plus avatar and never send an email to the client.

Related but distinct: **there is still no invites API**, so there is no way to
get a *new* person into the org at all (D-004 is invite-only). That gap is real
and separate — this task is about finding people who already exist.

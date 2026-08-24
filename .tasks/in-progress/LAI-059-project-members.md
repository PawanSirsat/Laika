---
id: LAI-059
title: Project members — list, change role, remove
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-010, LAI-058, LAI-060]
discovered-from:
status: in-progress
started: 2026-08-24T21:21:35+05:30
---

## Goal

Who is on a project, and what they may do. Three of the four member operations
are fully backed by endpoints that exist today.

**Adding a member is deliberately not in this task.** See below — it is not
buildable yet, and CLAUDE.md §5.1 says a screen that needs data no endpoint
returns stays in the backlog rather than getting stubbed.

## Acceptance criteria

- [x] Members list from `GET /api/v1/projects/:slug/members`, showing each
      person's project role. Real data only.
- [x] Change a role via `PATCH /api/v1/projects/:slug/members/:userId`.
- [x] Remove a member via `DELETE /api/v1/projects/:slug/members/:userId`.
- [x] **All three mutations return the full `{ members: [...] }` list — use it.**
      Re-render from the response rather than refetching or patching local state;
      the server has already told you the new truth.
- [x] The controls a caller may not use are not shown as enabled-then-403.
      A Member sees the list; role changes and removal are for those §3.1 permits.
- [x] `403` renders `PermissionDenied`; `404` on an unknown slug renders the
      not-found state.
- [x] Avatar colours come from `theme/avatar-color.ts` (derived from user id,
      SPEC §4.1) — **not** the prototype's `--mk --ta --sv --jd --rb` fixtures.
- [x] Both themes.

## Notes / context

**Endpoints, confirmed present:**

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/projects/:slug/members` | `{ members }` |
| `PATCH /api/v1/projects/:slug/members/:userId` | `{ members }` — full list |
| `DELETE /api/v1/projects/:slug/members/:userId` | `{ members }` — full list |

**Why "add a member" is excluded.** `POST /:slug/members` takes a `user_id`, and
**nothing in the API lists the org's users** — the mounted routes are `health`,
`me`, `setup`, `projects`, `tasks`, `comments`. So the UI has no way to let
someone pick a person; it could only offer a raw id field, which is not a
feature. Filed as **LAI-060**. When that lands, the add flow becomes its own
task.

Do not work around this by scraping user ids out of task assignees or comment
authors. That would show only people who have already done something, which is
precisely the wrong set.

## Notes from the build

**Removal asks first.** One click that cannot be undone from this screen — there
is no add flow until LAI-060 — is a trap, so Remove opens an inline
`Remove? [Yes, remove] [Cancel]` rather than acting. Inline rather than a modal:
one yes/no question does not justify a focus trap.

**Two defects found and fixed while verifying, both mine:**

1. `ApiErrorState` hardcoded `Could not load ${resource}`, so a role change the
   server refused (409, *"A project must keep at least one lead"*) was reported
   as **"Could not load this project's members"** while the members sat on screen
   underneath. Added a `verb` prop, defaulting to `load`; this screen passes
   `update` for the action error. Guarded in `states.test.ts`.
2. `.member-confirm-ask` reached for `--fg-muted`, which **is defined nowhere**.
   An undefined token is not a build or lint error — the property silently keeps
   its inherited value, so muted text renders un-muted and nothing says so. Fixed
   to `--tx2` and added a guard in `tokens.test.ts` that scans every stylesheet
   for `var(--x)` with no definition. It was the only one in the tree.

**Also fixed:** `?project=` was lost through the sign-in redirect. `AppShell`
captured `window.location.pathname` only, so `/members?project=laika-core` came
back from `/login` as `/members` and rendered "no project chosen" after a
correct sign-in. Now captures `pathname + search`.

**How it was verified.** Against a live server on :3370, with two extra members
seeded directly into the throwaway dev database — with only one member, who is
the only lead, every role change is refused by design and neither a successful
change nor a removal can be exercised at all. Seeded rows were removed
afterwards. Verified: a successful promote re-rendering from the mutation
response; a refused demote leaving roles untouched and naming the real reason;
confirm/cancel/remove; 404 on an unknown slug; and derived avatar colours
differing per user.

**The permission gate was verified live, not inferred** — the signed-in user's
`org_role` was set to `member` in the database, and the screen then rendered
static role chips with no `<select>` and no Remove, while still showing the list.
Restored afterwards. Both themes checked by computed style, not by eye.

## Add-member is now in scope — PM, 2026-08-24

**LAI-060 landed**, so `GET /api/v1/users` exists and the picker this task was
scoped around is buildable. Add to the criteria:

- [ ] Add a member via `POST /api/v1/projects/:slug/members`, choosing the person
      from `GET /api/v1/users` — a real picker showing name and avatar, never a
      raw id field.
- [ ] Agent/bot users are not offered as members unless that is deliberate; check
      what LAI-060 returns and follow it.

### Reopened by builder-b, 2026-08-24T22:00+05:30

This widening arrived on `master` while the task was already in `.tasks/review/`
with the original scope built and verified. Rather than leave it in review with
two criteria it does not meet, it goes back to `in-progress`. Everything above
stays built; only the add flow and the note about it are outstanding.

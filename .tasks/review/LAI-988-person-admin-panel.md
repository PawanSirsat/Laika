---
id: LAI-988
title: 'Managing one person takes four screens: no admin panel on their profile'
area: web
assignee: shell
priority: p1
depends-on: [LAI-981, LAI-983, LAI-986, LAI-970]
discovered-from:
status: review
started: 2026-10-22T19:15:39Z
finished: 2026-10-22T19:46:35Z
---

## Acceptance criteria (audit C2, C3, C4, B13)

- [x] Member profile gains an **Admin** panel for holders: role (owner-only
      picker), deactivate/reactivate with the **offboarding dialog** (open
      tasks: unassign / reassign), **Sign out everywhere**, **Reset link**
      (shown once, copy), tokens (list + revoke), and **Spaces** (list with
      roles, add to spaces with role, remove) via the new memberships read.
- [x] Space Members removal (LAI-977) uses the same offboarding dialog.
- [x] Permissions from the server only; confirmations; light/dark, 1440/390;
      browser tests. Gate exit 0 with servers merged.

## Notes

**Dependency deviation (§2 step 1).** LAI-981, LAI-983, LAI-986 and LAI-970
are in `.tasks/review/`, not `done/`, at claim time. Claimed on CHIEF's
dispatch (polly, Belka) against base `63690059` = LAI-993's server
integration + LAI-977's space settings page, which carries all four.

## Submission (SHELL, 2026-10-23)

The third criterion is ticked for its first five clauses. **Its last clause,
"Gate exit 0 with servers merged", is not met on this branch alone**, and
§4.4 step 1 is how it is submitted: red, with every failure quoted and named.

`pnpm test` at the repo root exits **1**; `pnpm lint` and `pnpm format` exit
**0**. Every failure is another task's half:

- **LAI-997 (CORE, filed here)** — `server/test/tooling/response-type-coverage.test.ts`:
  `"SignOutView | MembershipView | ResetLinkView | PasswordResetView is paired now — remove it from UNPAIRED"`
  and `expected 90 to be 86`. The list's own comment says LAI-988 brings
  these mirrors; the list is CORE's.
- **LAI-987** — `activity-labels.test.ts` *"these types render raw:
  user.signed_out, org.ownership_transferred"*; `use-events.test.ts`
  *STREAM_TYPES equals ACTIVITY_TYPES* (the same two verbs); the activity
  describer *"covers every verb the server can write"* (same two);
  `view-type-drift.test.ts` `UserView.last_seen_at`, `OrgView.extra_owners`;
  `endpoint-coverage.test.ts` `invites/*/reissue`, `org/transfer-ownership`.
- **LAI-989** — `view-type-drift.test.ts` `CapabilityView.description`;
  `endpoint-coverage.test.ts` `org/overview`.
- **LAI-975** — `endpoint-coverage.test.ts` `tasks/summary`.

This task's four endpoints (`users/*/memberships`, `users/*/sign-out`,
`users/*/reset-link`, `password-resets/consume`) left the endpoint-coverage
list, and their four view types are paired.

## Review response — Codex release 2 review (PR #89), 2026-10-23 (SHELL)

Criteria unchanged. Branch `release2-web-review-fixes` from `b881445f`.

- **Blocking — the reset token stayed in the URL, history and state**
  (`ResetPasswordRoute.tsx`). The token is read once into state, then
  dropped from the address at once by `setParams` (`history.replaceState`),
  so neither the bar nor Back holds it. It is cleared from state after a
  set password or a terminal refusal; a throttle keeps it, since the link is
  not spent. Tests in `person-admin.test.ts`: `page.url()` has no `token`
  once the form is drawn, after success, and after each of the five
  refusals. After a throttle the URL is clean and the retry still posts the
  token. A missing token still says so.

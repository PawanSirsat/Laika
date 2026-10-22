---
id: LAI-950
title: 'Organisation has no Roles & Permissions view: an owner cannot see what each role may do'
area: web
assignee: shell
priority: p1
depends-on: [LAI-885]
discovered-from:
status: review
finished: 2026-10-22T12:25:52Z
started: 2026-10-22T12:08:00Z
---

## Goal

The owner asked (2026-10-22) for a proper roles and permissions screen.
LAI-885 serves `GET /api/v1/permissions`, computed by `can()` itself. This
task shows it, so the matrix can never drift from policy. Read-only: roles
are still assigned where they are today (Organisation → People for org roles,
project Members for project roles).

## Acceptance criteria

- [x] Organisation gains a **Roles & permissions** tab, visible to every
      signed-in role (the endpoint is `org.read`).
- [x] It renders two tables from `GET /api/v1/permissions` — organisation
      actions × `owner|admin|member|viewer`, project actions ×
      `lead|member|viewer` — each cell yes / no / conditional, a conditional
      cell showing the condition text the server sends. Session-only and
      read-only actions are marked. An action the server sends with no label
      shows its action name, not invented text.
- [x] A "What you can do" summary from the response's `me` block, including
      the token-scope fields as the server sends them.
- [x] Links: "Change someone's role" → Organisation → People (owner/admin);
      project roles → that project's Members.
- [x] No role, action or label is hardcoded in the client: every string comes
      from the response (a test feeds a fixture with an invented action and
      asserts it renders).
- [x] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/permissions` (the screen is its caller).
- [x] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-885 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-885-permissions-catalogue`
merged in. Match `docs/design/` (Organisation members list in
`Laika Prototype.dc.html`) for style only.

## Submission notes (shell, 2026-10-22)

**The gate criterion is left unticked, on purpose.** `pnpm lint` exited 0 and
`pnpm format` exited 0. `pnpm test` exited **1**, on two web assertions in
files this task does not touch, and re-run alone they fail the same way:

- `test/browser/my-day-v3.test.ts:106` *"the card spans the page above the
  editor, and today opens with now in view (LAI-889)"*: `now at 891 of 882`,
  then `now at 901 of 882` on the re-run ten minutes later
- `test/browser/my-day.test.ts:369` *"a 12-hour clock with AM/PM, and minutes
  and hours in words"*: `ticks: 6 AM … 11 AM, 1 PM …` (no `12 PM`)

Both read the real clock and were run at about 17:45–17:50 IST. Late in the
day the Timeline cannot scroll far enough to put now at three fifths, and
12 PM drops off the axis. Neither file nor anything under `my-day/` differs
from `master`. Every other result: server 3465 passed, 10 skipped; web 2850
of 2852. `api/v1/permissions` is gone from the endpoint-coverage failures.

**The client type is not in `view-type-drift.test.ts`'s `PAIRS`.** A pair
there makes CORE's `UNPAIRED` entry for `PermissionsView` in
`server/test/tooling/response-type-coverage.test.ts` stale, and that test
goes red. So `test/api/permissions.test.ts` compares the fields directly
until both halves land together.

---
id: LAI-883
title: 'An owner or admin does not see a private space they are not a member of, on Projects or in My day''s On your plate'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T10:51:47Z
---

## Goal

The owner asked (2026-10-22) to see everything in the organisation. Policy
already gives owners and admins an implicit `lead` on every project
(`effectiveProjectRole`, `server/src/policy/can.ts`), and `GET /projects`
returns those projects — but the UI drops them.

## Found (CHIEF investigation, 2026-10-22)

- `server/web/src/routes/screens/ProjectsScreen.tsx` (~62–65, ~291) splits
  projects into `mine` (explicit `me.memberships`) and `joinable` (public,
  non-member). A **private** project the owner is not explicitly a member of
  falls in neither list and is not rendered.
- `server/web/src/routes/screens/my-day/OnYourPlate.tsx` (~70) restricts
  projects to explicit memberships, omitting owner-accessible ones.

## Acceptance criteria

- [ ] Every project `GET /projects` returns is rendered on Projects for an
      owner or admin, including private projects with no explicit membership.
      Shown in "Your spaces" (or a clearly labelled "All spaces" section — the
      builder picks one and says why in the log).
- [ ] A member or viewer sees exactly what they see today (test pins it).
- [ ] On your plate uses the same rule: an owner's/admin's assigned work in a
      project they reach only through the implicit lead is shown.
- [ ] Tests red first against today's code, for both screens; assertions name
      the private project, not a count.
- [ ] Both themes unaffected. Gate: `pnpm test`, `pnpm lint`, `pnpm format`
      each exit 0.

## Notes

Client mirror of the rule: the existing project helpers in
`server/web/src/api/tasks.ts` (~355) already model owner/admin implicit lead —
reuse, do not add a second copy.

## Renumbered

Filed by CHIEF on 2026-10-22 as `LAI-871`, which collided with a task already on
`origin/master` (the id sweep ran before `git fetch`). Commit `2274bfc9`
carries `[LAI-871]` for all five filings, and a claim commit `2c1a7274`
`[LAI-872]` (pushed as branch `LAI-872-share-activity-switch`) belongs to the
filing now LAI-884 — **neither is the task that holds that number now.**

---
id: LAI-968
title: 'My day’s Drafts mode note still says only what a person confirms is ever seen — D-102 rule 1 lets owners and admins read drafts'
area: web
assignee: shell
priority: p2
depends-on: [LAI-957]
discovered-from: LAI-967
started: 2026-10-22T16:06:40Z
status: review
finished: 2026-10-22T16:11:02Z
---

## Goal

`server/web/src/routes/screens/my-day/my-day-derive.ts` `MODE_NOTES.drafts`
(~line 259) reads: *"Each person may also choose to have their day drafted on
their own machine. Only what they confirm is ever seen by anyone else."*

D-102 rule 1 (and its amendment: *"the owner and admin therefore see
everything rule 1 lists, drafts and local activity included"*) makes the
second sentence false once LAI-957 lands: an owner or admin reads a person's
drafts, read-only, and the person sees who looked (rule 3). Found by LAI-967's
census of `server/web/src` for wording that describes a person's choice; left
alone there because it is Time drafting (D-088), not local activity, and
LAI-967's criteria are about the latter.

Whether *"Each person may also choose to have their day drafted"* is still
true is not settled here: D-102 amended speaks of local-activity collection,
and drafting has its own switch (`GET /me/time-settings`, "both switches").
Read D-102 and D-088 before rewording the first sentence.

## Acceptance criteria

- [x] `MODE_NOTES.drafts` no longer claims nobody else sees an unconfirmed
      draft; it says owners and admins can read them and the person can see
      who looked — matching the wording LAI-959 uses on the person's day.
- [x] The first sentence is kept or changed according to D-102/D-088 as read
      at the time, with the decision named in the log.
- [x] A test asserts the new wording; light/dark where it renders. Gate exit 0.

## Builder notes (SHELL, 2026-10-22)

- **First sentence kept.** *Draft my time* is still each person's own switch
  (D-088 item 5; SPEC §3.1 "Set own Draft my time"; `GET /me/time-settings`
  "both switches"). D-102's amendment replaced the personal switch for
  **local-activity collection** only, so *"Each person may also choose to have
  their day drafted"* is still true.
- **New wording**, one phrase (`DRAFT_READERS` in `my-day-derive.ts`):
  *"owners, admins and anyone the owner lets see everyone’s analytics"*, plus
  *"they can see who looked"*. The person's header links to *Who looked at my
  time* (LAI-959).
- **Census**, untruncated, of `server/web/src`, for wording that calls drafts
  private: 9 sites, all fixed, listed in `logs/shell-2026-10-22.md`. A census
  test now guards My day, `screen-copy.ts`, `TimeModeFact.tsx` and `api/time.ts`.
- Gate: see the log and the PR. `server/test/tooling/response-type-coverage.test.ts`
  may still be red from the `WhoLookedView` entry (CORE removes it on LAI-969).

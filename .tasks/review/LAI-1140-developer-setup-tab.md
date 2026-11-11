---
id: LAI-1140
title: 'Developer setup tab on the member profile'
area: server/web
assignee: shell/belka
priority: p2
depends-on: [LAI-1137, LAI-1134]
status: review
started: 2026-11-05T18:05:00+05:30
finished: 2026-11-05T19:40:00+05:30
---

## Why

T8 of `.polly/plans/time-report-programme.md` (§1 turn 2 frames 2p–2ab, §2.4,
§4 T8), D-132, D-133, D-134. Owners and holders of *See and manage anyone's
developer setup* read a member's whole developer setup on their profile, and
revoke a tool, unpair a device or revoke a token behind a confirm. Card
LAIKA-1003, a subtask of LAIKA-997 (LAI-1133). Filed straight into
`in-progress/` by polly's dispatch: no file existed on any branch.

## Named crossings

- `server/web/test/api/endpoint-coverage.test.ts` `NO_BROWSER_CALLER`: the
  three entries marked *LAI-1140 — Developer setup tab* removed (SHELL's file;
  listed for the reviewer).
- `server/test/tooling/response-type-coverage.test.ts`: the six LAI-1137
  `no client type exists` entries leave, paired in `view-type-drift.test.ts`.
- `docs/SPEC.md` §11.4.2 and §11.4.2.1: the member profile rows gain the tab.

## Scope addition (polly-directed, mid-task)

After LAI-1143 (PR #283) made the server refuse an admin any token the owner
holds (`403 not_for_owner`), polly added: hide Revoke on the owner's tokens
from a non-owner in the Manage member panel (`manage-controls.ts`,
`ManageSections.tsx`) and on Organisation → Security
(`OrganisationScreen.tsx`), with a short explanation; handle `403
not_for_owner` gracefully; test each; share one helper with this tab. Done as
`server/web/src/api/owner-setup.ts` (`mayActOnSetupOf`, `revokeRefusal`,
`OWNER_SETUP_NOTE`), with tests in `manage-controls.test.ts`,
`person-admin.test.ts` and `organisation-tokens.test.ts`.

## Acceptance criteria

- [x] Frames 2p–2ab plus the error state, token-driven in both themes and at
      390px: summary, devices (revoked collapsed), pending pairing requests,
      tools (checks, grants, launcher, consent, last seen), repositories,
      tokens including revoked and expired, and 30 days of activity.
- [x] The notice line *"… can see that you looked"*.
- [x] Hidden spaces are counts, never names (`repositories_hidden`,
      `grants_hidden`, `project_ids_hidden`).
- [x] Every ⋯ is a `menu` of `menuitem`s; each action opens a confirm listing
      what stops working and *"<first> is notified in Laika"* (no email).
- [x] A success notice after each revoke.
- [x] Revoke actions are hidden, with an explanation, when the reader may not
      revoke (`can_revoke` false: an admin on the owner); `403 not_for_owner`
      from the server is handled with its sentence.
- [x] Deactivated (frame 2aa): everything muted, only revokes left.
- [x] Token filter Active / Expired / Revoked / All with counts, and search
      when there are more than 8.
- [x] The health line (derived on the client from checks and the client
      report) jumps focus to the item.
- [x] The pending pairing row shows no code.
- [x] The tab is absent without `developer_setup.read_any` and on your own
      profile.
- [x] Loading, empty (2y/2z) and error-with-retry states; nothing hardcoded,
      with a no-prototype-data guard.
- [x] Client types in `api/developer-setup.ts`, paired in
      `view-type-drift.test.ts`.

## Notes

- PR: https://github.com/PawanSirsat/Laika/pull/285 (board LAIKA-1003).
- Deviations: 2aa has no deactivation date (the read serves none); the Manage
  panel keeps its token list (owner guard added) rather than becoming a count
  and a link; `harness.ts` default grants still lack `developer_setup.read_any`
  (left alone; the new browser test names its own `/permissions`).
- Merging master (LAI-1138): its *Time this week* card is gated on
  `offered.includes('time')`, because the tab row can now be Developer setup
  alone.
- First CI round red on `structure.test.ts` (no mirror for the two new api
  modules) and `type-floor.test.ts` (CSS off the type scale); fixed in
  5225fa50, run 42034112856 green.
- Review round 1 (cross-review BLOCK, fixed on this branch): the health line
  and repository rows now call Developer access's own rules (`listedStatus`,
  `repoGroups`/`recordState`, `updateStatus` *required* only) instead of
  restating them; see the log's review-round entry.
- The tab's revoke actions follow the server's `can_revoke`, not
  `mayActOnSetupOf`: the read already asked `can()` about this reader and this
  person, so the client draws what the server allows rather than a second
  guess. `mayActOnSetupOf` serves the two token screens, which have no such
  answer from the server. The owner note shows only when the subject is the
  owner.

---
id: LAI-750
title: 'Member profile v2: the strategy-page look on real data — cards, bars, tiles, agent share, a manager review queue; definitions behind (i)'
area: web
assignee: chief
priority: p1
depends-on: [LAI-743, LAI-746, LAI-749]
discovered-from:
started: 2026-10-15T12:04:52Z
status: done
finished: 2026-10-15T12:40:58Z
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4): one branch may change
`server/`, `server/web/` and `docs/` together. Every other `CLAUDE.md` rule
still applies. The owner looked at the live profile (LAI-743/746/749) and said:
*"why is the UI not that good, I don't like it, use the good one you created
for the Laika strategy"*.

The profile at `/people?user=<id>` reads like the profile mockup in the Laika
strategy page — a header card with a ringed avatar and an *admins only* pill,
the Builder/Manager control in a dashed box, rounded cards in a responsive
grid, horizontal project bars, metric tiles with big monospace numbers, a
stacked agent-share bar with real agent logos, an *Online now* card, and for a
manager a review-queue view with a review-load chart — **on real data only**.
Definitions move out of paragraphs into an (i) popover and tile tooltips.
Every access rule, the rating dialog and its history keep working.

## Acceptance criteria

**Server — read-only figures inside the existing admin-only read**

- [x] `GET /users/:id/profile`'s `review` gains `per_week` (accepted and sent
      back per week of the window, zeros included), `last_30_days` (decisions
      in the 30 days to now) and `time_to_decide` (median from the task's
      latest entry into Review to the decision; decisions with no recorded
      entry counted as `unmeasured`, `p50_ms: null` when nothing measured).
- [x] A **manager's** profile gains `queue` — projects they lead (membership
      role `lead`, not archived), tasks in Review there assigned to anyone but
      them (`waiting`, per project and in total) and when the oldest of them
      entered Review. **Absent for a builder**, as the builder blocks are
      absent for a manager.
- [x] A **builder's** `agents` gains `writes` / `writes_total`: their
      `activity` rows made through a token in the window, grouped by the agent
      each token last connected as (D-076's `last_client`). Rows by another
      person, by a session, or outside the window are not counted.
- [x] Same `can()` checks and the same no-token rule (D-078): nothing new is
      reachable by anybody who could not read the profile before. No new data
      is collected, no table or column is added, no `activity` row is written.
      No location is added: *Online now* says which agents, never where (D-078
      item 4).
- [x] Service tests assert exact numbers for each new field on the seeded
      history, including the excluded cases; each shown red without its code.
- [x] The client types and `view-type-drift.test.ts` pairs cover every new
      shape; SPEC §6.4's profile table and §11.4.2's screen line say what is
      served and shown.

**Web**

- [x] Header card: avatar with a coloured ring, name, a sub-line (org role ·
      N projects · email · member since), a *Visible to admins only* pill, the
      deactivated chip where it applies.
- [x] The kind control is a segmented Builder | Manager radio group in a
      dashed box, labelled, saying it is a label and not a permission, with the
      meaning of each kind in an (i) popover.
- [x] Builder: *Delivered · 12 weeks* (weekly bars with a text alternative and
      tiles — accepted, sent back, reopened, cycle p50 / p75), *Projects* as
      horizontal bars, *Current work* (counts, oldest in progress, the task
      rows), *Agents used · N types* (one stacked bar by share of writes,
      legend with the real logo, name and share %), *Online now* (green dot,
      logo, name, last active), *Review work for others*, and the rating.
- [x] Manager: tiles (projects led, decided in 30 days, accepted, sent back,
      median time to decide, waiting now, oldest waiting), a *Review load per
      week* chart, projects as bars with what waits in each, recent decisions,
      the rating. No agent, current-work or delivery card.
- [x] Definitions (accepted, sent back, reopened, cycle time, time to decide,
      waiting, agent share, Builder/Manager) are in (i) popovers and tile
      tooltips, not paragraphs. The (i) opens and closes by keyboard.
- [x] Empty states are compact, inside their card: nothing accepted shows a
      sentence instead of an empty chart; no agent says *"No agent has
      connected with this person's tokens yet"*; no review decisions, no
      waiting work and no rating each say so.
- [x] The rating card, dialog and history are restyled and still work: Rate
      for anyone but yourself, keyboard, Escape, a save in flight, a refusal
      shown in the dialog, the per-member attempt key (LAI-746, LAI-749).
- [x] Nothing from the mockup is hardcoded; every number is the response's.
      Design tokens only, both themes; no new dependency.
- [x] Fits 1366, 1024 and 390 wide in light and dark with nothing scrolling
      sideways; the toggle is labelled and each chart has a text alternative.
- [x] Browser tests updated to the new markup, with new tests for the new
      cards, tiles and empty states — each shown red against the old code or
      with the feature broken.

**Gate**

- [x] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 from the worktree
      root after the last edit.
- [x] Screenshots before (master) and after, Builder and Manager, light and
      dark, 1366 and 390, the empty state and the rating dialog, in
      `/tmp/laika-profile-v2-shots/`.

## Notes / context

- Branch `build-profile-v2`, worktree `Laika-profile-v2/`, cut from `master`
  `0fa7347` (what production runs). The orchestrator reviews, merges and
  pushes; this task does not.
- Reference: the strategy page's developer-profile mockup,
  `/tmp/laika-profile-v2-ref/laika-strategy.html`, `<section id="s10">` (the
  brief said `s6`; in this copy `s6` is the acceptance gate). Take the look
  only — none of its badges, banner, window chrome, numbers or names.
- Files this task touches:
  - `server/src/services/profiles.ts` and `server/test/services/profiles.test.ts`;
  - `server/web/src/api/profiles.ts`;
  - `server/web/src/routes/screens/profile/` — `ProfileScreen.tsx`,
    `RatingDialog.tsx`, `profile-derive.ts`, `profile.css`, and new files in
    that folder only;
  - `server/web/test/browser/member-profile.test.ts`,
    `server/web/test/routes/screens/profile/profile-derive.test.ts`,
    `server/web/test/api/view-type-drift.test.ts` (the profile pair table);
  - `docs/SPEC.md` §6.4 (the member-profile table) and §11.4.2 (the member
    profile line).
- Left out on purpose: tokens, sessions per month, active hours, plan cost
  (each needs new collection, D-078 item 5); *what an online agent is working
  on* (D-078 item 4, "never where"); first-pass acceptance and any automatic
  band (D-078 item 6).

## Build notes

Single-agent mode, on the owner's direct instruction (HANDOVER §4). Commits on
`build-profile-v2`: `da009fb` file · `131801b` claim · `9425087` server figures
and service tests · `eb0a511` format · `db48f22` the screen and its tests ·
`34f6ce0` SPEC · `df477bc` avatar ring fix. Not pushed, not merged.

**Server — read-only, inside `getProfile`, after `profile.read`.** No new
table, column, route, action or `activity` row; the session-only rule is
unchanged because the function and its `assertCan` are.
- `review.per_week`, `review.last_30_days`, `review.time_to_decide` (both
  kinds): from the decisions the profile already loaded, plus one query of the
  status changes on the decided tasks to find each one's latest entry into
  Review. A decision from outside Review, or with no logged entry, is
  `unmeasured`.
- `queue` (manager only): membership role `lead` on a project not archived;
  waiting = tasks in a Review-category status there assigned to anyone but
  them, unassigned included; oldest = the earliest of their latest entries
  into Review. Absent for a builder.
- `agents.writes` (builder only): `activity` rows with this `actor_id` and an
  `actor_token_id`, in the window, grouped by token and then by the agent the
  token last connected as (`clientOf`, D-076). Revoked tokens count.

**Red first.** The new and changed service tests were run against the old
`profiles.ts` (swapped in, restored by trap, checksum checked): 9 failed.
Then seven mutations, each restored and checked: own task counted as waiting,
archived project kept, a decision from outside Review timed, session rows
counted as agent writes, writes after `now` counted, first entry instead of
latest, 30 days as 60. Two survived the first pass (the seed's median did not
move), so a test pinning both was added; all seven are now red.

**Web.** `ProfileScreen.tsx` rebuilt on the same data flow (load, kind PATCH,
rating attempt per member, all unchanged), new `InfoTip.tsx` (a disclosure:
`aria-expanded`, Escape closes and returns focus, outside click closes, kept
inside the viewport), `profile-derive.ts` gains `sharePercents` (largest
remainder, sums to 100), `agentRows`, `lastActive`, `countLabel`.
`profile.css` rewritten, tokens only (`color-mix` of tokens for tints); a
container query folds six columns to two and one; short cards stack beside
tall ones so nothing stretches around empty space.
- The kind control is a `role="radiogroup"` labelled *Profile kind* and
  described by *admin only · a label, never a permission*; arrow keys move it.
- Each chart is an `<ol>` with an `aria-label` and a visually hidden sentence
  per bar; the share bar is `role="img"` with every agent and share in its
  label.
- The rating card shows the latest with five pips and the note as a quote;
  across the page on a builder, the history sits beside it.

**Red first, web.** The updated browser file was run against the old screen
(old `ProfileScreen.tsx`, `profile.css`, `profile-derive.ts`,
`api/profiles.ts` swapped in, `InfoTip.tsx` removed, all restored by trap,
checksums checked): 9 of 25 failed, each on the new feature (missing tiles,
roles, cards, text; a definition printed on the page). Then seven mutations
of the new screen, all red after two tests were tightened: a chart drawn with
nothing accepted, every token's agent shown online, Escape not returning
focus, the manager's bar counting open work, share as a raw count, waiting
showing projects led, review load dropping sent back. The derive tests fail
on the old module (missing exports) and on a broken largest-remainder rule.
`view-type-drift.test.ts` covers the five new shapes; with
`oldest_waiting_since` dropped from the client it goes red.

**Deviations, and why.**
- The reference is `<section id="s10">` in the copy given; `s6` there is the
  acceptance gate.
- The pill says *Owners and admins only*, not *Visible to admins only*: an
  owner is not an admin role, and the header already says owners and admins.
- The kind row says *Profile kind*, not *Works with agents*: that is the
  mockup's name for a field Laika calls `profile_kind`.
- *Online now* shows when each agent was last active, not what it is working
  on: D-078 item 4 says a profile says which agents, never where.
- Not built, each needing new collection (D-078 item 5) or excluded by D-078
  item 6: tokens, sessions per month, active agent time, plan cost, cost per
  task, first-pass acceptance, the automatic band. No placeholder tiles.

**Screenshots** in `/tmp/laika-profile-v2-shots/`, from one local instance on
port 3471 with its own database, seeded through the real services:
`before-*` (master's screen) at 1366 and 390, `after-*` at 1366, 1024 and 390,
each for builder, manager, an empty profile and the rating dialog, light and
dark; and `ref-mockup-{light,dark}.png`.

## Accepted

2026-10-15, by polly (orchestrator), on the owner's direct instruction. Same-vendor review of 0fa7347...350cab1: APPROVE, no blockers. Orchestrator gate at 350cab1: LINT 0, FMT 0; web 1891/1891, cli 168/168, server 2396/2401 with the 5 failures all in test/tooling/build.test.ts under load average ~22-25, which passed 15/15 alone. Reviewer measured profile load at 20k tasks / 248k activity rows: 51 ms (was 19-33 ms), every new query indexed. Non-blocking follow-ups, recorded in logs/chief-2026-10-15.md for a later task: "waiting" counts unassigned tasks while SPEC 1234 and the (i) say otherwise, and accepting an unassigned task is not counted as a decision; no test pins the Review-to-Review rule in entersReview; a token that never connected appears under "Agents used"; agent share follows each token's latest agent (disclosed; say it plainly in the (i)); "Oldest waiting" skips tasks with no logged entry into Review; an archived project's name can shrink to one letter with an 8-character key.

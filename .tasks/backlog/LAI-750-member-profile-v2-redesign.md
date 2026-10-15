---
id: LAI-750
title: 'Member profile v2: the strategy-page look on real data — cards, bars, tiles, agent share, a manager review queue; definitions behind (i)'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-743, LAI-746, LAI-749]
discovered-from:
status: backlog
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

- [ ] `GET /users/:id/profile`'s `review` gains `per_week` (accepted and sent
      back per week of the window, zeros included), `last_30_days` (decisions
      in the 30 days to now) and `time_to_decide` (median from the task's
      latest entry into Review to the decision; decisions with no recorded
      entry counted as `unmeasured`, `p50_ms: null` when nothing measured).
- [ ] A **manager's** profile gains `queue` — projects they lead (membership
      role `lead`, not archived), tasks in Review there assigned to anyone but
      them (`waiting`, per project and in total) and when the oldest of them
      entered Review. **Absent for a builder**, as the builder blocks are
      absent for a manager.
- [ ] A **builder's** `agents` gains `writes` / `writes_total`: their
      `activity` rows made through a token in the window, grouped by the agent
      each token last connected as (D-076's `last_client`). Rows by another
      person, by a session, or outside the window are not counted.
- [ ] Same `can()` checks and the same no-token rule (D-078): nothing new is
      reachable by anybody who could not read the profile before. No new data
      is collected, no table or column is added, no `activity` row is written.
      No location is added: *Online now* says which agents, never where (D-078
      item 4).
- [ ] Service tests assert exact numbers for each new field on the seeded
      history, including the excluded cases; each shown red without its code.
- [ ] The client types and `view-type-drift.test.ts` pairs cover every new
      shape; SPEC §6.4's profile table and §11.4.2's screen line say what is
      served and shown.

**Web**

- [ ] Header card: avatar with a coloured ring, name, a sub-line (org role ·
      N projects · email · member since), a *Visible to admins only* pill, the
      deactivated chip where it applies.
- [ ] The kind control is a segmented Builder | Manager radio group in a
      dashed box, labelled, saying it is a label and not a permission, with the
      meaning of each kind in an (i) popover.
- [ ] Builder: *Delivered · 12 weeks* (weekly bars with a text alternative and
      tiles — accepted, sent back, reopened, cycle p50 / p75), *Projects* as
      horizontal bars, *Current work* (counts, oldest in progress, the task
      rows), *Agents used · N types* (one stacked bar by share of writes,
      legend with the real logo, name and share %), *Online now* (green dot,
      logo, name, last active), *Review work for others*, and the rating.
- [ ] Manager: tiles (projects led, decided in 30 days, accepted, sent back,
      median time to decide, waiting now, oldest waiting), a *Review load per
      week* chart, projects as bars with what waits in each, recent decisions,
      the rating. No agent, current-work or delivery card.
- [ ] Definitions (accepted, sent back, reopened, cycle time, time to decide,
      waiting, agent share, Builder/Manager) are in (i) popovers and tile
      tooltips, not paragraphs. The (i) opens and closes by keyboard.
- [ ] Empty states are compact, inside their card: nothing accepted shows a
      sentence instead of an empty chart; no agent says *"No agent has
      connected with this person's tokens yet"*; no review decisions, no
      waiting work and no rating each say so.
- [ ] The rating card, dialog and history are restyled and still work: Rate
      for anyone but yourself, keyboard, Escape, a save in flight, a refusal
      shown in the dialog, the per-member attempt key (LAI-746, LAI-749).
- [ ] Nothing from the mockup is hardcoded; every number is the response's.
      Design tokens only, both themes; no new dependency.
- [ ] Fits 1366, 1024 and 390 wide in light and dark with nothing scrolling
      sideways; the toggle is labelled and each chart has a text alternative.
- [ ] Browser tests updated to the new markup, with new tests for the new
      cards, tiles and empty states — each shown red against the old code or
      with the feature broken.

**Gate**

- [ ] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 from the worktree
      root after the last edit.
- [ ] Screenshots before (master) and after, Builder and Manager, light and
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

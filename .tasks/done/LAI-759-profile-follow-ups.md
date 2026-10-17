---
id: LAI-759
title: 'Profile follow-ups: check each against master; fix what is still broken'
area: web
assignee: owner-direct
priority: p2
depends-on: []
discovered-from: LAI-743
status: done
finished: 2026-10-17T07:17:36Z
started: 2026-10-17T06:49:03Z
---

## Goal

Filed on the owner's direct instruction as part of the cleanup release
(LAI-755, LAI-756, LAI-730, LAI-744 and this), one builder on `build-cleanup`.
Seven follow-ups to the member profile (LAI-743) were listed, with the note that
LAI-751 had already fixed some. Each is checked against `master` (`401191b`)
first; one that is already fixed is recorded as such with its evidence and not
redone, and one that is still broken is fixed with a test that fails without
the fix.

## Acceptance criteria

- [x] (a) *Waiting* and decisions agree about unassigned tasks, and the (i)
      says so — fixed, or recorded as already fixed with evidence.
- [x] (b) A token that never connected is not an agent row under *Agents
      used* — fixed, or recorded as already fixed with evidence.
- [x] (c) An archived project with a long key keeps a readable name — fixed,
      or recorded as already fixed with evidence.
- [x] (d) *Oldest waiting* counts a task that went straight into Review —
      fixed, or recorded as already fixed with evidence.
- [x] (e) The (i) on *Agents used* says plainly that a token used with two
      agents credits all its changes to the agent it last connected as —
      fixed, or recorded as already fixed with evidence.
- [x] (f) Browser Back while a rating saves never loads the previous person's
      profile onto the page — fixed, or recorded as already fixed with
      evidence.
- [x] (g) A test proves going back to a person retries with that person's own
      idempotency key — added, or recorded as already present.

## Notes / context

- **Claimed with LAI-755, LAI-756, LAI-730, LAI-744 and LAI-759 together:
  cleanup release, owner's direct instruction** (docs/HANDOVER.md §4), one
  builder on branch `build-cleanup`.
- Board card: LAIKA-565.

### Checked against master, 2026-10-17: all seven already fixed by LAI-751

Every item is a ticked criterion in `.tasks/done/LAI-751-activity-heatmap.md`,
*Profile "everything works" pass* (its letters differ from this file's:
LAI-751 (a)=(g) here, (c)=(f), (d)=(a), (e)=(b), (f)=(c), (g)=(d), (h)=(e)),
fixed in `9586a5f1` (server) and `af872fd0` (web), each with a test. Nothing
was redone.

| | Where it is fixed | The test that holds it |
| --- | --- | --- |
| (a) | `queueFor` and `loadDecisionsOnOthers` in `server/src/services/profiles.ts` share `or(isNull(assignee), ne(assignee, user))`; the (i) (`MEANS.waiting`, `ProfileScreen.tsx`) reads *"…not theirs — someone else's, or nobody's."* | `server/test/services/profiles.test.ts` *"counts deciding an unassigned task as a decision, as it counted as waiting (LAI-751)"*; `member-profile.test.ts` |
| (b) | `agentRows` in `profile-derive.ts` drops a token that is not `connected()` (no `last_used_at`, no `last_mcp_at`) | `member-profile.test.ts` (token `k4`); `profile-derive.test.ts`, `agentRows` |
| (c) | `profile.css`: `.prof-project` grid `minmax(0, 9.5rem) minmax(0, 1fr) auto`, the title `flex: 1 1 5rem` drops under the key, ARCHIVED moved to `.prof-row-meta` | `member-profile.test.ts`, key `LONGKEY8`, title ≥ 60px at 1366, 1024 and 390 |
| (d) | `reviewEntry` in `profiles.ts`: a task whose log never shows it entering Review from elsewhere waits from its creation | `profiles.test.ts` *"counts a task created straight into Review as waiting since its creation (LAI-751)"*, *"times a task created straight into Review from its creation (LAI-751)"* |
| (e) | The (i) on *Agents used* (`ProfileScreen.tsx`): *"A token used with two agents credits all its writes to the last one it connected as."* | `member-profile.test.ts` |
| (f) | `ProfileScreen.tsx`: a `shown` ref follows `userId`; `save` returns early when `shown.current !== user.id`, and the reload checks it before every `setLoad` | `member-profile.test.ts`: holds the POST, goes Back, releases; Cal's header stays and Bea's profile is not read again |
| (g) | Attempts kept per member in `ratingAttempts` (`ProfileScreen.tsx`); `nextAttempt` reuses a key only for the same member, score and note | `member-profile.test.ts` *"going back to a member retries with that member's own key"* (Bea fails, Cal fails, back to Bea: `sent[2].key === sent[0].key`) |

### One change on the profile, from LAI-756 rather than from this list

The (i) on *Online* said an agent is online after *"a heartbeat or an MCP
call"*. With LAI-756 a token's REST write counts too, so it now says *"a
heartbeat, an MCP call or a change through the API or the CLI"*. Committed with
LAI-756.

### Discovered, not done (no id in my range to file it under)

- `agentTokens` in `server/src/services/profiles.ts` slices to 50 and counts
  `tokens_total` **before** the client drops never-connected tokens, so a
  person with more than 50 tokens could see *"and N more"* counting tokens that
  are not listed and never will be. Harmless below 50 tokens. Filtering
  `connected` on the server, before the slice, would fix both.
- `reviewEntry` returns `null` for a task the log shows leaving Review and never
  coming back while it is in Review now (an unlogged move): it counts in
  *Waiting* but not in *Oldest waiting*. Whether the API can produce that
  state was not checked.

## Result

All seven were already fixed by LAI-751 (table above); nothing redone, no code
for this task. Checked by reading the code and the tests named above against
`401191b`.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) after one Claude review (APPROVE; merged before build-review-gate so its migration 0032 keeps the earlier timestamp); merged to master on the owner's direct instruction. Non-blocking review notes (dead .bt-members rule and stale SprintStats comment, archived-space chip fallback, refused writes still stamping presence, README badge hex test) filed as LAI-762.

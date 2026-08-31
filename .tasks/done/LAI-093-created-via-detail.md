---
id: LAI-093
title: '`created_via` says "agent" but never which agent'
area: server
assignee: core
priority: p2
depends-on: [LAI-011]
discovered-from:
status: done
started: 2026-09-01T12:30:00Z
finished: 2026-09-01T12:55:00Z
---

## Goal

The design's task detail reads **`created via agent · mira-cli`** — the channel
*and* the client. `created_via` is a closed enum
(`web` | `mcp` | `api` | `webhook` | `meeting`) and carries no name, so the most
we can render is `created via api`.

**On a board where agents and humans share one task list, "which agent" is the
attribution that matters.** D-010 makes humans and agents equal participants and
D-007 says agents never self-certify — both assume a reader can tell *who* acted.
Today an agent-created task is indistinguishable from a curl.

## Acceptance criteria

- [x] A task records the client that created it, not only the channel. **Check
      what already exists before adding a column** — `activity.actor_token_id` is
      on every row (§4.8) and tokens are named, so the name may already be
      reachable by join rather than by duplication.
- [x] If it is reachable, expose it and add no column. **A second copy of a name
      that can be derived will drift from the token it came from.**
- [x] Works for tasks created before this lands — old rows have no client and
      must render as `created via api`, not as a blank or "unknown".
- [x] The same treatment for comments if it is free; do not widen if it is not.
- [ ] §4.5/§4.9/§6.4 updated as needed (D-011).

## Notes / context

**M3 is where this becomes real** — tokens are what carry an agent's identity,
and until they land the only writer is a browser session. Worth doing now anyway:
the shape decided here is what M3 populates, and deciding it under load is worse.

**Do not invent a display name from the user agent string.** It is attacker
-controlled and it is not identity.

## Notes back — CORE, 2026-09-01

**Derived, no column** — the criterion's first instruction, and it was reachable:
`activity.actor_token_id` (§4.8) joined to `tokens.name`. The test that makes it
concrete is *"follows a rename rather than keeping the old name"*: a stored copy
would still say `mira-cli` after the token was renamed and nothing would ever
reconcile them.

`null` — never `"unknown"` — for all three causes: browser session, task older
than tokens, token since deleted (`ON DELETE set null` means the audit row
outlives the name). They mean the same thing to a reader, and the honest absence
beats a word invented for it.

**Comments: not done, because not free.** `activity` has a `task_id` column but
no `comment_id` — a comment's id lives in the payload JSON, so the same join
would mean matching serialised text. The criterion said not to widen if it was
not free.

**AC5 (§4.5/§4.9/§6.4) is unticked, and I would like your ruling.** §4.5's table
lists *columns*, and `created_by_client` is deliberately not one, so it does not
belong there. What may be worth a line is §4.9: **`tokens.name` is now a
wire-visible value**, which quietly constrains what renaming or deleting a token
means for anyone reading a task. Proposed rather than assumed — `docs/` is
yours, and I would rather you wrote it than ratified mine. If you would rather
it stayed unsaid, say so and I will tick the criterion as considered-and-declined
with your reason.

**One thing about my tooling, since I have been reporting its output to you.**
The `innerJoin → leftJoin` mutation came back `STAYED GREEN` and I nearly
recorded a test gap. It is not one — `pnpm typecheck` rejects it, and typecheck
is part of `pnpm test` since LAI-136. **My harness runs `npx vitest` directly and
so bypasses the gate I added yesterday.** "Stayed green" from it means "vitest
did not catch it", not "nothing catches it", and I have been reading it as the
stronger claim.

---

## Accepted — CHIEF, 2026-09-01

**Accepted. AC5 answered: yes, it was worth writing**, and the note is now in
SPEC §4.9 — `tokens.name` is wire-visible, renaming a token renames it everywhere
and retroactively, a name is not private metadata, and deleting one removes the
name rather than the attribution.

You were right on both halves: §4.5's table lists **columns** and
`created_by_client` is not one; the real consequence is §4.9's. Asking rather
than writing it was right for the fourth time this session.

**Verified by mutation:** swapping the selected column to `tokens.prefix` goes
red on four, including *"follows a rename rather than keeping the old name"* and
*"survives the token being deleted, without inventing a name"*.

`null` and never `"unknown"` is right — `null` is an absence, `"unknown"` is a
claim, and all three causes mean the same thing to a reader. Declining comments
was right too: `activity` has `task_id` but no `comment_id`, so the join would
mean matching serialised payload text, and the criterion said not to widen if it
was not free.

### This field could not be landed one side at a time

Merging this alone turned **LAI-213** red — `TaskView.created_by_client` served
with the client type not declaring it. And SHELL adding the client line alone
turns the **other direction** red: *"Task.created_by_client is declared and
TaskView does not send it — it will be undefined at runtime."*

**Neither branch can be green alone.** That is the guard working twice over: it
caught the missing field on one side and the ordering constraint on the other,
before either of us met it in `master`.

**Landed by merging both into local `master` before pushing either**, so
`origin/master` never saw the red state — the three worktrees share one object
database, so SHELL could merge my unpushed local master directly. Worth knowing
for the next two-owner field: **the answer is to co-ordinate the merge, not to
loosen the test**, and `clientOmits` would have silenced the guard on the one
field it exists to deliver.

### On your harness

Flagging that `npx vitest` bypasses the `typecheck &&` gate you added in LAI-136
— so *"stayed green"* meant *vitest* did not catch it, not *nothing* did — was
right, as was scoping which past reports it affects.

**The `innerJoin → leftJoin` case is caught twice over:** bare `vitest` fails on
`× compiles at all` (LAI-137's build test, landed yesterday) and `pnpm test`
fails first on `TS2345`. Not a gap.

**And my harness made the same class of error checking yours.** I reported
`tokens.name → tokens.prefix` as staying green. It had not landed — my `perl`
lacked `/g` under `-0`, so it replaced a **comment** on line 361 rather than the
`select` on line 380. Third time this week for that exact mistake. *Confirm the
edit landed where the code reads it*, not that the file changed.

### On the 143ms split

Your version is fairer than mine. Reporting a number without its conditions is
the larger error — and *"measured under what?"* is the question a reviewer is
uniquely placed to ask. Neither of us asked it.

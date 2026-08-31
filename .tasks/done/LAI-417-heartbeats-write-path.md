---
id: LAI-417
title: POST /api/v1/heartbeats — the write path
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-09-01T09:45:00Z
finished: 2026-09-01T10:25:00Z
---

## Goal

M4's hooks need something to talk to. D-023 moved this endpoint out of M5 for
exactly that reason: **the write path ships in M4 so the milestone can be
verified end to end**, and the reading of it — presence, capacity — stays in M5.

`POST /api/v1/heartbeats`, body `{ repo, branch }`, **token auth only**, `202`
(SPEC §9.1, §6.4). The `heartbeats` table already exists (§4.10).

## Deliberately not in this task

- **Branch → task resolution (§9.2) is M5.** `matched_task_id` stays `null`.
  Store `branch` as the plain string it arrives as.
- **Retention pruning is M5.** No cron here.
- **`GET /presence` and `GET /capacity` are M5.** Nothing reads these rows yet,
  and that is fine — the exit criterion is that a heartbeat *is visible in the
  database*, not on a screen.

If you find yourself wanting any of the three, you are past the boundary. Say so
in your log rather than widening.

## Acceptance criteria

- [x] `POST /api/v1/heartbeats` accepts `{ repo, branch }`, returns **`202`**, and
      writes exactly one row with `user_id`, `token_id`, `repo`, `branch`,
      `created_at`. `matched_task_id` is `null`.
- [x] **Token auth only.** A session cookie is refused. §9.1 says "token auth
      only" and §8's hook sends a `Bearer` — a browser has no reason to post one.
      A test proves a valid cookie does **not** work.
- [x] **Every endpoint calls `can()`** (CLAUDE.md §5). If §3.1 has no cell that
      fits, **stop and file against `docs`** — do not reuse a plausible-sounding
      action, and do not skip it. This is the LAI-408 situation and it may recur;
      the answer there was a new §3.1 row written by CHIEF.
- [x] **Metadata only, and nothing more (D-005, §9.1, §13.4).** `repo` and
      `branch` are strings with a sane length bound. Any other field in the body
      is **refused**, not ignored — `.strict()`, the LAI-407 lesson. A test posts
      `{ repo, branch, diff: "..." }` and expects `422`.
- [x] Writes **no `activity` row.** A heartbeat is presence, not an audited
      action, and one row per five minutes per agent would drown the feed. Say so
      in a comment; a reader will otherwise assume it was forgotten.
- [x] `LIMITS.heartbeat` is the policy that applies — `classify` already routes
      `heartbeat:` paths (LAI-138). Confirm it fires here rather than assuming;
      an unbounded presence endpoint is the one most likely to be hammered.
- [x] Tests: happy path `202`, cookie refused, unknown field `422`, oversize
      `repo`/`branch` refused, rate limit applies, row shape correct.
- [x] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test` all green.

## Notes

No new dependencies.

**Read §4.10 and §13.4 before writing the handler.** *"This is the one place
where a tempting feature would cost the trust the product is built on."* If a
field looks useful and is not `repo`, `branch` or a timestamp, the answer is no.

## Notes back — CORE, 2026-09-01

**§3.1's row is CHIEF's half** and lands in the merge commit; the exemption
entry retires itself when it does. **My branch is green** this time — 1344/1344
— because the entry went in from the start rather than after the fact. Verified
it is load-bearing: removing it turns the drift test red.

**Token-only is enforced in the route, not by `can()`.** §9.1 restricts the
*credential* and §3.1 grades by *role*, so `can()` cannot express it. A cookie
resolves a perfectly good actor, which is exactly why the refusal is explicit.

**Two things the mutations found that I had wrong:**

1. **Deleting `assertCan` left every test green.** The action is ✓ for every
   role, so the role never refuses — what refuses is the credential, and there
   was no `read_only` token in the suite. The gate was unguarded. Third place
   this has bitten (LAI-081, LAI-405, here).
2. **A Viewer holding a token stored as `full` is still refused**, because
   `can()` applies `effectiveTokenScope` at *check* time rather than trusting
   the stored row. I expected that to pass; the real behaviour is stronger — a
   token minted while somebody was a Member stops writing the moment they are
   demoted, with nothing revoking it. Now asserted as its own case.

**Nothing was widened.** `matched_task_id` is null, no cron, no `GET /presence`.
The three boundaries the task named are intact.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** Landed with §3.1's `Send own heartbeat` row and its `ORG_ROWS`
mapping in the same commit (D-038), the three-part atomic change the second time.

**Verified their own finding.** Removing `assertCan` *cleanly* — the gate and the
now-unused import — goes red on three, including
**_"refuses a Viewer even holding a token stored as `full`"_**.

### That test is the best thing here, and its history matters

`can()` applies `effectiveTokenScope` at **check** time rather than trusting the
stored row — so **a token minted while somebody was a Member stops writing the
moment they are demoted, with nothing revoking it.** A real security property,
now asserted.

And the credit belongs where CORE put it: they expected that case to pass, **it
failed**, and the failure is what taught them the scope is re-evaluated rather
than trusted. The assertion was written afterwards to pin what the mutation had
just shown. I described it as "passing for a better reason than expected" and
they corrected me — the mutation taught it, not the intent.

### The shape that is now three for three

Deleting the gate left **every test green**, because the action is `✓` for every
role — so the role never refuses; the **credential** does.

> **For a row that is ✓ for every role, the actor that distinguishes allowed from
> refused is a `read_only` token, never a role.**

LAI-081's Viewer, LAI-405's narrowed token, and here. Worth carrying into any
future §3.1 row of that shape.

`heartbeats.token_id`'s foreign key rejecting a synthetic fixture is the schema
catching a fake at the right layer. Nothing widened: `matched_task_id` null, no
cron, no `/presence` — all three correctly left to M5.

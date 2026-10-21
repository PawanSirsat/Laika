## 2026-10-21T12:57:47Z — LAI-835

On the owner's direct instruction (*"do it what is needs to do"*), the last of
the three pieces LAI-831 left out of My day's design. A Claude Code session
dispatched by CHIEF built it, in `Laika-agent-name` on
`LAI-835-proposal-names-its-agent`, on top of LAI-833.

**What changed**
- server/src/db/schema.ts, server/src/db/migrations/0047_time_draft_client_name.sql
  and meta/0047_snapshot.json, meta/_journal.json — `time_drafts.client_name`.
- server/src/services/time-drafts.ts — `proposeTimeDraft` copies the token's
  client, and the draft view serves `client`.
- server/test/services/time-draft-client.test.ts — new.
- server/web/src/api/time.ts — `TimeDraft.client`.
- server/web/src/routes/screens/my-day/DraftRow.tsx, Inspector.tsx,
  my-day-derive.ts — the badge, *"Proposed by …"*, and `evidenceLine`.
- server/web/test/browser/my-day-proposal-client.test.ts,
  server/web/test/routes/screens/my-day/proposal-client.test.ts — new.
- docs/SPEC.md — §4.47's `client_name` row, and §7.1's `propose_time_entry` row.
- .tasks/review/LAI-835-a-proposal-does-not-name-its-agent.md, and this log.

**Decisions**
- A copy of the token's D-076 client name (else its own name), taken at the
  moment of the proposal, exactly as `task_rounds.client_name` does (§4.25).
  The token's live value says which agent connected last, not which proposed.
  It is never anything the proposal says.
- `client` is optional on the web type, so fixtures and a board that predates
  it keep the old words.

**Discovered**
- The 21 Oct release (#1–#6) landed on master mid-work, so all four stacked
  branches took master in turn. The only conflicts were `DECISIONS.md` (D-095
  and D-096 against master's D-097) and SPEC §4 (LAI-836's §4.55–§4.56 against
  §4.57), each resolved by keeping every section in number order. Each
  resolution was checked to drop nothing from either side.
- A pipe in a gate check: `grep … | head; echo $?` printed `head`'s exit
  code, not grep's. The empty output was the evidence, not the 0 — the exact
  trap CLAUDE.md §5 describes.

**State**
In review. The root gate on `fd58d2e1` exited 0, 0, 0. The final-tree gate
follows, then the push and a PR based on LAI-833's branch.

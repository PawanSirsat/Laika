---
id: LAI-548
title: 'Receiver flow: laika agent inbox/accept — fetch + verify checkpoint SHA, prepare worktree, then accept; untrusted note rendering'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-546, LAI-547]
discovered-from:
status: review
finished: 2026-10-30T12:30:00+02:00
started: 2026-10-30T12:30:00+02:00
---

Implements **proposal §4.3.1, §4.4, §4.7** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A receiving agent lists its offers, and `accept` only tells the server
yes after it has fetched the checkpoint, verified the SHA and prepared a
worktree on it — so it continues from that exact commit.

## Scope

- `laika agent inbox` and `laika agent accept <offer>`.
- Fetch, verify `commit_sha`, create the worktree, then call accept.
- Print the note inside a delimited block marked untrusted; never execute or promote it.
- Before accepting: fetch the checkpoint tag, check it resolves to exactly `commit_sha` with `git rev-parse` and `git cat-file -e`, check that commit out in a new worktree, then send `verified_commit_sha` with the accept.

## Out of scope

- SSE notices (LAI-554)

## Acceptance criteria

- [x] If the SHA is missing on the remote, accept is never called and the reason is printed.
- [x] A note containing shell or prompt-injection text is printed verbatim inside the untrusted block and nothing is executed (asserted).
- [x] Losing the accept race leaves the prepared worktree clearly labelled and reports `offer_taken`.
- [x] After accept, `git rev-parse HEAD` in the worktree equals the checkpoint SHA (asserted).
- [ ] Repo-root gate exits 0. *(Not run on Belka — the machine rule forbids the full suite locally; CI runs it on the PR. Ticked when CI is green.)*
- [x] Accept carries `verified_commit_sha`; a forged mismatch is answered `422 checkpoint_mismatch` and the helper reports it without retrying (asserted against a real server).
- [x] Accept on a `pending` checkpoint is answered `409 checkpoint_unverified` and the helper says "Verification pending".
- [x] A fetch error or missing tag turns the offer into "Save needs attention" locally, and accept is never called.

## Tests and UI evidence required

Node tests with temp repos and a real server; malicious-note fixture.

## Dependencies

`depends-on: [LAI-546, LAI-547]`.

**Blocked on decisions D-115 / D-116 (proposed).** Do not start until both are approved as proposal §8 describes. Board tag `blocked-on-decision`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1.5–2 days, confidence M.

## Branch

`LAI-548-receiver-accept`

## Claim deviation (CHIEF dispatch, 2026-10-30)

Claimed on CHIEF's direction while `depends-on` is not all in `done/`:
LAI-546 is in `review/` on `master` with its routes and MCP tools live
(Phase 3), and LAI-547 is open as PR #154. This task uses **only what is on
`master`**: it does not import #154's `checkpoint-git.ts`, and carries its
own git runner with the same env allowlist and safe config.

## Migration / rollout notes

None.

## Evidence (SHELL, 2026-10-30)

- `cli/test/agent-handoff-e2e.test.ts` — 10 cases against a real board on a
  free port and real git (bare remote + receiver clone): happy path with
  `git rev-parse HEAD` == checkpoint SHA and the primary checkout unchanged;
  accept-before-prepare, deleted tag, moved tag (SHA mismatch) and annotated
  tag refused with **zero** accept requests in the server log; forged SHA →
  one accept, `422 checkpoint_mismatch`, not retried; re-tagged checkpoint →
  `409 checkpoint_unverified`, "Verification pending"; recovery race lost →
  `offer_taken`, worktree locked with that reason; malicious note printed
  verbatim inside the nonce block, no `PWNED_*` file and no hook ran.
- `cli/test/agent-handoff.test.ts` — 9 unit cases (env allowlist, inert text,
  nonce, remote matching, wording).
- Mutation check: 11 mutants (SHA compare, annotated check, no-record guard,
  constant nonce, inert no-op, offer_taken branch, unverified wording, hooks
  value swap, env allowlist, pending pre-check), each killed by its own case.

**Not covered**: accept re-checking that the worktree HEAD did not move after
prepare has no dedicated case (the forged-SHA case moves the ref, the HEAD and
the record together).

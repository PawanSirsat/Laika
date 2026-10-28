---
id: LAI-548
title: 'Receiver flow: laika agent inbox/accept — fetch + verify checkpoint SHA, prepare worktree, then accept; untrusted note rendering'
area: cli
assignee: unclaimed
priority: p1
depends-on: [LAI-546, LAI-547]
discovered-from:
status: backlog
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

- [ ] If the SHA is missing on the remote, accept is never called and the reason is printed.
- [ ] A note containing shell or prompt-injection text is printed verbatim inside the untrusted block and nothing is executed (asserted).
- [ ] Losing the accept race leaves the prepared worktree clearly labelled and reports `offer_taken`.
- [ ] After accept, `git rev-parse HEAD` in the worktree equals the checkpoint SHA (asserted).
- [ ] Repo-root gate exits 0.
- [ ] Accept carries `verified_commit_sha`; a forged mismatch is answered `422 checkpoint_mismatch` and the helper reports it without retrying (asserted against a real server).
- [ ] Accept on a `pending` checkpoint is answered `409 checkpoint_unverified` and the helper says "Verification pending".
- [ ] A fetch error or missing tag turns the offer into "Save needs attention" locally, and accept is never called.

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

## Migration / rollout notes

None.

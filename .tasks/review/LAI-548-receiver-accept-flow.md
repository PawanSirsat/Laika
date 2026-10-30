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
- [x] Repo-root gate exits 0. *(Run by CI, not on Belka: PR #158, run 41017000854, Gate — test, lint, format: success at 2daed9f8.)*
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

## Review round 1 — Codex FAILED #158 at 5538142c; fixed (SHELL, 2026-10-30)

Passed by Codex and unchanged: argv-only git, the env allowlist, no token
reaching git, no accept retry, the primary checkout/index/.env untouched,
ANSI/OSC/C1 escaping, harness dedupe, the capability matrix.

| # | Finding | Fix | Regression (e2e unless noted) | Mutant |
| --- | --- | --- | --- | --- |
| 1 | P1 checkout ran `.gitattributes`-selected filters | `--attr-source=<empty tree>` on every call, `core.attributesFile=/dev/null`, `GIT_ATTR_NOSYSTEM=1`; a repo whose `info/attributes` sets anything is refused before the fetch; the worktree must show no difference | smudge/clean/process probe in the receiver's config, `* filter=evil` in the checkpoint: no file made, blob on disk as committed; `info/attributes` refused | attr-source swapped out → case 10 red; info/attributes check off → case 11 red |
| 2 | P1 replace refs | `GIT_NO_REPLACE_OBJECTS=1` and `core.useReplaceRefs=false` on every call | `git replace <ckpt> main` in the receiver: HEAD's real tree is the checkpoint's | both removed → case 12 red |
| 3 | P1 named-remote refmap wrote a branch | fetch by URL, `--refmap=`, the URL's rewrite neutralised; all other refs, HEAD and FETCH_HEAD compared before/after | `+<ckpt ref>:refs/heads/valuable` configured: valuable unmoved, only the private ref and the new branch differ | name + no `--refmap=` → case 13 red (by the snapshot); also snapshot off → case 13 red (valuable moved). Fetch-by-name alone survives: `--refmap=` alone blocks it (layered) |
| 4 | P1 suffix match on the URL | exact github.com https/ssh/scp forms for the configured owner/repo, rebuilt; a local path only at `<root>/<owner>/<repo>(.git)` after realpath under the operator's `LAIKA_HANDOFF_LOCAL_REMOTE_ROOT` | attacker.invalid refused; `insteadOf` to a same-suffix local copy refused; unit: 16 bad URLs, symlink and `..` | any host → unit red; suffix compare → case 14 red |
| 5 | P2 bidi controls | U+202A–202E, U+2066–2069, U+200E/F, U+061C, U+200B–D, U+2060–2064, U+FEFF escaped | unit: each code point, trojan-source shape | old class → unit red |
| — | crash recovery | record written `preparing` before anything is made; the next prepare removes its own worktree (`worktree remove`, never `--force`) and branch (`update-ref -d` conditional on the SHA) only while exactly as made | status forced to `preparing` → redone; an untracked file in the worktree → refused, file kept | recovery off → case 15 red |
| — | failed lock reported | `label` answers the failure; offer_taken and decline print "could NOT be locked" | pre-locked worktree, decline | silent lock → case 16 red |

Needs git ≥ 2.40 for `--attr-source`; an older git rejects the option, so
prepare fails closed.

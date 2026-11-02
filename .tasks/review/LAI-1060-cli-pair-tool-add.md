---
id: LAI-1060
title: 'Developer access V3 slice C3: laika device pair, laika tool add, installer without credentials (cli + plugin)'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-1050, LAI-1056]
started: 2026-11-02T05:43:33+05:30
status: review
finished: 2026-11-02T06:00:00+05:30
---

Slice C3 of `docs/proposals/LAI-1042-developer-access-v3-plan.md` (§A7, §A8,
§A22, §F.3, §F.4, §F.6, §J slice C, §K, §L2, §M).

**The dependency deviates from the claim rule.** LAI-1056 (PR #211) is in
review, not in `done/`. The owner's dispatch stacks this branch on
`LAI-1056-tool-setup`; the PR targets that branch and is retargeted to
`master` after #211 merges. LAI-1050 (#205) is on `master`.

**Out of scope:** the web (Devices tab, Add tool UI), `laika project check`
(C4), the installer's default board IP (LAI-627), the master-red timeouts
(LAI-1059), Advanced/Activity web files (LAI-1058).

## Scope (SHELL: `cli/`, `plugin/scripts/install.sh`, `plugin/scripts/laika-claude`)

1. `laika device pair --board <url> --code <code> [--name X] [--cloud] [--replace]`:
   an Ed25519 key made here (`node:crypto`), the private half 0600 under
   `~/.laika/device/` and never printed or sent; claim; the fingerprint
   computed here and printed, with a stop if the board's differs; poll;
   complete by signing `laika-pair-v1`. A claimed code says "Someone else
   claimed this code — deny the request in the browser and start again".
2. `laika tool add <harness> --exchange <id> [--no-hooks] [--dry-run]`: redeem
   by signing the `laika-tool-redeem-v1` challenge; the token goes straight to
   `~/.laika/agents/<harness>.json` 0600 and nowhere else; `~/.laika/env` is
   never written. Claude Code (hooks, restart note, `laika-claude` prefers
   the tool credential only when `tool add` wrote it), Codex (own env var,
   an existing entry kept, `/hooks` trust note), Omnigent (credential only),
   Antigravity and tools with no CLI harness refused before redeeming. A
   client report after setup.
3. `install.sh --no-credential`, documented as the V3 path; the legacy path
   (and `laika connect`) back up `~/.laika/env` before rewriting it; the PATH
   line is added once.
4. `cli/README.md`: the real fresh-install bootstrap.

## Acceptance

- [x] Pairing happy path end to end against a stub board that verifies the
      Ed25519 signature; the fingerprint printed is computed locally, and a
      board that reports a different one is refused.
- [x] The private key never appears in stdout, stderr, argv or any request
      body; only signatures leave.
- [x] `pairing_already_claimed` prints the exact instruction.
- [x] Redeem writes the token only to the per-harness file, 0600; zero `lai_`
      in stdout/stderr and in any file outside `~/.laika/agents/*.json`.
- [x] `~/.laika/env` is byte-identical after `tool add`.
- [x] Config backups are made once and other MCP servers are untouched.
- [x] Antigravity is refused before redeeming; Omnigent is credential only.
- [x] `install.sh --no-credential` writes no `~/.laika/env`; the legacy path
      backs it up; the PATH line is added once.
- [x] `cli` typecheck and lint green; each touched test file green, single
      worker; CI green.

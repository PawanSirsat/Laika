---
id: LAI-1085
title: 'laika update on a checkout already at the board''s build still sends each tool''s version report'
area: cli
assignee: shell/belka
priority: p2
depends-on: [LAI-1068]
discovered-from: LAI-1068
status: review
started: 2026-11-02T11:44:45Z
finished: 2026-11-02T11:56:45Z
---

## Why

Found live on Belka (owner, 2026-11-02): `~/laika` is at `ec91f053`, the
board's own build, and the V3 Devices tab shows **Version unknown** for its
tools — and will until the next release. `laika update` returns early on
**Up to date** (`cli/src/update.ts`, the `head === target.commit` branch in
`go()`), before the client report LAI-1068 added after a successful switch.
So a machine updated with plain `git`, or set up before `laika tool add`
existed, has no command that tells the board what its tools run.

## Acceptance

- [x] `laika update` (not `--check`, not `--dry-run`) that finds the checkout
      already at the board's commit still sends one client report
      (`POST /api/v1/agents/me/client-report`, SPEC §4.81) per installed tool
      credential (`~/.laika/agents/<harness>.json`) whose board origin is the
      board the update asked — the same rules as LAI-1068: each credential's
      own saved token, never one from the environment, only to that board,
      never printed, and only when the manifest says `client_reports`.
- [x] Version, commit and protocol come from the checkout's own
      `laika version --json`, and its commit must be the board's commit.
- [x] One line says what happened: sent (for which tools), or skipped and
      why (the board takes no reports; no tool here is set up for this board;
      the version could not be read). A failed report never changes the exit
      code (`0`).
- [x] `--check` and `--dry-run` on an up-to-date checkout send nothing.
- [x] Tests: the up-to-date path sends one report per installed tool to the
      right board; a credential for another board is skipped; a report
      failure keeps exit 0; `--check` and `--dry-run` send nothing; a test
      fails if the early return is put back before the report step.
- [x] `cli/README.md` (the `laika update` section) says so.
- [ ] cli typecheck, eslint and prettier exit 0; PR into `master`, CI green.

## Notes

- Area `cli` only: `cli/src/update.ts`, `cli/test/update.test.ts`,
  `cli/README.md`. No new dependency. No server change: the endpoint and the
  manifest flag exist (LAI-1056, LAI-1062).
- Optional in the dispatch: `laika doctor` suggesting `laika update` when a
  tool has never reported — only if cheap and read-only.
- **Claimed with `depends-on` not in `done/`** (§2 step 1): LAI-1068 sits in
  `.tasks/review/` on `master`, but its code is merged there (PR #222,
  `c95a91c6`) and the owner's dispatch names it as the base this builds on.
  Recorded here rather than read loosely.

## Notes (SHELL on Belka, at review)

- Last criterion: typecheck, eslint and prettier exit 0 locally (on the
  changed files; Belka runs no full suite); the PR and its CI result are on
  the card (LAIKA-938). Left unticked here because ticking it after CI would
  be one more commit for CI to re-run.
- Files: `cli/src/update.ts`, `cli/test/update.test.ts`, `cli/README.md`, and
  one sentence in `cli/src/client-report.ts`'s header, which said a report is
  sent only "once the checkout has moved" — no longer true.
- The `laika doctor` hint is **not built**: doctor has no read of whether a
  tool has reported. The board's per-agent detail (`GET /agents/:id`) is the
  owner's read, not the tool token's, so it would be a new request and a new
  shape for doctor — not the "cheap and read-only" the dispatch allowed.
- Mutations run (each anchor confirmed, file restored by checksum): early
  return put back before the report → 6 of the 7 new tests red; the
  `--dry-run` guard removed → `--check and --dry-run send nothing` red; the
  catch rethrowing → the version-throw assertion red.

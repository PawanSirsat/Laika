---
id: LAI-1065
title: 'Developer access V3 slice E3: update status on device and tool rows, What''s new, Copy update command'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1043, LAI-1051, LAI-1054, LAI-1056, LAI-1061]
discovered-from: LAI-1042
status: review
finished: 2026-11-02T06:48:44+05:30
started: 2026-11-02T06:33:17+05:30
---

## Why

Slice E3 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §H, §F.5, §E.6, §E.7,
§J slice E, §K). The board serves its compatibility answer (LAI-1043: build
commit, protocol, `cli.min_protocol_for`, `cli.source.commit`,
`release_notes`), each tool's self-reported client report through
`GET /agents/:id/verification` (LAI-1056), and `laika update` exists
(LAI-1051). The Devices tab still says *Version unknown* on every row.

Stacked on LAI-1061 (PR #215, in review): it adds the web's verification
client and `cli.source` reader, which this reuses rather than duplicating.
None of LAI-1061's files are edited except the tool row and device card in
`DevicesTab.tsx`. `server/` is untouched (LAI-1062 is fixing the feature
flags there).

**Renumbered from LAI-1063** (§3): another session filed LAI-1063 on the
board at 06:31:58 and in git at 06:32:06, before this was filed at 06:33:17.
Three pushed commits on this branch still carry `[LAI-1063]` and are this
task's, not that one's: `da0e2577` (the stack merge), `abeed4a3` (filing),
`2dc406b4` (claim). The branch `LAI-1063-update-status-ui` was renamed
`LAI-1065-update-status-ui`.

## Acceptance criteria

- [x] `v3` and `preview` only; classic unchanged; no separate Updates tab.
- [x] Each active tool row shows a local-integration update status,
      separate from its connection status, in words with a reason: *Up to
      date*, *Update available* (what it does now keeps working), *Update
      required for <feature>* (only when a feature the board has switched on
      needs a newer protocol than the tool reported), *Version unknown* (no
      report — never *outdated*), *Could not check* (compatibility or
      verification fetch failed) with *Retry*.
- [x] Compared only against the board's own `cli.source.commit`,
      `protocol` and `cli.min_protocol_for` — never "newest GitHub".
- [x] The device card summarises its tools' update statuses.
- [x] *What's new* from `release_notes.whats_new`; *Copy update command*:
      `laika update --check` then `laika update`, with `--allow-http` only
      when the board is plain http off loopback, and why; no secret in it.
- [x] Post-update guidance: re-run `laika doctor`; the row refreshes when a
      new report arrives (polled, throttled live region).
- [x] Board update shown only to org owner/admin, only when the data says
      the board is behind a helper; omitted otherwise.
- [x] Presence off: no report time is shown.
- [x] Keyboard, both themes, 390 px, colour never the only signal.
- [x] Tests: each status from fixture combos; never *outdated* without a
      report; feature-specific *required*; copy command holds no secret;
      classic untouched. Screenshots light + dark, desktop + 390 px, per
      status, in `.polly/evidence/LAI-1065/`.

## Review round 1 (PR #218) — answered in `a295e6f1`

- **B1**: a helper at the board's protocol on another commit was *Update
  available*, offering a `laika update` the CLI refuses when the target is not
  ahead of the checkout. Now *Up to date*, naming both commits, with no
  update offered. A neutral *Runs another helper* status was rejected: the
  board needs a protocol, not a commit, and plan §H says "or protocol
  current". *Update available* is only `min_client ≤ protocol < current`.
  The test that pinned the old behaviour is reversed; a fork/newer-commit
  case is added.
- **N1**: the watch is `watchForReport` in `update-status.ts`, on an
  injected clock. Unit tests fire each timer and check the waits (15/30/60 s,
  then the 120 s cap), 18 reads and a stop at the 30-minute limit, a failed
  read retried, and `cancel` clearing the pending wait and ignoring a read in
  flight. A browser test checks that leaving the tab stops it. A first
  browser-clock version failed on CI (`2de5de4f`, web 3/4): the next wait is
  set only after the page handles a read, which a test cannot observe.
- **N3**: one wording for the protocol on every side; `ReportFacts` says the
  time is hidden server-side.
- Fixtures mirror the protocol-2 board #216 serves.

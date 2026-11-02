---
id: LAI-1062
title: 'The compatibility manifest says device_pairing and tool_setup_exchange are off while both routes serve'
area: server
assignee: core
priority: p2
depends-on: [LAI-1056]
discovered-from: LAI-1060
status: in-progress
started: 2026-11-02T00:57:59Z
---

`server/src/services/developer-compat.ts` builds `features` as every name in
`FEATURE_NAMES` set to `false` ("each `false` until its slice lands", plan
LAI-1042 §J), and `PROTOCOL.current` is still `1` ("No feature behind
protocol 2 exists yet"). On `LAI-1056-tool-setup` (stacked on LAI-1050, now
on `master`) both features exist: `POST /device-pairing/claim`, `/complete`,
`POST /tool-setup/:id/redeem` and `POST /agents/me/client-report` all answer.

So a helper that follows plan §F.3 step 1 ("if `features.device_pairing` is
false, stop") refuses on every board. LAI-1060's `laika device pair` and
`laika tool add` therefore do **not** gate on the manifest; they detect an old
board by its answer (no Laika JSON → "does not support device pairing yet").

## Scope (CORE)

- `features.device_pairing`, `tool_setup_exchange` and `client_reports` say
  what this build serves, and `PROTOCOL.current` moves with them, or the
  manifest's comment says why they stay off.
- `server/test/...developer-compat*` asserts it.

## Acceptance

- [ ] The manifest's features match the routes this build serves.
- [ ] LAI-1060's CLI note (`cli/src/device.ts` header) is revisited by SHELL
      once this lands: gate on the manifest, keep the answer-based fallback.

## Claim notes

- **Re-filed here (CLAUDE.md §2/§3 two-copy rule).** This file existed only on
  the unmerged `LAI-1060-cli-pair-tool-add` branch, at `.tasks/backlog/`. It is
  added here at `.tasks/in-progress/`; whoever merges both deletes the
  `backlog/` copy, which is the one furthest back.
- **`depends-on: LAI-1056` deviation.** LAI-1056 sits in `.tasks/review/` on
  `master`, not `done/`, but its code is merged (PR #211) and every route this
  task reports on is mounted on `master`. Claimed on the orchestrator's
  direction (polly dispatch, board card LAIKA-916).


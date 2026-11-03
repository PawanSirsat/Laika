---
id: LAI-1103
title: 'Launcher: wake an existing local Omnigent session for a selection (D-117a item 10)'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-1039, LAI-1101]
discovered-from: LAI-1039
status: backlog
---

## Goal

D-117a item 10 and plan slice B (`cli/src/agent-omnigent.ts`): when an
Omnigent agent's auto-pickup is off, a selection may still reach an
**existing** local Omnigent session as a notice. LAI-1039 shipped the
launcher's work-request pickup, presence and ping answers, and starts
`omni polly -p` as a harness (`prompt_via: argv`), but **not** the wake: the
Omnigent server's discovery and the `/v1/sessions/{id}/events` payload were
not verifiable from this machine without the owner's Omnigent investigation,
and the route is internal (`include_in_schema=False`).

## Acceptance criteria

- [ ] `cli/src/agent-omnigent.ts`: find the local Omnigent server and a live
      session for this agent; refuse unless `omni --version` is 0.19.x.
- [ ] POST to `/v1/sessions/{id}/events` on **loopback only** (a non-loopback
      URL is refused before any request), fixed words built from
      `noticeLine` (validated fields only, ≤ 300 characters), never retried
      after a 4xx or 5xx.
- [ ] Off unless the config says `"omnigent": {"wake_sessions": true}`;
      `enable` asks.
- [ ] `cli/test/agent-omnigent.test.ts` against a fake loopback server, with
      the plan's mutations red: wake a non-loopback URL; skip the version gate.
- [ ] Repo-root gate exits 0.

## Notes / context

Plan: `.polly/plans/auto-pickup-capacity.md` §7 (D-117a item 10), §8 B.
LAI-1101 (slice D) ships the Omnigent wiring this builds on.

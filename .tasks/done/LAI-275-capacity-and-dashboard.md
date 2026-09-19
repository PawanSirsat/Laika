---
id: LAI-275
title: Capacity and the Dashboard to the design; the metrics endpoint gets a caller
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-274
started: 2026-09-18T19:55:00Z
finished: 2026-09-18T20:10:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

Screens 6 and 7 of the owner's page-by-page pass. Prototype lines 647–718
(Capacity) and 719–816 (Dashboard).

**Capacity** was two flat lists — *who is here* and *who is free*. Both are real
questions and neither joins up for one person, which is what the design's card
does: who they are · what they are working on · their agent session · what is in
progress, in four panels across one row.

**The Dashboard** was missing the three panels the design leads with: RELEASE
PROGRESS, THROUGHPUT and WHO IS CARRYING WHAT. The first two are the ones a
reader can act on without reading anything else.

## What

- Capacity: the design's summary bar (ACTIVE NOW · AGENT SESSIONS · UNLISTED
  WORK) and one card per person at the design's panel widths (236 / 290 / 196 /
  flex), with the amber unlisted-work strip.
- Dashboard: RELEASE PROGRESS with a three-segment bar, THROUGHPUT from
  `GET /projects/:slug/metrics`, and WHO IS CARRYING WHAT.
- `src/api/metrics.ts` — **this closes LAI-457.** The endpoint has been served
  since LAI-124 and had no caller; its `NO_BROWSER_CALLER` entry is deleted,
  which is the guard proving the closure rather than a comment claiming it.

## Acceptance criteria

- [x] Capacity renders one card per person, at the design's four panel widths.
- [x] The summary bar's three figures are counted from what the API sent.
- [x] The Dashboard shows release progress, throughput and per-person load.
- [x] Throughput comes from the metrics endpoint; its `NO_BROWSER_CALLER` entry
      is gone and `endpoint-coverage.test.ts` is green.
- [x] `cycle_time: null` renders as a sentence, never as `p50 0m`.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**Three defects the tests caught in this rewrite, all mine:**

1. **A human was badged as an agent.** I marked the badge on
   `active_sessions > 0`; the fact it claims is `is_agent`, which is
   `tokenId !== null`. A session count is not the same statement.
2. **"Enabled and quiet" lost its sentence.** Removing the old list removed
   *"No sessions in the last five minutes"*, which is the only thing that
   distinguishes a recording org with nobody beating from an org with presence
   switched off (LAI-150). An empty list beside a bar of zeroes reads as both.
3. **A withheld location read as "on no particular task".** There are three
   states, not two (LAI-438), and `hasLocation` is the one rule that tells the
   first apart — it tests `repo` because `matched_task_id` and `project_ids`
   arrive `null`/`[]` either way.

**`PresencePerson`'s `row` variant now has no caller.** The design's identity
panel is not a presence row — the repo and branch belong in WORKING ON — so
Capacity stopped using it. Filed rather than deleted mid-pass: LAI-276.

**Meeting review was inspected and left alone.** It already matches the design's
intent — session list, kind chips, the transcript quote per proposal, per-item
accept. The design's separate TRANSCRIPT panel is **not buildable**: the API
stores a `transcript_hash`, never the transcript, so the per-proposal quote is
the whole of what can honestly be shown. It rendered empty only because no
meeting had been submitted; seeded one on the demo instance to check.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

---
id: LAI-280
title: The activity feed is bounded, and its rows read as the design's
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-279
started: 2026-09-18T21:35:00Z
finished: 2026-09-18T21:50:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

Owner report with two screenshots: the dashboard's activity list rendered all
**193** events as 193 rows, so the page ran to five screens, the rail floated
beside a column of repetition, and nothing else on the screen could be seen at
the same time. *"Add the scroll or the pagination."*

The reference is a card of fixed height whose rows scroll inside it
(prototype line 765) — everything on this screen stays on this screen.

Two smaller things in the same shot:

- Every row led with a `USER` badge — the same word on nearly every row, in the
  position the eye reads first. The design leads with the **time** and carries
  who in the avatar.
- The rail's cards were plain; the design tints their headers (amber for stale,
  purple for the agent log) and puts the count on the right.
- `Needs a decision` listed key-above-title-above-blocker. The design leads with
  the **figure and the age** — *how many, and how long has the oldest waited* —
  then one line per item.

## What

- `.dash-feed-scroll`: `max-height: min(24.5rem, 42vh)` with internal scrolling.
  **Scroll, not pagination**: every event stays reachable without a control to
  learn, and the panel keeps its shape at three events or three hundred.
- The row is the design's: **when · who · what · which task**, the agent mark on
  the avatar, and the actor-kind badge gone.
- The rail's tinted headers; `Needs a decision` leads with the count and
  `oldest Nh`.

## Acceptance criteria

- [x] The feed scrolls inside its card; the rows are all still reachable.
- [x] **Doubling the events does not change the page height** — the property
      the owner actually reported.
- [x] A row reads time → avatar → sentence, left to right.
- [x] An agent's row is marked and a person's is not.
- [x] The filter counts reconcile: `All === People + Agents`.
- [x] Page overflow `0` at 1600 / 1440 / 1280 / 900 / 420; both themes.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**The first two versions of the height test were both wrong, in opposite ways.**

*"The page fits the viewport"* failed at 930px against the harness's 720px — and
it deserved to: on a short window some scrolling is honest, and that assertion
just encodes one machine's screen.

*"180 events look like 3"* failed too, and **that failure was the test being
wrong, not the code**: a panel is *allowed* to grow up to its cap, and below the
cap a longer feed being a taller card is correct. The defect was growth with no
cap.

So the assertion is now **two feeds that both exceed the cap** — 180 events and
360 — and the page must be the same height to the pixel. That is the owner's
report stated as a property, and it cannot be satisfied by a feed that fails to
render (a positive control asserts the rows loaded first).

**`max-height` is viewport-relative for the same reason.** A fixed 24.5rem is
nine rows on a tall screen and taller than the whole window on a short one.

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

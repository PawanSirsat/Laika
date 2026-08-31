---
id: LAI-227
title: No web test can click anything
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-424
status: in-progress
started: 2026-08-31T22:03:48Z
---

## Goal

**Two p1 defects in a row were interactions that did nothing, and 481–528
passing tests said nothing about either.**

- **LAI-423** — every nav click dropped `?project=`. `nav-truth.test.ts` asserts
  *which* destinations the nav lists and passed throughout. Nothing asserted
  that clicking one takes you where you were.
- **LAI-424** — the only clickable part of a task card was a key covering
  **3.6%** of it. The most-used interaction on the board did nothing.

The cause is structural, not carelessness: `@laika/web` runs on `node --test`,
which strips types from `.ts` but **cannot import `.tsx`**. So no test in the
suite renders a component, and therefore no test can click one. Every guard we
have reads source or CSS as text.

Both fixes were verified by driving a real browser by hand, and both were
*written* against source-shape assertions. That works and it is not enough — a
source assertion can be green while the geometry is wrong. LAI-424 proved it
twice in one sitting:

- `.card-key { position: relative }` made the key the containing block for its
  own overlay, so `inset: 0` sized the hit area back to the key. **Every CSS
  assertion still passed.** Only `elementFromPoint` in a browser caught it.
- The cursor assertion matched a *comment* inside the rule that read
  "the design file uses `cursor:pointer` 46 times", so it stayed green when the
  declaration was mutated back to `grab`. A test satisfied by its own
  explanation.

## Acceptance criteria

- [ ] A web test can mount a component and click it. **Name the dependency in
      this task before adding it** — CLAUDE.md §5 forbids adding one otherwise,
      and this task is where that decision gets made and recorded.
- [ ] A regression test for **LAI-424**: click the card *body* — not the key —
      and assert the panel opens. This is the test LAI-424's AC7 asked for and
      could not have.
- [ ] A regression test for **LAI-423**: from a project's board, click each nav
      entry and assert the project is unchanged.
- [ ] Both must **fail** against the pre-fix code. Check out the parent of each
      fix commit and show them red; a regression test that has never seen the
      regression is a guess.
- [ ] The runner is part of `pnpm test`, not a separate command someone
      remembers to run.

## Notes

Options worth weighing, and this is the decision, not a formality:

- **`node:test` + `jsdom` + a React test renderer** — no browser, fast, runs
  where the suite runs. Cannot catch the `inset: 0` bug, because jsdom has no
  layout: `getBoundingClientRect` returns zeros and `elementFromPoint` is not
  implemented. **It would have caught neither of the two mistakes above.**
- **Playwright against the built SPA** — a real engine, real layout, real
  `elementFromPoint`. Catches both. Heavier, needs a browser download in CI, and
  needs the server running.

The second is the one that would have caught what actually went wrong. That is
the argument to weigh, not "unit tests are lighter".

Do not let this task turn into a general testing-strategy rewrite. Two clicks,
proven red first.

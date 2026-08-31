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

---

## The dependency decision — SHELL, 2026-09-01

The task says this is where the choice gets made and recorded. Here it is, with
a correction to my own filing first.

### Correction: jsdom is not worthless, and my task text overstated it

I wrote that jsdom "would have caught **neither**" of the LAI-424 mistakes. That
is true of those two specifically and I generalised it too far. Judged against
the four occurrences that justify this task:

| occurrence | jsdom + a React renderer | Playwright |
| --- | --- | --- |
| **LAI-424** hit area — the fix is `::after { inset: 0 }` | **No** | **Yes** |
| **LAI-424** `.card-key { position: relative }` shrinking the hit area | **No** | **Yes** |
| **LAI-423** nav dropping `?project=` | partly — the rendered `href` is assertable, a real navigation is not | Yes |
| **LAI-410** the secret surviving in React state | **Yes** — React runs under jsdom, so the fibre walk works there too | Yes |
| **LAI-412** a 242-line panel with no test at all | Yes | Yes |

So jsdom reaches most of it. **What it cannot reach is CSS geometry**, and that
is not a gap that closes with effort: jsdom has no layout engine at all —
`getBoundingClientRect` returns zeros and `elementFromPoint` is unimplemented.
The LAI-424 fix lives *entirely* in CSS geometry, and both mistakes I made
building it were geometric while every source assertion stayed green.

**That decides it.** The one class jsdom structurally cannot reach is the class
that produced a p1 the owner hit, and in a project whose stated job is matching
a design, it is the class most likely to recur.

### The dependency

**`playwright`**, as a devDependency of `@laika/web`, driven from the existing
`node:test` runner.

**Not `@playwright/test`.** That is a second test framework — its own runner,
config and assertions — and this repo has two runners already. Playwright as a
*library* under `node --test` adds a capability without adding a way of writing
tests.

### The cost, measured

The web suite is **1.07s** today (559 tests); typecheck is 1.68s. A browser
changes that by roughly an order of magnitude: launch, an SPA build, and a
server on an ephemeral port. Expect **seconds to tens of seconds**.

That is the real price and it is worth stating plainly: the fast inner loop is
lost for `pnpm test`. It is still available — `node --test` on a path is what
anyone iterating actually runs — but the honest headline is that the suite stops
being instant.

There is no CI in this repo yet, so the browser download is a local cost today
and becomes a CI cost the moment one exists.

### What it does not cover

A harness that can click **cannot tell you a colour is wrong in dark mode**. It
can assert a computed value, but not that the value is the right one — that
still needs a person looking, or a token test comparing against
`docs/design/README.md`. It also cannot judge layout *quality*: the LAI-426
timeline rendered perfectly and was still the wrong answer.

**This does not retire browser verification by hand.** It retires *re-verifying
by hand what has already been established once*.

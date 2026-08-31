---
id: LAI-227
title: No web test can click anything
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-424
status: done
started: 2026-08-31T22:03:48Z
finished: 2026-09-01T05:10:00Z
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

- [x] A web test can mount a component and click it. **Name the dependency in
      this task before adding it** — CLAUDE.md §5 forbids adding one otherwise,
      and this task is where that decision gets made and recorded.
- [x] A regression test for **LAI-424**: click the card *body* — not the key —
      and assert the panel opens. This is the test LAI-424's AC7 asked for and
      could not have.
- [x] A regression test for **LAI-423**: from a project's board, click each nav
      entry and assert the project is unchanged.
- [x] Both must **fail** against the pre-fix code. Check out the parent of each
      fix commit and show them red; a regression test that has never seen the
      regression is a guess.
- [x] The runner is part of `pnpm test`, not a separate command someone
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

---

## Build note — SHELL, 2026-09-01

### Both tests shown red against the real pre-fix code

Not against a mutation — against the commits themselves, files restored from
`git show`, SPA rebuilt, run, restored.

| test | pre-fix commit | result |
| --- | --- | --- |
| card body opens the task | `e14f246` (parent of the LAI-424 merge) | **red** — *"the pixels over the card title do not belong to the open control"* |
| nav keeps the project | `e1b6192` (before LAI-423) | **red** — *"the href drops the project: /sprints"* |

Both green again after restoring. **The dependency is earned**: these reproduce
the two defects that justified it, in the terms the defects actually took.

### I got the cost wrong, and in the generous direction

I told CHIEF "seconds to tens of seconds". Measured:

| | before | after |
| --- | --- | --- |
| web suite | 1.07s / 559 tests | **1.48s / 562 tests** |
| from a fresh checkout (no build output) | — | **2.42s** |

**+0.41s**, not an order of magnitude. One browser is shared per file, the SPA
is already built in the normal case, and headless Chromium launches in about
300ms. I would rather have overstated it than understated it, but the estimate
was wrong and the number is what should be quoted.

The CI cost is unchanged and still real: `playwright` downloads a browser on
install (~150MB). No CI exists in this repo yet, so whoever adds one meets that
as a known price.

### Two shell mistakes while proving the reds, both caught

Worth recording because both produced a **result that looked valid**:

1. `$PRE:server/web/...` — zsh read `:s` as a substitution modifier, `git show`
   failed, the build failed, and the test went red **for the wrong reason**. A
   red that proves nothing looks exactly like a red that proves everything.
2. `for f in $FILES` — **zsh does not word-split unquoted variables**, so the
   loop body never ran, the pre-fix files were never installed, and the test
   passed. **A green that proved nothing.**

Both redone with the iteration in Python. This is the week's lesson in its
sharpest form: the second failure would have let me report "shown red" on a run
that never touched the pre-fix code.

### What the harness is, and is not

`test/browser/harness.ts` serves the **built** SPA over a loopback server on an
ephemeral port, with a **stubbed API**. It does not boot `@laika/server`: these
tests are about what the client renders and how it responds to a click, the
server has its own 1360 tests, and booting it would make this suite own a
database. The risk of the stub drifting from the real API is what
`view-type-drift.test.ts` already covers, in both directions.

An unstubbed route **404s loudly** rather than returning an empty body, so a
missing fixture cannot look like an empty screen.

**It cannot judge whether a colour is right in dark mode** — only read the
computed value. And it cannot judge layout *quality*: LAI-426's timeline
rendered perfectly and was still the wrong answer. **This retires re-verifying
by hand what was already established once. It does not retire looking.**

### `test/browser/` is named in the structure rule, not exempted from it

`test/` mirrors `src/` so a test's location says what it covers. `browser/` is
organised by **how** it tests instead — the same exception `helpers/` already
had — so both are now named in `structure.test.ts` with the reason. Mirroring
`src/` would scatter three files and hide the one thing worth knowing about
them: that they are the slow ones that launch Chromium.

### The dependency

`playwright@1.62.1`, pinned exactly. It pulled **`playwright` and
`playwright-core` only**, plus `fsevents` (an optional macOS file-watcher that
comes with it). Nothing unexpected, so nothing to stop for.

---

## Accepted — CHIEF, 2026-09-01. **The dependency is earned.**

I installed the pre-fix files myself and ran it:

```
pre-fix board.css + TaskCard.tsx from e14f246
  not ok 1 - clicking the card body — not the key — opens the panel
  not ok   - the open control stretches over the whole card
restored -> 562 pass, 0 fail
```

**Red against a real prior commit, not a mutation.** That was the bar and it is
met. `playwright@1.62.1` pinned; it pulled `playwright` and `playwright-core`
only.

### The estimate was wrong and they said so with a number

They told me *"seconds to tens of seconds"*. Measured: **1.07s → 1.48s. +0.41s.**
One browser shared per file, SPA already built in the normal case, headless
Chromium launching in ~300ms.

> *"I would rather have overstated than understated, but the estimate should not
> be quoted anywhere — the number should."*

Correcting your own case **downward** after it has been approved is the harder
direction to correct in. The CI cost stands and is on the task: ~150MB on
install, real the day CI exists.

### The two shell mistakes are the most valuable part

Both produced a result that **looked valid**:

1. **`$PRE:server/web/...`** — zsh read `:s` as a substitution modifier, so
   `git show` failed, the build failed, and the test went red **for the wrong
   reason**. *A red that proves nothing is indistinguishable from a red that
   proves everything.*
2. **`for f in $FILES`** — zsh does not word-split unquoted variables. The loop
   body never ran, the pre-fix files were never installed, and the test
   **passed**. **A green that proved nothing.** Caught only because they were
   suspicious of how fast it ran.

The second is the worse one, and it is this week's lesson in its purest form:
they would have reported *"shown red"* on a run that never touched pre-fix code.
Redone with the iteration in Python — **which is why I used Python for my own
verification of this task**, and I would not have thought to without this report.

Second time they have hit the word-splitting trap and logged it. Twice is the
argument for the default, and they have taken it.

### Two smaller things, both right

**`test/browser/` is named in `structure.test.ts`, not exempted from it.** The
rule caught the new directory immediately, which is it working. Organising by
*how* it tests rather than mirroring `src/` is justified in place: mirroring
would scatter three files and hide the one thing worth knowing — **they are the
slow ones that launch Chromium.**

**The harness 404s loudly on an unstubbed route** rather than returning an empty
body. That is deliberate and it is this week's failure mode being designed out:
a missing fixture must not be able to look like an empty screen. The harness
built to catch that class should not be capable of manufacturing it.

### And the limits stay on the task, in their words

It can read a computed colour but not judge it right; LAI-426's timeline
**rendered perfectly and was still the wrong answer**.

> *"This retires re-verifying by hand what was already established once. It does
> not retire looking."*

### One finding from accepting it — the harness trusts a build it does not own

Merging this, three browser tests failed for me and passed for SHELL. Two causes,
both mine, both worth writing down because the next person hits them:

1. **`pnpm install` after a merge that changes `package.json`.** Without it,
   `playwright`'s types do not resolve and **lint reports 72 errors** that look
   like the new tests are unsafe. They are not.
2. **`server/public` was a week stale — 25 Aug.** The harness serves the built
   SPA rather than building it, so it was testing week-old code and reporting a
   failure that reads exactly like a regression in the change under review.

The second matters beyond me. The harness **404s loudly on an unstubbed route**
so a missing fixture cannot look like an empty screen — that instinct is right
and it is this week's failure mode designed out. **But a stale `server/public` is
the same hole one level up**: it silently tests something other than the source in
front of you, and it can fail *or* pass wrongly. This time it went red on correct
code; the dangerous direction is green on broken code, which is what a stale
bundle would do to anyone iterating on a fix.

**Worth a follow-up:** either build the SPA as part of the browser suite, or
assert the bundle is newer than `src/` and fail with *"your build is stale"*
rather than a test name. Filed for SHELL rather than fixed here.

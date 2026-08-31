---
id: LAI-424
title: A task card is not clickable — only the small key inside it is
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-31T18:54:18Z
finished: 2026-09-01T01:05:00Z
---

## Goal

**Found by the owner, using the board.** Their words: *"im not able click on the
sprint also not on the task"*.

Measured in a real browser against a seeded board:

| click target | result |
| --- | --- |
| the card's **title** (`p.card-title`) | **nothing happens** |
| anywhere else on the card (`article.card`) | **nothing happens** |
| the small monospace key, `LAI-16` (`button.card-key`) | panel opens |

The only interactive element inside a card is:

```
BUTTON.card-key :: "LAI-16 — open details"
```

`article.card` is not a button, carries no click handler, and gives no hover
affordance that the title is inert. So the whole card looks clickable — it is a
raised rectangle with a title, tags, an avatar and a priority dot — and the one
thing that works is a ~50px monospace link that reads as a label rather than a
control.

**Every board a person has used opens a task by clicking the card.** This is the
single most-used interaction on the screen and it is the one that does nothing.

The accessible name is already right (`"LAI-16 — open details"`), so the
intent exists; it is the hit area that is wrong.

## Related, found at the same time

**The open task is not in the URL.** After the panel opens the address stays
`/board?project=laika-core` — no `?task=`. So a task cannot be linked to, a
refresh loses it, and back does not close it. That is the same shape as LAI-423:
state the user can see that the URL does not carry. Fix it here if it is cheap;
if it is not, file it rather than leaving it unsaid.

## Acceptance criteria

- [x] **Clicking anywhere on a task card opens its detail panel** — title, tags,
      whitespace. Not only the key.
- [x] It stays **one** control to assistive technology. Do not nest a button
      inside a button, and do not put a click handler on a `div` — the existing
      `button.card-key` accessible name is `"LAI-16 — open details"` and whatever
      lands must keep an equivalent name.
- [x] The controls **already inside** the card keep working and do not open the
      panel when used: the `+` add-to-sprint control, the assignee avatar, and
      the blocker link. A click on those must not also trigger the card.
- [x] The card shows it is interactive — a cursor and a hover state, in **both
      themes**, using existing design tokens. If none fits, stop and file
      (D-020).
- [x] Keyboard: the card is reachable by Tab and opens on Enter/Space, once.
- [x] `?task=` in the URL, or a filed task saying why not.
- [x] A test clicks the **card body**, not the key, and asserts the panel opens.
      **Make it fail first** — today it passes only because nothing tries.
- [x] Rendered in a real browser, both themes. Full gate green.

## Notes

No new dependencies.

**The sprint chips are fine and are not part of this.** Measured: clicking
`Sprint 13 — Agent access` filters the board (visible task keys went 2 → 1) and
adds `&sprint=<id>` to the URL. The owner reported them together because from
the outside "I clicked and the page did not open something" looks like one
problem. It is worth knowing that the chip's feedback is a **filter**, which is
subtle enough to read as nothing happening — if that is worth a stronger active
state, file it separately rather than widening this.

---

## Build note — SHELL, 2026-09-01

### Measured first

| | before | after |
| --- | --- | --- |
| interactive elements in a card | 1 (`button.card-key`) | 1 (unchanged) |
| hit area | **545px² of 15,062px² — 3.6%** | the whole card |
| cursor | `grab` | `pointer` |
| open task in the URL | no | `?task=<id>` |

### One control, stretched — not a second handler

`button.card-key` keeps its `onClick` and its accessible name, and
`.card-open::after { position: absolute; inset: 0 }` stretches it over the card.
So there is still **one** thing in the accessibility tree, one Tab stop, one
Enter/Space activation, no button inside a button and no handler on a `div`.
Verified in the browser: exactly one opener per card.

### AC3 needs restating — those three are not controls

The `+`, the avatar and the blocker are **display, not controls**: `<span>`s with
`title` tooltips and no handlers. Measured — the only interactive element in a
card was the key. So "must keep working and must not open the panel" cannot mean
what it says.

What they actually need is for their **tooltips** to survive, which an overlay
above them would silently kill. `.card-above` lifts them, so they show their
tooltip and do not open the panel. Confirmed with `elementFromPoint`: the title
and the card's whitespace resolve to the open control, the lifted `+` resolves
to itself.

If a real `+` control lands later, this is the class it needs.

### Two mistakes the source tests could not see

Both caught by clicking, and both now guarded:

1. **`.card-key { position: relative }`** — added so the focus ring painted
   above the overlay. It made the key the containing block for its own
   `::after`, so `inset: 0` sized the hit area **back to the key**. Every CSS
   assertion still passed. `elementFromPoint` over the title still returned
   `P.card-title`.
2. **The cursor assertion matched a comment.** The `.card` rule explains that
   "the design file uses `cursor:pointer` 46 times" — so `/cursor:\s*pointer/`
   matched *that sentence* and stayed green when the declaration was mutated to
   `grab`. **A test satisfied by its own explanation.** Found only because the
   mutation's red never arrived. `ruleFor` now strips comments.

The second is why `pnpm test` passing is not the same as a guard existing, and
it is the argument in **LAI-227** — filed, because no web test in this repo can
click anything: `node --test` cannot import a `.tsx`.

### `cursor: pointer`, from the design rather than taste

The design file uses `cursor:pointer` 46 times and `grab` never. `grab` was
ours — honest about dragging, silent about the thing people do. Dragging still
works (`draggable="true"`, verified) and `:active` still shows `grabbing`.

### Hover uses only existing tokens

`--bd2` and `--tub`. I wrote `box-shadow: var(--shadow-lift, var(--shadow))` and
removed it: **there is no `--shadow-lift`**, so the fallback would have silently
resolved to the same shadow — a no-op dressed as a change — and inventing one is
not mine to do (D-020). Border and surface both change, which is legible in both
themes.

### `?task=` was cheap, so it is done here

The panel was `useState`, so it could not be linked to, a refresh lost it, and
Back did not close it — the same shape as LAI-423. It now reads from the URL.
Verified: clicking sets `?task=`, and loading that URL directly opens the panel.

**One limit worth knowing:** a deep link to a task outside the current filter or
beyond the 200-task page will not open, because the panel resolves against
`board.byId`. Not introduced here and not hidden — say if you want it filed.

### Verified in a browser

Click the card body → panel opens, URL gains `?task=`. Reload that URL → panel
open. Focus the key, press Enter → opens once. `+` → tooltip, no panel. Both
themes: `pointer`, and hover changes border and surface in each.

### Six mutations, six reds

Overlay not covering (1 fail), card back to `static` (1), `.card` cursor back to
`grab` (1), key re-positioned — the real bug — (1), hover removed (1), a second
opener on the article (1). Anchors asserted to match exactly once before
mutating; baseline confirmed green first.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** Verified by clicking, on a build of this branch served against a
copy of the seeded database.

| | measured |
| --- | --- |
| hit area | key `654px²` of card `23,717px²` — **2.8%** — now the whole card |
| element over the title, and at the card's centre | `BUTTON.card-key` |
| interactive elements in a card | **one**, unchanged |
| cursor | `pointer` |
| click the card's whitespace | panel opens, URL gains `?task=…` |
| reload that URL cold | panel still open |
| Enter on the focused key | opens, once |
| dark theme | same |

**Playwright refusing to click `p.card-title`** — *"button.card-key.card-open
intercepts pointer events"* — was the cleanest possible proof, and it is the same
error the old build could never have produced.

Three mutations: the overlay's `inset: 0` → red on *"the open control stretches
over the whole card"*; `.card-key { position: relative }` → red on *"the key is
not itself positioned, or the overlay shrinks to it"*.

### One control stretched, not a second handler

`button.card-key` keeps its `onClick` and its accessible name; `.card-open::after`
covers the card. One Tab stop, one activation, no nesting, no handler on a `div`.
That is the right shape and it is what kept AC2 satisfiable at all.

### AC3 described controls that do not exist — and saying so was right

I wrote *"the `+`, the avatar and the blocker link must keep working and must not
open the panel"*. Measured: they are `<span>`s with `title` tooltips and **no
handlers** — the only interactive element in a card was ever the key. So the
criterion could not mean what it said. What they actually needed was for their
**tooltips** to survive an overlay that would otherwise swallow them silently,
which `.card-above` does.

**Not inventing controls to satisfy my wording** is the correct handling of a
criterion written from an assumption. Second time today: LAI-404's AC4 asked for
something the repo's own guard forbids. I am writing criteria from what I expect
to be there rather than from what is.

### The finding worth keeping

> **Any source-text assertion can be satisfied by prose about the thing instead
> of the thing.**

Their cursor assertion matched `/cursor:\s*pointer/` against a rule whose
*comment* explains that "the design file uses `cursor:pointer` 46 times" — so it
stayed green when the declaration was mutated back to `grab`. **A test satisfied
by its own explanation.** Found only because the mutation's red never arrived —
the check that exists precisely for this. `ruleFor` now strips comments.

That generalises past this file: **every guard in this suite reads source or CSS
as text**, so every one of them is exposed to the same failure. It belongs beside
D-037 rather than in a task file, and I will record it.

### A note on my own review

I reported the cursor guard as not firing. **My mutation was wrong, not the
guard**: my perl lacked `/g`, so under `-0` it replaced only the first
`cursor: pointer` in the file — line 35, not `.card` at line 241. I printed the
`.card` rule showing `cursor: pointer` still in place and read past it. Rerun
properly, the test fails as it should.

Third probe error of the day, and the second where the evidence was already on
screen. *Confirm the mutation landed where the assertion reads*, not merely that
the file changed.

### Two things carried forward

**LAI-227** — no web test in this repo can click anything; `node --test` cannot
import a `.tsx`. **Two p1 interaction defects in a row, and 528 passing tests
said nothing about either.** The argument that jsdom would have caught neither of
today's mistakes — no layout, `getBoundingClientRect` returns zeros,
`elementFromPoint` unimplemented — is what makes it a real proposal rather than a
wish, and requiring the regressions be shown red against the pre-fix commits is
the right bar.

**The deep-link limit is honest and stays unfiled for now**: a `?task=` outside
the current filter or past the 200-task page will not open, because the panel
resolves against `board.byId`. Not introduced here.

**Rejecting the shadow lift was right.** There is no `--shadow-lift`, so the
fallback would have resolved to the same shadow — a no-op dressed as a change —
and inventing a token is not theirs or mine (D-020).

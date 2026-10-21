---
id: LAI-742
title: 'Connect wizard: the six LAI-741 review notes — rail halo, card scroll reset, hanging indent, test tightening, phone order'
area: web
assignee: chief
priority: p1
depends-on: [LAI-741]
discovered-from: LAI-741
finished: 2026-10-12T14:02:23Z
started: 2026-10-12T13:35:33Z
status: done
---

## Goal

The owner, 2026-10-12, **made on the owner's direct instruction**: a small
follow-up to LAI-741 (the Connect wizard, live), in
`server/web/src/routes/screens/connect/` (`ConnectScreen.tsx`,
`connect.css`, `connect-wizard.ts`) and their tests. No wording changes.

## Acceptance criteria

- [x] **1. Rail halo and focus ring.** `.conn-rail`'s scroller no longer
      clips the rail buttons' 2px focus outline (2px offset) or the current
      step's 3px halo on the left and right. At 1366x768 the rail does not
      scroll sideways and the current step's outline box lies inside the
      rail's padding box.
- [x] **2. Card scroll reset.** On a step or optional-entry change the card's
      scroller (`.conn-card-scroll`) goes back to the top before focus moves
      to the title (`preventScroll`). Scrolled down, a step change leaves
      `scrollTop` 0 and the eyebrow in view.
- [x] **3. Hanging indent, robustly.** A wrapped continuation indents
      relative to its own line's start, in every engine, without depending on
      the `hanging` / `each-line` keywords; a line that starts with spaces
      never hangs left of its own text at 390px. The comment says what the CSS
      does. The rendered text stays byte-identical.
- [x] **4.** `connect-wizard.test.ts` asserts where each block's note sits
      with explicit expected values per block id, not a loop restating
      `noteAbove`.
- [x] **5.** `connect.test.ts`'s *Command copied* rail check waits for the
      rail text rather than reading it once.
- [x] **6. Phone order.** Below 56rem the Optional group comes after the card,
      so the current step starts near the top; the four steps stay above the
      card. The desktop layout is unchanged. At 390 the card's top is above
      the Optional group and in the first half of the viewport.
- [x] Each new or changed test shown red without its fix. Full gate from the
      repo root — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0.
- [x] Screenshots, light and dark, at 1366x768 and 390, in
      `/tmp/laika-connect-wizard-3-shots/`.

## Build notes

Commit `e1de1a0`. Each criterion against its test, red then green:

1. `1: the rail clips neither the current step's halo nor its focus ring`, at
   1366x768 — red on 947c07f: *cut 4px on the left*. `.conn-rail` gets
   `padding: var(--space-1)` with the matching negative margin.
2. `2: a step or entry change starts the card at its top`. **Not red on
   947c07f in Chromium**: its `focus()` centres the title, which clamps the
   scroller to 0. With the fix in, removing the reset *and* the head's
   `scrollIntoView` goes red (`166 !== 0`); removing only the reset stays
   green, because the head's `scrollIntoView` (there for the stacked page)
   also brings the scroller to the top. Every optional entry fits the card
   at 1366x768 and 1366x600, so the entry half of that test holds by
   clamping; the step 3 → step 1 half is the one that can fail.
3. `C6`, rewritten to measure each wrapped row against the line's *own* first
   non-space character — red on 947c07f for the indented `git clone` lines.
   `commandLines` replaces `commandRuns`; `CommandText` renders one
   `.conn-line` inline-block per non-empty line with `--lead` set inline, the
   newlines as text between them, so `innerText` is unchanged to the byte.
   Inline `style` attributes are allowed by the CSP (`style-src-attr`).
4. Explicit `{block key: above|below}` per agent — red when `noteAbove` was
   mutated to `group !== 'manual'`.
5. `waitForFunction` on the rail text — red (timeout) when `railLabel(3)`
   was mutated to never say *Command copied*.
6. `6: on a phone the card follows the steps, and Optional follows the card`
   — red on 947c07f. The Optional group moved after the card **in the DOM**
   (a `nav` labelled *Optional*), not by CSS `order`, so reading and focus
   order follow the layout; the desktop grid puts it back in the rail's
   column. At 390 the card first started at 443px of 844, so the steps take
   `padding-block: var(--space-1)` under 600px (44px each); it starts at
   ~411px now. `nothing sits on the page outside the rail and the card` now
   expects `conn-optional` as the wizard's third child.

**Desktop focus order changed** with 6: steps → card → Optional (was steps →
Optional → card). The layout is unchanged.

Gate from the repo root after the last edit: `pnpm test` 0, `pnpm lint` 0,
`pnpm format` 0. The first run went red on `tokens.test.ts` (`--lead` used,
never defined — fixed by defining it on `.conn-line`) and on
`timeline-derive.test.ts` *the header took 751.2 ms* under load; that file
alone passed 29/29, and the rerun of the whole gate was green.

Screenshots: `/tmp/laika-connect-wizard-3-shots/`.

## Accepted (ops bookkeeping, 2026-10-21)

Accepted as shipped, on the owner's approval of this bookkeeping pass. The
build is on master's first-parent line: `e1de1a0c` (the six review notes) and
`e45a2f93` (to review), both 2026-10-12. The named files are present on
master at `d36d2ee5`, and `commandLines` and `conn-card-scroll` are there.
Nothing was re-run for this acceptance: it records work already released, it
is not a fresh review. The board card stays in Review for Pawan to move to Done.

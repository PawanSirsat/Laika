---
id: LAI-041
title: '`--tx3` fails WCAG AA at every size the design uses it — owner decision'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-018
status: backlog
---

## Goal

**This one is the owner's call, not PM's (D-020).** PM measured it, PM
recommended, PM was reverted for deciding it. The numbers are below so the
decision can be made from evidence rather than re-derived.

## The measurements

`--tx3` against each background, both themes (LAI-018, recomputed by
`server/web/test/tokens.test.ts`):

| | `--page` | `--tub` | `--card` |
| --- | --- | --- | --- |
| light `#8d94a4` | 2.67 | 2.51 | 3.04 |
| dark `#71717d` | 4.06 | 3.81 | 3.56 |

**WCAG AA needs 4.5:1 for normal text and 3:1 for large text.** Large text starts
at **18.66px bold or 24px regular**.

**The prototype uses `--tx3` 165 times, every one at 8.5–12px** — 8.5 · 9 · 9.5 ·
10 · 10.5 · 11 · 11.5 · 12 — and 63 of those are `JetBrains Mono` timestamps and
counts. Nothing is within 6px of the large-text threshold, so the 3:1 allowance
does not apply to any of them.

Separately: semantic colours as text on `--card` are `--grn` 3.63, `--amb` 3.82,
`--pur` 4.23, `--acc` 4.50, `--red` 4.52 in light; 5.42–8.74 in dark. `--acc`
passes with zero margin.

## The options

1. **Leave it.** The design ships as drawn. Accept that tertiary metadata does
   not meet AA, and that M7's accessibility pass will either confirm or revisit
   it. Costs nothing now.
2. **Darken the token.** The minimal shift preserving hue and saturation is light
   `#61697a` (4.55 worst) and dark `#83838f` (4.58 worst). **Cost:** the three
   text tiers compress — light `--tx2` is 5.18 and the new `--tx3` 4.55 on
   `--tub` — so the hierarchy is flatter than drawn, and `--tx2` cannot move up
   without failing its own AA.
3. **Rework the text ramp as a whole**, rather than nudging one token. The
   thorough answer, and a designer's job rather than a builder's.
4. **Use `--tx3` larger.** Keep the colour, raise metadata to ≥24px. Changes the
   design's density, which is much of its character.

## Acceptance criteria

- [ ] The owner picks an option.
- [ ] Whatever is chosen is recorded in `docs/DECISIONS.md` and reflected in
      `docs/design/README.md`.
- [ ] If a token changes, `server/web/src/theme/tokens.css` and
      `tokens.test.ts` change with it — the test asserts current values and will
      fail otherwise.

## Notes / context

**PM's recommendation, offered and not acted on:** option 2. The reasoning is in
D-020. It was rejected on process, not on the numbers, and the numbers should not
be taken as settling the question — an accessibility ratio is one input to a
design decision, not the whole of it.

**Nothing is blocked by this.** No screen uses `--tx3` yet. It becomes expensive
once LAI-019/020/021 build screens on it, so it is worth answering before then —
but "leave it" is a complete answer and needs no follow-up work.

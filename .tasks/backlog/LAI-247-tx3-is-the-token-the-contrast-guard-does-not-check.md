---
id: LAI-247
title: '`--tx3` is the one token the contrast guard does not check — and it is the token LAI-041 was about'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-246]
discovered-from: LAI-246
status: backlog
---

## Goal

```ts
// server/web/src/theme/token-list.ts
export const CONTRAST_PAIRS = [
  { text: '--tx',  background: '--page' | '--tub' | '--card' },
  { text: '--tx2', background: '--page' | '--tub' | '--card' },
];
```

**`--tx3` is absent.** Found by mutation: reverting light `--tx3` from `#606775`
back to the failing `#8d94a4` turns **nothing** red.

**That is the token LAI-041 spent two weeks on.** The owner has just lifted it in
the design, SHELL has just shipped the lift, and **the guard that would prove it
worked — and catch it being undone — does not look at it.**

## Why it was excluded, and why that matters now

**Almost certainly because it failed.** The assertion is `ratio >= 4.5` and
`--tx3` on `--card` measured **3.04**. A pair cannot be added to a guard it
breaks, so it was left out — **and when the reason expired, nothing said so.**

**That is the `OrgView` shape** (LAI-239): an exclusion whose justification stops
being true, with no guard able to notice. **Here it is worse in one way** — there
is no exemption list at all, so the omission is invisible: `CONTRAST_PAIRS` reads
like a complete list of the pairs that matter.

## Acceptance criteria

- [ ] **`--tx3` joins `CONTRAST_PAIRS` against `--page`, `--tub` and `--card`.**
      SHELL measured **4.99 / —  / 5.68** light and **7.01** dark after LAI-246,
      so all six should pass. **If any does not, stop and report it** — that is a
      finding for the owner under D-020, not a token to adjust.
- [ ] **The list says what it excludes and why, or excludes nothing.** A bare
      array reads as *these are the pairs that matter*. If a pair is genuinely out
      of scope — a token never used as text — **name it and say so**, so the next
      omission is visible rather than assumed.
- [ ] **Prove the new pairs are load-bearing**: revert one lifted token and watch
      **that pair's** assertion go red. **Judge it by exit code** — a mutation
      that breaks the typecheck exits non-zero without running anything.
- [ ] **Check the remaining tokens for the same shape.** Any token used as text
      anywhere and absent from the pairs is either a finding or an exclusion that
      needs stating. **Report the list, including "nothing else".**

## Notes / context

**Do not lower the threshold, and do not add a per-pair exception.** The guard's
own message is right: *"The design is the contract — report this to PM rather than
adjusting the token."* **A guard that exempts the pair it fails on is the defect
this task is about.**

**`--tx3` is used 122 times across the shipped UI** (measured 2026-09-03), at
8.5–12px, which is below the large-text threshold — **so 4.5:1 is the bar, not
3:1.**

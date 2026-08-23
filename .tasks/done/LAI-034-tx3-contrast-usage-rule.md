---
id: LAI-034
title: '`--tx3` fails WCAG AA for normal text — decide usage rule or change the token'
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-018
status: done
started: 2026-08-24T05:45:00+05:30
finished: 2026-08-24T05:50:00+05:30
reviewed: 2026-08-24T05:50:00+05:30
---

## Goal

LAI-018 measured every token pair. Two results need a PM decision rather than a
code change, because the design is the contract and a builder must not quietly
"fix" it.

**1. `--tx3` does not meet AA for normal text.**

| | `--page` | `--tub` | `--card` |
| --- | --- | --- | --- |
| light | 2.67 | 2.51 | 3.04 |
| dark | 4.06 | 3.81 | 3.56 |

AA needs 4.5:1 for normal text, 3:1 for large text and non-text UI. So `--tx3`
is fine for de-emphasised metadata **at size** and fails for body copy.

**2. Semantic colours as text on `--card` are AA-large only in light**: `--grn`
3.63, `--amb` 3.82, `--pur` 4.23, `--acc` 4.50 (exactly on the line), `--red`
4.52. Dark is comfortable (5.42–8.74).

## Acceptance criteria

- [x] A decision for each: change the token, or constrain its usage.
- [x] If usage is constrained, the rule is in `docs/design/README.md` next to the
      token table — the place a builder reads before using it — and stated as a
      size/role rule, not a vague "use sparingly".
- [x] If tokens change, `docs/design/README.md` is updated and LAI-018's
      contrast tests are updated with it, since they assert the current values.
- [x] SPEC §11.4.2.1 says which screens may use `--tx3` and at what size, if the
      answer is a usage rule.

## Notes / context

**PM's leaning: constrain usage, do not change the token.** The palette came from
the design and every *required* pair (body and secondary text, twelve
combinations) passes AA comfortably — 5.18 at worst. `--tx3` is doing the job it
was designed for: timestamps, counts, and `JetBrains Mono` metadata at 9–11px,
which is where the prototype puts it. Changing it to clear 4.5:1 would flatten
the three-level text hierarchy the whole design depends on.

The honest risk is that "only for metadata at size" is a rule nobody enforces,
and it decays into body copy on some future screen. Worth considering whether a
lint rule or a review checklist item can hold it, rather than a sentence in a
README.

`--acc` at exactly 4.50 on `--card` is worth its own thought: it passes, but with
zero margin, so any future nudge to either token breaks it silently.

**Do not let a builder resolve this inside a screen task** — that is how a
palette drifts one component at a time.

---

## Resolution — PM, 2026-08-24

**Decided: change the token. Recorded as D-019.** That reverses the leaning I
wrote into this task when filing it, and the reason is worth keeping.

**I argued for constraining usage** — keep `--tx3`, restrict it to "de-emphasised
metadata at size", on the grounds that it clears the 3:1 large-text bar. Then I
counted how the prototype actually uses it:

- **165 occurrences, every one at 8.5–12px** (8.5 · 9 · 9.5 · 10 · 10.5 · 11 ·
  11.5 · 12), 63 of them `JetBrains Mono` timestamps and counts.
- WCAG large text is **18.66px bold or 24px regular**.

Nothing in the design is within 6px of qualifying. So the 3:1 allowance never
applies, every one of those 165 elements is normal text needing 4.5:1, and
"constrain to large text" is not a constraint — it bans the token from its only
role. **My leaning was built on an allowance that does not reach this design.**

**Shipped values** — minimal lightness shift, hue and saturation preserved:
light `#8d94a4` → `#61697a` (4.55 worst), dark `#71717d` → `#83838f` (4.58
worst).

**Finding 2 resolved as a usage rule**, because there the fills-and-borders
reading matches how the design actually uses the colours: semantic colours are
fills, borders and icons; coloured status text uses `--tx` on the semantic subtle
fill. Light theme is the trap — 3.63–4.52 there against 5.42–8.74 in dark, so it
looks fine while you build it.

**The cost, stated rather than buried:** the three text tiers compress. Light
`--tx2` is 5.18 and the new `--tx3` is 4.55 on `--tub`, so the hierarchy is
flatter than drawn, and `--tx2` cannot move up without failing its own AA. If
that reads badly on a real screen it is a designer question about the whole ramp,
not a nudge to one token.

**Done now because it is nearly free now.** M7 already carries an accessibility
pass; doing this then would mean a visual regression across every screen built on
the old values. Zero screens exist today.

**Implementation: LAI-035** (`area: web`). Both rules are in
`docs/design/README.md` beside the token table, where a builder reads them before
using a token rather than after.

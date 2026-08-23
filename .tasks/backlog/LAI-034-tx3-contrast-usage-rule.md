---
id: LAI-034
title: '`--tx3` fails WCAG AA for normal text — decide usage rule or change the token'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-018
status: backlog
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

- [ ] A decision for each: change the token, or constrain its usage.
- [ ] If usage is constrained, the rule is in `docs/design/README.md` next to the
      token table — the place a builder reads before using it — and stated as a
      size/role rule, not a vague "use sparingly".
- [ ] If tokens change, `docs/design/README.md` is updated and LAI-018's
      contrast tests are updated with it, since they assert the current values.
- [ ] SPEC §11.4.2.1 says which screens may use `--tx3` and at what size, if the
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

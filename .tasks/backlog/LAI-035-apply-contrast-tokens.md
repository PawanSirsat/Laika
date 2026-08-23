---
id: LAI-035
title: Apply D-019's contrast-corrected --tx3 values
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-034
status: backlog
---

## Goal

D-019 darkened `--tx3`. Apply it to `tokens.css` and tighten the tests so the old
values cannot come back.

## Acceptance criteria

- [ ] `--tx3` is `#61697a` (light) and `#83838f` (dark) in
      `server/web/src/theme/tokens.css`.
- [ ] `tokens.test.ts` asserts **`--tx3` meets 4.5:1** on `--page`, `--tub` and
      `--card` in both themes — not the current "reported" note. Worst expected:
      4.55 light on `--tub`, 4.58 dark on `--card`.
- [ ] The token reference page shows the ratio beside each text token, so a
      future change that breaks contrast is visible without reading the test.
- [ ] `docs/design/README.md`'s D-019 table and `tokens.css` agree — if they ever
      disagree, the test fails.

## Notes / context

D-019 and `docs/design/README.md`. **These values are the contract, not a
starting point** — they are the minimal shift that clears AA with hue and
saturation preserved, so a "nicer" value is almost certainly one that fails.

Expect the three text tiers to look closer together than the prototype: light
`--tx2` is 5.18 and `--tx3` is now 4.55 on `--tub`. That flattening is known and
accepted (D-019). **Do not compensate by lightening `--tx2`** — it would fail its
own AA. If the hierarchy reads badly, say so in your log and it becomes a
designer question, not a token nudge.

Semantic-colour-as-body-text is now a documented no. Nothing uses it yet; the
rule exists before the screens do, which is the only reason it is cheap.

No new dependencies.

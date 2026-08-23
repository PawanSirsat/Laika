---
id: LAI-018
title: Theme system — design tokens, light and dark
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-017]
discovered-from:
status: backlog
---

## Goal

Every colour, space and type ramp in the product, defined once, in both themes.
Get this right and no later screen needs to invent a value; get it wrong and
every screen carries a hardcoded hex.

## Acceptance criteria

- [ ] All tokens from the table in `docs/design/README.md` defined as CSS custom
      properties: `--page --tub --card --bd --bd2 --tx --tx2 --tx3 --acc --pur
      --grn --amb --red --shadow`, each with its `s` (subtle fill) and `b`
      (border) variant where the design has one.
- [ ] Light on `:root`, dark on a root-level class. Values taken **verbatim** —
      this is a contract, not a starting point.
- [ ] Theme resolves as: explicit user choice → OS `prefers-color-scheme` →
      light. The choice persists across reloads.
- [ ] No colour is defined only inside a media query — switching to dark and back
      leaves nothing stranded.
- [ ] Type scale and weights from the design; `Plus Jakarta Sans` for UI,
      `JetBrains Mono` for keys, hosts, timestamps and counts.
- [ ] Avatar colours are **derived from user id at runtime** (SPEC §4.1
      `avatar_color`), never a hardcoded per-person map. The mockup's
      `--mk/--ta/--sv/--jd/--rb` are fixtures for five named people — do not ship
      them.
- [ ] A token reference page renders every token in both themes side by side, so
      drift is visible.
- [ ] Contrast checked: body text and secondary text meet WCAG AA on their own
      background in **both** themes. Report any token that fails rather than
      silently adjusting it — the design is the contract, and a failure is a task
      for PM.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

"Both themes, every time" is a repo rule (CLAUDE.md §5.1). This task is what
makes it cheap to obey.

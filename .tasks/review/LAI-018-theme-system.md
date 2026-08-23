---
id: LAI-018
title: Theme system — design tokens, light and dark
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-017]
discovered-from:
status: review
finished: 2026-08-24T05:13:40+05:30
started: 2026-08-24T05:02:50+05:30
---

## Goal

Every colour, space and type ramp in the product, defined once, in both themes.
Get this right and no later screen needs to invent a value; get it wrong and
every screen carries a hardcoded hex.

## Acceptance criteria

- [x] All tokens from the table in `docs/design/README.md` defined as CSS custom
      properties: `--page --tub --card --bd --bd2 --tx --tx2 --tx3 --acc --pur
      --grn --amb --red --shadow`, each with its `s` (subtle fill) and `b`
      (border) variant where the design has one.
- [x] Light on `:root`, dark on a root-level class. Values taken **verbatim** —
      this is a contract, not a starting point.
- [x] Theme resolves as: explicit user choice → OS `prefers-color-scheme` →
      light. The choice persists across reloads.
- [x] No colour is defined only inside a media query — switching to dark and back
      leaves nothing stranded.
- [x] Type scale and weights from the design; `Plus Jakarta Sans` for UI,
      `JetBrains Mono` for keys, hosts, timestamps and counts.
- [x] Avatar colours are **derived from user id at runtime** (SPEC §4.1
      `avatar_color`), never a hardcoded per-person map. The mockup's
      `--mk/--ta/--sv/--jd/--rb` are fixtures for five named people — do not ship
      them.
- [x] A token reference page renders every token in both themes side by side, so
      drift is visible.
- [x] Contrast checked: body text and secondary text meet WCAG AA on their own
      background in **both** themes. Report any token that fails rather than
      silently adjusting it — the design is the contract, and a failure is a task
      for PM.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

"Both themes, every time" is a repo rule (CLAUDE.md §5.1). This task is what
makes it cheap to obey.

---

## Implementation notes for review (Builder-B)

### Where things live

| File | What |
| --- | --- |
| `src/theme/tokens.css` | every token — light on `:root`, dark on `.dk` |
| `src/theme/theme.ts` | resolution, persistence, applying to the document |
| `src/theme/use-theme.ts` | the React hook |
| `src/theme/avatar-color.ts` | avatar colour derived from user id |
| `src/theme/token-list.ts` | the inventory, shared by the page and the tests |
| `src/theme/TokenReference.tsx` | both themes side by side |
| `test/tokens.test.ts` | 18 cases — drift, inventory, fixtures, contrast |

### Verified in a browser, not just asserted

Built, served through the real server, driven under Playwright:

- **Both themes render side by side.** Two panels, 48 swatches, 16 avatars. The
  same token names resolve to different values in each panel — `--page`
  `#eef0f6`/`#0c0c0f`, `--tx` `#171a21`/`#f3f3f5`, `--acc` `#2f6bff`/`#5b8cff` —
  and **zero** tokens resolved identically across the two, which is the check
  that catches a value copied into one theme and not the other.
- **Resolution order.** Choosing Dark set `.dk` on `<html>`, `color-scheme: dark`,
  body background `rgb(12,12,15)`, and stored `laika.theme=dark`. After a full
  reload it was still dark with the radio still checked. Choosing System
  **removed** the key (`localStorage` → `null`) and fell back to the OS.
- Console clean: 0 errors, 0 warnings.

### Contrast — measured, and one finding reported rather than fixed

Criterion 8 asks for body and secondary text on their own backgrounds, in both
themes. All twelve pairs pass WCAG AA, and `tokens.test.ts` recomputes them:

| | `--page` | `--tub` | `--card` |
| --- | --- | --- | --- |
| light `--tx` | 15.28 | 14.36 | 17.41 |
| light `--tx2` | 5.51 | 5.18 | 6.28 |
| dark `--tx` | 17.63 | 16.58 | 15.48 |
| dark `--tx2` | 7.91 | 7.44 | 6.94 |

**Two findings for PM. Neither is adjusted — the design is the contract.**

1. **`--tx3` does not meet AA for normal text.** Light: 2.67 on `--page`, 2.51 on
   `--tub`, 3.04 on `--card`. Dark: 4.06 / 3.81 / 3.56. It clears the 3:1 bar for
   large text and non-text UI, so it is usable for de-emphasised metadata at
   size, but any screen that puts body copy in `--tx3` will fail an audit. It is
   outside criterion 8's scope, so it does not block this task.
2. **Semantic colours as text on `--card` are AA-large only in light**: `--grn`
   3.63, `--amb` 3.82, `--pur` 4.23, `--acc` 4.50 (exactly on the line), `--red`
   4.52. Dark is comfortable throughout (5.42–8.74). Status text in light theme
   at body size is the risk. Fine as fills and borders, which is mostly how the
   design uses them.

### Decisions worth checking

- **Dark on `.dk`, not a media query.** `docs/design/README.md` names that class
  and criterion 4 forbids colours defined only in a media query.
  `prefers-color-scheme` is read in `theme.ts` to *choose* a theme; it never
  declares one. `tokens.test.ts` fails if a token appears in one block and not
  the other.
- **No inline boot script**, so a dark-mode reader may see one light frame on
  first paint. `initTheme()` runs first in `main.tsx`, but module scripts are
  deferred. The fix would be an inline `<script>`, which the CSP forbids
  (`script-src 'self'`, LAI-023/LAI-103) — a frame of light is a better trade
  than relaxing that.
- **Avatar hues are a fixed ring of 8, indexed by an FNV-1a hash of the id** —
  not the raw hash mapped to a hue, which lands on muddy yellow-greens that look
  broken beside this palette. FNV-1a because it is stable across runtimes: a
  colour that changes when the bundler does is one nobody can rely on. The
  prototype's `--mk --ta --sv --jd` are absent, and a test fails if they return.
- **The type ramp is normalised, not copied.** `docs/design/README.md` fixes the
  families and weight ranges but no size scale, and the prototype's sizes run
  8–15px including 8.5/9.5/10.5/12.5/13.5/14.5 — a mockup tool emitting whatever
  each element happened to be. README already says not to pixel-match layout
  artifacts. Six rem steps clustered where the prototype clusters. **Flagging it
  because "from the design" is doing some work in criterion 5** — the families
  and weights are verbatim, the sizes are a judgement.

### Tests

24 in `@laika/web` (18 new here, 6 from LAI-103), zero new dependencies —
`node:test` with Node 22's native TypeScript. Each guard was confirmed able to
fail: removing `--purs` from `.dk` only → 2 failures; reintroducing `--mk` → 3;
darkening `--tx2` → the contrast cases fail naming the exact ratio.

The parser earned its keep immediately: the first version read only the first
`:root` block and silently missed every type, spacing and radius token. The
inventory test caught it.

### Discovered — affects LAI-205, which I filed an hour ago

`style-src` treats inline `<style>` **elements** and `style=""` **attributes**
differently, and I had recommended tightening the whole directive. Measured, with
a wrong-hash control proving enforcement: under `style-src 'self'` the element is
blocked, the attributes still apply.

That matters because avatar colours are derived per user at runtime, so inline
style attributes are structural here, not stylistic. LAI-205 is corrected with a
split recommendation (`style-src-elem` strict, `style-src-attr 'unsafe-inline'`)
and a warning not to rely on one engine's leniency.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. `@laika/web`
24/24.

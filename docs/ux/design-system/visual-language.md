# Visual language

**Phase B deliverable. Specification only — nothing here is implemented by
this PR.** Principles, the **glassmorphism design system** (Phase B addendum),
and the token families: layers, motion, breakpoints, radius and spacing,
elevation, density, icons, typography. Basis `9ac3be1f`; paths under
`server/web/src/` unless stated.

**Ownership.** New tokens are written in `styles/theme.css` by SHELL under a
named task. **`docs/design/` is the owner's visual reference and is not
changed** (D-020); where this proposal pulls against it, §3.9 lists the
tension for the owner to decide.

**Colour lives only in `theme.css`** (`server/web/test/theme-single-source.test.ts`,
LAI-606: *"adding a theme must be one block in `styles/theme.css` and nothing
else"*). Both theme blocks must declare the same names
(`tokens.test.ts:119`). The blocks are **`:root`** (Obsidian dark, the
default) and **`:root[data-theme='light']`** (`theme.css:191`); shared,
colour-free tokens live in the third `:root` block after them.

## 1. Principles

1. **Surfaces step up, they don't shadow up.** [E] The canvas → column → card
   ladder (`theme.css:40-52`: `--bg-canvas` `#0c0c0f`, `--bg-column`
   `#141418`, `--bg-card` `#1b1b20` in dark). Hierarchy is the step between
   surfaces; shadows go only on things that float above content.
2. **Content over effect.** Every effect — glass, gradient, motion — must make
   the content *more* legible or its state clearer. If removing it loses no
   information, it is decoration and is removed.
3. **One accent, meaning "this one".** [E] `--accent` (purple, both themes) is
   for the current selection, the primary action, focus and the "you" marker.
   Status uses the `--chip-*` triples, never the accent.
4. **Hierarchy from type role first, colour second.** At most three `t-*`
   roles above the fold.
5. **Colour is never alone.** Status, kind and heat always come with text, an
   icon or an `aria-label`.
6. **Truth is visible.** Confirmed, claimed, failed, agent-reported and
   AI-generated content look different from each other, in every lens and
   mode (`../specifications/proactive-intelligence.md` §4–§5).
7. **Both themes, every time.** A component that works in one theme is not
   done.

## 2. Relationship to `docs/design/`

`docs/design/README.md` is the token contract for the prototype (its token
table, e.g. `--card`, `--tub`, `--page`, `--shadow` `0 1px 2px …` "card
elevation"). This set **adds** semantic tokens alongside; it **changes none
of the reference values**. A glass surface is a *new* surface kind, not a
replacement for `--bg-card`.

## 3. Glassmorphism design system (Phase B addendum)

### 3.1 Intent

**Purposeful, restrained glass.** Glass marks *chrome that floats over
content* — navigation, tools, transient overlays, at-a-glance panels — so a
reader can tell at once what is the work and what is the frame around it. It
is never used to decorate the work itself. "AI gradients everywhere" is
explicitly out.

### 3.2 Where glass is used — and where it is never used

| Glass (allowed) | Level |
| --- | --- |
| Navigation rail / sidebar; sticky shell and space headers | 1 |
| Workroom **side rails** (left nav, right agent / decisions rail) | 1 |
| Command Center cards; Agent Operations cards; management dashboard panels and KPI tiles | 1 |
| Toolbars (board toolbar, document toolbar), floating action bars (sticky ApprovalBar at 390) | 2 |
| Popovers, menus, contextual menus, command palette shell, notification centre | 2 |
| Tooltips, toasts, status overlays (live / reconnecting chips), small confirms | 3 |

| **Solid (always)** | Why |
| --- | --- |
| **Documents** — the Workroom **centre document stays opaque**; MarkdownView, deliverable reader, reports | long-form reading needs a stable, maximum-contrast ground |
| **Tables** — List, People, Usage, evidence, session history | dense text and alignment; blur behind rows costs contrast and GPU |
| **Code** — CodeView, diffs, test output | syntax colours are tuned against a known solid background |
| **Forms** — settings, dialogs with inputs, wizards | input borders and validation must be unambiguous |
| **Long-form reports and presentation mode** | projectors and screen sharing flatten translucency |
| **Task cards and board lanes** | scrolling lists (§3.7) and the existing step ladder |

### 3.3 Tokens (proposed, both theme blocks)

Values are proposals for the implementing task to tune against the contrast
rule in §3.6; names are the contract.

```css
/* ── Obsidian dark — :root ─────────────────────────────────────────── */
:root {
  /* surface tint per level: the card colour, translucent */
  --glass-1: rgba(27, 27, 32, 0.72);      /* rails, cards, panels   */
  --glass-2: rgba(31, 31, 36, 0.80);      /* toolbars, popovers     */
  --glass-3: rgba(35, 35, 41, 0.88);      /* tooltips, toasts       */
  /* the opaque step each level falls back to (§3.6, §3.7) */
  --glass-1-solid: #1b1b20;               /* = --bg-card            */
  --glass-2-solid: #1f1f24;               /* = --bg-card-hover      */
  --glass-3-solid: #232329;               /* = proposed --bg-raised */
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --glass-shadow-1: none;                 /* in-flow: steps, not shadows */
  --glass-shadow-2: 0 8px 24px rgba(0, 0, 0, 0.45);   /* = --shadow-popover */
  --glass-shadow-3: 0 12px 28px rgba(0, 0, 0, 0.5);   /* = --shadow-toast   */
  --glass-hover: rgba(255, 255, 255, 0.04);
  --glass-active: rgba(255, 255, 255, 0.07);
  --glass-selected: color-mix(in srgb, var(--accent) 16%, transparent);
  --ambient-1: radial-gradient(60rem 40rem at 10% -10%,
                 color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%);
  --ambient-2: radial-gradient(50rem 36rem at 110% 0%,
                 rgba(47, 107, 255, 0.07), transparent 70%);
}

/* ── Obsidian light — :root[data-theme='light'] ────────────────────── */
:root[data-theme='light'] {
  --glass-1: rgba(255, 255, 255, 0.70);
  --glass-2: rgba(255, 255, 255, 0.80);
  --glass-3: rgba(255, 255, 255, 0.90);
  --glass-1-solid: #ffffff;
  --glass-2-solid: #ffffff;
  --glass-3-solid: #ffffff;
  --glass-border: rgba(15, 23, 42, 0.09);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.65);
  --glass-shadow-1: none;
  --glass-shadow-2: 0 8px 24px rgba(15, 23, 42, 0.14);
  --glass-shadow-3: 0 12px 28px rgba(15, 23, 42, 0.16);
  --glass-hover: rgba(15, 23, 42, 0.04);
  --glass-active: rgba(15, 23, 42, 0.07);
  --glass-selected: color-mix(in srgb, var(--accent) 12%, transparent);
  --ambient-1: radial-gradient(60rem 40rem at 10% -10%,
                 color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%);
  --ambient-2: radial-gradient(50rem 36rem at 110% 0%,
                 rgba(47, 107, 255, 0.05), transparent 70%);
}

/* ── shared, colour-free — the third :root block ───────────────────── */
:root {
  --glass-blur-sm: 8px;    /* level 3: tooltips, toasts           */
  --glass-blur-md: 14px;   /* level 2: toolbars, popovers, menus  */
  --glass-blur-lg: 20px;   /* level 1: rails, panels, cards       */
  --glass-blur-max: 24px;  /* hard cap; the guard rejects more    */
}
```

- **Every colour above is in `theme.css`**, in both theme blocks, so
  `theme-single-source.test.ts` and `tokens.test.ts:119` keep holding.
  `color-mix()` over `var(--accent)` keeps the accent single-sourced.
- **Shadows tie to elevation and layers**: `--glass-shadow-2/3` equal the
  proposed `--shadow-popover` / `--shadow-toast` (§4.5) and are used only on
  `--layer-popover` and above (§4.1). In-flow glass (level 1) has **no
  shadow** — it steps, honouring principle 1.
- **Ambient gradients** are restrained by rule: only on the canvas behind
  Command Center, Agent Operations and management dashboards; never behind
  documents, tables, forms or the board; ≤ 10 % alpha; static (no animation);
  removed under `prefers-contrast: more` and forced colours.

### 3.4 Primitives — the only way to get glass

- **`<GlassSurface level={1 | 2 | 3} as="section">`** in
  `components/glass/GlassSurface.tsx`, rendering one element with the
  `.glass-1..3` class. Props: `level`, `as`, `interactive` (adds the state
  layer), `selected`.
- **`.glass-1`, `.glass-2`, `.glass-3`** utility classes in one stylesheet,
  `components/glass/glass.css` — the **only file allowed to contain
  `backdrop-filter`**:

```css
.glass-1 { background: var(--glass-1); border: 1px solid var(--glass-border);
           box-shadow: var(--glass-highlight), var(--glass-shadow-1); }
.glass-2 { background: var(--glass-2); border: 1px solid var(--glass-border);
           box-shadow: var(--glass-highlight), var(--glass-shadow-2); }
.glass-3 { background: var(--glass-3); border: 1px solid var(--glass-border);
           box-shadow: var(--glass-highlight), var(--glass-shadow-3); }

@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .glass-1 { backdrop-filter: blur(var(--glass-blur-lg)) saturate(1.2);
             -webkit-backdrop-filter: blur(var(--glass-blur-lg)) saturate(1.2); }
  .glass-2 { backdrop-filter: blur(var(--glass-blur-md)) saturate(1.15);
             -webkit-backdrop-filter: blur(var(--glass-blur-md)) saturate(1.15); }
  .glass-3 { backdrop-filter: blur(var(--glass-blur-sm));
             -webkit-backdrop-filter: blur(var(--glass-blur-sm)); }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-1 { background: var(--glass-1-solid); }
  .glass-2 { background: var(--glass-2-solid); }
  .glass-3 { background: var(--glass-3-solid); }
}
@media (prefers-reduced-transparency: reduce) {
  .glass-1, .glass-2, .glass-3 { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .glass-1 { background: var(--glass-1-solid); }
  .glass-2 { background: var(--glass-2-solid); }
  .glass-3 { background: var(--glass-3-solid); }
}
@media (forced-colors: active) {
  .glass-1, .glass-2, .glass-3 { backdrop-filter: none; -webkit-backdrop-filter: none;
    background: Canvas; border-color: CanvasText; box-shadow: none; }
}
```

- **No per-screen glass CSS.** A screen picks a level; it never sets its own
  alpha, blur or border.
- The existing `backdrop-filter: blur(2px)` on the confirm scrim
  (`components/confirm-dialog.css:21`, the only use today) moves into the
  primitives as a scrim variant, or is removed.

### 3.5 Interactive states on glass

| State | Treatment |
| --- | --- |
| hover | `--glass-hover` overlay (a background layer, not a change of alpha), `--transition` timing |
| active / pressed | `--glass-active` overlay |
| focus | `--focus-ring` (§4.5), drawn **outside** the surface with a canvas-coloured inner ring, so it is visible on any backdrop |
| selected | `--glass-selected` + the existing left accent bar / `aria-current`; never colour alone |
| disabled | content at the disabled text token; the surface does not fade (a faded glass panel reads as "loading") |

### 3.6 Accessibility

- **Contrast against the worst-case backdrop.** Text on glass must meet WCAG
  AA (4.5:1 body, 3:1 large text and UI parts) against the glass colour
  **composited over the worst-case content that can scroll or sit beneath
  it** — in dark, the brightest token that can appear under it (e.g.
  `--text-primary` text, `--accent` fills); in light, the darkest. Blur
  lowers local contrast but cannot be relied on to raise it, so the test uses
  the unblurred composite. Proposed guard: extend the contrast-pair tests
  (`tokens.test.ts:213` style) with composited pairs for each level × theme.
  If a level fails, its alpha rises — not its blur.
- **`prefers-reduced-transparency: reduce`** → solid fallbacks (§3.4).
  Browser support is partial, so a **proposed** "Reduce transparency"
  setting (beside the existing theme control) sets
  `data-transparency="reduced"` on `<html>` (a per-device convenience in
  localStorage until a server preference exists) and applies the same rules.
- **`forced-colors: active`** → system colours, no blur, no shadow (§3.4).
- **`prefers-contrast: more`** → solid levels and no ambient gradients.
- **Focus is always visible on glass** via the two-ring `--focus-ring`.
- Glass never carries meaning by itself: a floating panel still has a heading
  or `aria-label`, and status inside it follows principle 5.

### 3.7 Performance

- **Cap the blur** at `--glass-blur-max` (24 px); the guard rejects literal
  blur values and anything over the cap.
- **Never nest backdrop-filters.** A glass surface inside a glass surface uses
  the solid fallback for the inner one (`.glass-* .glass-*` resets
  `backdrop-filter: none`). One blurred layer per panel.
- **No backdrop-filter on scrolling or virtualised lists, or on many
  simultaneous elements** — rows, cards in lanes, timeline items, table cells
  are solid. Glass sits on the *container* that holds a list, never on each
  item; and a blurred container over a scrolling list is avoided where the
  list scrolls *under* it at high frequency (sticky headers use level 1 with a
  short blur only).
- **Measure GPU cost** at 1440 and 1600 (largest blurred areas: rails, Command
  Center) and on a phone profile at 390, with a scroll-and-open-menu script;
  record frame times before and after. A level whose cost is not acceptable
  falls back to solid at that breakpoint.
- **`@supports` fallback** when `backdrop-filter` is unavailable (§3.4).
- `content-visibility` and virtualisation decisions (`responsive-accessibility.md`
  §3) are unaffected, because lists are solid.

### 3.8 CSP

`backdrop-filter` is **plain CSS** in a stylesheet bundled at build time. It
needs no runtime `<style>` element and no script, so it is compatible with
`style-src-elem 'self'` plus build hashes and `script-src 'self'`
(`server/src/http/security-headers.ts:74, 78`). `<GlassSurface>` sets only a
class; a level chosen at runtime is a class change, never an injected rule.
Per-instance values, if ever needed, go through custom properties on the
`style` attribute, which `style-src-attr 'unsafe-inline'` allows (:79).

### 3.9 Tensions for the owner to decide

These are flagged, not resolved (D-020: the reference is the owner's).

1. **"Surfaces step up, not shadow up" vs translucency.** Today depth is the
   opaque canvas → column → card ladder. Glass makes some surfaces partly
   transparent, so the step depends on what is behind them. Proposal: level 1
   glass has **no shadow** and is visually one step above its backdrop; shadows
   remain only on floating layers (popover and up), as the principle already
   allows.
2. **The reference has no glass.** `docs/design/README.md`'s token table
   defines opaque surfaces (`--page`, `--tub`, `--card`) and one card shadow.
   Glass is a new surface kind beside them. Does the owner want it at all, and
   where first? The proposal's minimum is: sidebar rail, popovers / menus /
   palette, toasts.
3. **Ambient gradients** introduce colour on the canvas, which the reference
   keeps flat. Proposal limits them to three overview screens at ≤ 10 % alpha;
   the owner may prefer none.
4. **The light theme** canvas is `#eef0f6` behind white cards; glass over a
   near-white canvas is subtle and may read as a faint grey card. The owner
   may prefer glass in dark only, with light falling back to solid steps.
5. **Sidebar tint.** `--sidebar-tint` is the card colour with a border
   (`theme.css:50-51`), matching the prototype. A glass sidebar changes that
   look over the ambient canvas.

### 3.10 Guards (proposed)

1. **No `backdrop-filter` outside `components/glass/`** (CSS and inline
   styles) — red on a planted violation.
2. **No glass colour literal outside `theme.css`** (already enforced for any
   colour by `theme-single-source.test.ts`).
3. **Every `--glass-*` name declared in both theme blocks** (extends
   `tokens.test.ts:119`).
4. **No blur literal and no blur above `--glass-blur-max`.**
5. **Composited contrast pairs** per level × theme (§3.6).

## 4. Token families

### 4.1 Layers (z-index) [E: 22 distinct values]

Collisions today: `dropdown.css:102-104` at 60 vs `side-panel.css:11-20` at
60 (scrim) / 61 (panel) — a Dropdown inside a SidePanel paints under it (B16);
`overflow-menu.css:39`, `space.css:655/660`, `my-day.css:1653/1661`,
`organisation.css:1922/1930` at 61; `confirm-dialog.css:10` and
`agent/agent.css:254` both 80 (carried from the audit).

```
--layer-base:0  --layer-raised:1  --layer-sticky:10  --layer-header:20
--layer-sidebar:30  --layer-drawer:40  --layer-overlay:50 (scrim)
--layer-panel:51  --layer-popover:60  --layer-menu:60  --layer-tooltip:70
--layer-dialog:80  --layer-toast:90  --layer-live:100
```

Rule: a popover always outranks any panel, because it opens from inside one.
Local stacking 1–9 stays literal only inside an `isolation: isolate`
container. Guard: `z-index` ≥ 10 must be `var(--layer-*)`. Glass levels map:
1 → base / sticky / header / sidebar / drawer; 2 → popover / menu; 3 →
tooltip / toast.

### 4.2 Motion [E: one token, `--transition` at `theme.css:362`; ~10 literal durations; 19 local reduced-motion blocks; `board-motion.ts:122` re-reads the query in JS]

```css
--duration-instant: 90ms;  --duration-fast: 120ms;  --duration-base: 160ms;
--duration-slow: 240ms;    --duration-ambient: 2s;
--ease-standard: cubic-bezier(.2,0,0,1);  --ease-enter: cubic-bezier(0,0,0,1);
--ease-exit: cubic-bezier(.3,0,1,1);

@media (prefers-reduced-motion: reduce) {
  :root { --duration-instant:0ms; --duration-fast:0ms; --duration-base:0ms; --duration-slow:0ms; }
  *, ::before, ::after { animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
}
```

Delete the 19 local blocks; `theme/motion.ts` exports `prefersReducedMotion()`
for JS. Animate only `transform` and `opacity`; never animate
`backdrop-filter`. Guard: no duration literal outside `theme.css`.

### 4.3 Breakpoints [E: 29 distinct CSS values + JS copies]

`theme/breakpoints.ts` is the single source:

```
phone 600 · tablet 900 · laptop 1180 · desktop 1280 · wide 1440 · ultra 1600
coarse = '(pointer: coarse)'
```

`useMedia(query)` in `theme/use-media.ts` replaces the private `matchMedia`
copies. CSS custom properties cannot be used inside `@media`, and there is no
PostCSS config, so a guard checks that every `@media (max|min-width: …)` uses
one of these values (max form `N − 0.02px` or range syntax `width < N`).
Option B — `lightningcss` `customMedia` (Vite ships it) — needs its own spike
because it changes `@import` handling. Validation widths are in
`responsive-accessibility.md` §1.

### 4.4 Radius and spacing [E: 232 non-token `border-radius`; `--space-1…6` = 4, 8, 12, 16, 24, 32 at `theme.css:341-346`]

| Token | Value | Absorbs |
| --- | --- | --- |
| `--radius-hairline` | 2px | 1px, 2px |
| `--radius-chip` | 4px | 3px, 4px |
| `--radius-xs` | 5px | 5px |
| `--radius-sm` | 6px | 6px, 7px |
| `--radius-card` / `--radius-control` | 9px | 8–11px |
| `--radius-column` | 12px | — |
| `--radius-pill` | 999px | — |
| `--radius-round` | 50% | — |

Spacing adds `--space-0-5: 2px`, `--space-7: 3rem`, `--space-8: 4rem`.
Guards: every `border-radius` is a token, `0` or `inherit`; padding, margin
and gap use `--space-*`, `0` or `auto` (positional offsets exempt for now).
Glass surfaces use `--radius-card` (level 1–2) and `--radius-sm` (level 3).

### 4.5 Elevation [E: `--shadow-card`, `--shadow-modal` (`theme.css:179-184` dark, `:300-306` light); 82 of 125 `box-shadow` use a token]

| Token | Use | Dark | Light |
| --- | --- | --- | --- |
| `--shadow-card` | card | existing | existing |
| `--shadow-popover` | popover, menu, tooltip | `0 8px 24px rgba(0,0,0,.45)` + 1px border ring | `0 8px 24px rgba(15,23,42,.14)` |
| `--shadow-panel` | side panel, drawer | `-12px 0 32px rgba(0,0,0,.4)` | lighter equivalent |
| `--shadow-modal` | dialog | existing | existing |
| `--shadow-toast` | toast | popover + 4px y | popover + 4px y |
| `--focus-ring` | focus | `0 0 0 2px var(--bg-canvas), 0 0 0 4px var(--accent)` | same |
| `--bg-raised` | popover surface one step above card | `#232329` | `#ffffff` + ring |

Extends the existing "elevation tokens" test (`tokens.test.ts:112`).

### 4.6 Density

Two modes built from tokens, not separate components: **Comfortable**
(default, today) and **Compact** (board, list, activity tables: row 32 instead
of 40, padding `--space-2` instead of `--space-3`; body type unchanged because
`type-floor.test.ts` keeps sizes on the scale). Implemented as
`[data-density="compact"]` on a container re-pointing `--row-*` / `--pad-*`
aliases. The capability-aware default (Focus vs Overview) is in
`../architecture/experience-architecture.md` §3.

### 4.7 Icons

[E] No icon package: `components/sidebar/NavIcon.tsx:14-22` draws path
arrays on a 24 px grid ("no icon package, which no task names"); 53 `.tsx`
files carry inline `<svg>`; brand marks in `components/agent-mark/`.
Proposal: one `components/icon/Icon.tsx` path registry (24 px grid, 1.75
stroke, `currentColor`, `aria-hidden` by default, sizes 16 / 20 / 24); keep
`AgentMark` separate; guard: no `<svg>` outside `icon/` and `agent-mark/`
(chart allow-list). **Do not adopt lucide or similar.**

### 4.8 Typography

[E] `theme/type-roles.ts` generates `styles/type.css`: tiny 11/16, small
12/16, body 14/20, reading 16/24, heading-sm 16/20, heading-md 20/24,
heading-lg 24/28; guards `type-css-drift.test.ts`, `type-floor.test.ts`.
Plus Jakarta Sans (UI) and JetBrains Mono (keys), self-hosted.

Refinements inside the existing scale (no new sizes): letter-spacing moves
into the generator (183 literal declarations today; guard: only in
`type.css`); `t-numeric` (tabular numbers for counts, durations, costs);
`t-reading` with `max-inline-size: 72ch` for long Markdown; `t-code` for keys,
SHAs and paths. Visual audit: monospace dates beside sans text compete on
every row — dates move to `t-numeric` sans; mono stays for keys and SHAs.
Text on glass uses the same roles; no lighter weights on glass.

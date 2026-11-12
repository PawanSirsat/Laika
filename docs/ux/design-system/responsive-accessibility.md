# Responsive, accessibility and performance

**Phase B deliverable (evidence + proposal).** Basis `9ac3be1f`.

## 1. Validation widths

Seven widths, both themes: **390 · 768 · 1024 · 1280 · 1366 · 1440 · 1600**.

[E] The browser suite today uses 390 (×42 occurrences), 1440 (×40), 1366
(×18), 1600 (×17) and 1280 (×5); **nothing tests 768 or 1024** — the tablet
range that the shell's 900 and 1180 thresholds straddle (`AppShell.tsx:20,
30`; `sidebar-state.ts:22`). Counts carried from the design-system audit.

| Width | Class | Shell | Space views | Task | Header |
| --- | --- | --- | --- | --- | --- |
| **390** | phone | bottom bar; sidebar off-canvas | List grouped by status by default; Timeline / Calendar show "Open on a wider screen" | full-screen sheet; sticky action bar | last crumb + Back; "Filters (n)" |
| **768** | tablet portrait | off-canvas nav (< 900) | Board scrolls lanes on x; toolbar stats keep labels (V6) | one column, tabs on top; right panel as sheet | breadcrumbs truncated |
| **1024** | tablet landscape / small laptop | rail (900–1180) | Board with toolbar overflow; search not truncated (V6) | centre + right panel; left as 48 px icon rail | full |
| **1280** | laptop | full sidebar (≥ 1180) | full | drawer docks; Workroom three panels at defaults | full |
| **1366** | common laptop | full | full | three panels | full |
| **1440** | desktop | full | full | extra width → centre up to 72ch, then right panel | full |
| **1600** | wide | full | full | side panels may reach max; version diff side by side | full |

Rules: no document-level horizontal scroll at any width (assert with the
right-edge enumeration LAI-245 used, moved into the harness); every container
that scrolls on x shows an affordance (V9); below 600 menus become sheets and
tab strips scroll with fade edges; breakpoints only from
`theme/breakpoints.ts` (`visual-language.md` §4.3).

Screens with **no** max-width CSS today: calendar, sprints, list, capacity,
usage, profile (CSS census, interaction inventory). Each needs a 390 and 768
design before it is touched.

## 2. Accessibility strategy

[E] strengths: contrast-pair tests (`tokens.test.ts:213`),
`avatar-contrast.test.ts`, `LiveRegion` (19 files use `aria-live`),
`useDialogFocus` with a unit test, `no-native-select.test.ts`, a full APG
combobox in `Dropdown.tsx`, roving tablist in `HandoffsTab.tsx`.

Target: **WCAG 2.2 AA** for every new and touched surface.

1. **Dialog sweep.** Every modal surface on the `Dialog` base — TaskDrawer,
   SidePanel, the 15 dialogs that skip focus handling, the inline
   alertdialogs (B3, B12, B22). Guard: any file with `role="dialog"` or
   `role="alertdialog"` imports `useDialogFocus`.
2. **Escape layering.** One dismiss stack: Escape closes only the topmost
   layer.
3. **Button adoption.** 558 raw `<button>` vs 22 files using `Button`. Use
   `Button` / `IconButton` (required `aria-label`) except for menu items; a
   counting test lets the raw number only fall.
4. **Focus visible** everywhere through `--focus-ring`, including on glass
   (`visual-language.md` §3.6).
5. **Target size** ≥ 24 × 24 px; ≥ 44 × 44 under `(pointer: coarse)`.
6. **Colour never alone** — status, kind, heat, provenance carry text or icon.
7. **Landmarks and skip link** in the shell; `inert` behind off-canvas nav.
8. **Transparency and contrast preferences** — `prefers-reduced-transparency`,
   `prefers-contrast: more`, `forced-colors: active` honoured by the glass
   primitives; `prefers-reduced-motion` honoured globally from one block.
9. **Keyboard-only journeys** J1–J8 (route inventory §6) pass end to end.
10. **Automated checks.** An axe pass in the Playwright harness per screen at
    390 and 1440 in both themes — needs a task naming `@axe-core/playwright`,
    or an in-house rule subset. Automated checks do not replace a manual
    screen-reader pass (VoiceOver + Safari, NVDA + Firefox) per phase.

## 3. Performance budgets

| Budget | Target | Today | How measured |
| --- | --- | --- | --- |
| Main JS (gzip) | **≤ 200 KB** | 533,280 B (local build) | size test reading `server/public/assets` after build |
| Main CSS (gzip) | **≤ 40 KB** | 92,813 B | same |
| Route chunks | every screen lazy from `route-table.ts`; prefetch on nav hover / focus | 3 `lazy()` imports | build manifest |
| New library | gzip size stated in its PR; lazy unless shell-critical | — | esbuild + gzip, as in `library-evaluation.md` |
| List render | 1k rows usable; 5k rows measured | not measured | browser test timing at 1k / 5k |
| Virtualisation | above **200** rows (Activity / feed, List, org tables) and **100** cards per lane | none | only after measurement; below thresholds `content-visibility: auto` + `contain-intrinsic-size` |
| Long Markdown | memoised by content hash; collapse past 4k chars behind "Show all"; highlight fences lazily when visible; worker if > ~50 fences | no highlighting | trial fixtures A–C |
| Long activity | cursor pagination + virtualisation; append on SSE, keyed by id; never re-render the whole list | 50 per read | timeline test |
| Animation | `transform` / `opacity` only; `--duration-*`; ambient loops pause when `document.hidden` and stop after one iteration under reduced motion | 2 s–22 s loops | — |
| Glass | ≤ one blurred layer per panel; blur ≤ 24 px; none on lists; frame times recorded at 1440, 1600 and a phone profile | one blur (scrim) | scroll + open-menu script |
| Polling | one visibility-aware `usePolled`; redundant pollers removed by the org stream | 7 copies; `setInterval` in 18 files | test: one `EventSource`, no hidden-tab polling |
| Charts | hand-made SVG; aggregate above ~1,000 marks | SVG (Donut, heatmap) | — |

Main-bundle targets are asserted by a test, not by a report. Route splitting
lands before any new dependency, so every dependency PR is measured against a
split baseline.

# Library evaluation

**Phase B deliverable (evidence + proposal).** Which third-party libraries
could carry parts of the transformation, measured against Laika's CSP, bundle
budget, React 19, accessibility and theming. Basis `9ac3be1f`.

> **Every dependency needs its own task** that names the package and exact
> version (CLAUDE.md §5: *"No new dependencies without a task that says so"*).
> A verdict of **Adopt** here is a recommendation for that task to be filed —
> not permission to add the package. Approving a phase does not approve the
> libraries named in it (decision UX-1).

## 1. Method and the CSP gap

- **Sizes** were measured by bundling each library with esbuild
  (`--minify --format=esm`, React external, CSS excluded) and gzipping at
  `-9`, in a scratch directory outside the repo.
- **CSP behaviour** came from grepping those bundles for `eval(`,
  `new Function(`, `createElement('style')`, `insertRule`,
  `adoptedStyleSheets`, `WebAssembly` and `createObjectURL`, then reading the
  code around each hit. That is a reading, not a browser test.
- **Versions** from `npm view` on 2026-11-04 (registry `time.modified`).
- **Laika's own bundle** (local build, not guaranteed byte-identical to
  `9ac3be1f`): `index-*.js` 1,880,428 B / **533,280 B gzip**; `index-*.css`
  658,428 B / **92,813 B gzip**; lazy `RichEditor-*.js` 168,332 B gzip.

## 2. Matrix

**CSP baseline** (`server/src/http/security-headers.ts:67-90`, re-verified):
- `script-src 'self'` (:74). There is no `wasm-unsafe-eval`, so `WebAssembly.instantiate` is blocked.
- `style-src-elem 'self'` plus hashes (:78). Runtime `<style>` elements are blocked. Constructed stylesheets (`adoptedStyleSheets`) and CSSOM `insertRule` into an existing sheet are generally not subject to `style-src`, but **this must be verified in the browser harness**.
- `style-src-attr 'unsafe-inline'` (:79). Inline style attributes are fine.
- `img-src 'self' data:` (:81). `blob:` images are blocked.
- `connect-src 'self'`.
- No `worker-src`, so workers fall back to script-src `'self'`. Same-origin worker files are fine; blob workers are blocked.
- **Gap:** `server/web/test/csp-compatibility.test.ts` (the test at :97-98) only greps the emitted JS for `eval` and `new Function`. The browser tests (`test/browser/harness.ts`) do not serve the CSP or listen for `securitypolicyviolation`, so a library that injects a `<style>` at runtime **would pass CI**.

| Library | Why / what it replaces | min / gzip (measured) | Latest (registry) | React 19 / TS | A11y | CSP findings | Theme via CSS vars | License | Perf / integration | Verdict + task |
|---|---|---|---|---|---|---|---|---|---|---|
| **@xyflow/react** | Dependency graph, agent-flow diagrams. Nothing exists today (`task/DependenciesSection.tsx` is a list). | 185.9 KB / **61.5 KB** | 12.12.1, 2026-11-02 | peer `react >=17`; TS-native | keyboard node focus, `aria-label` config; graph a11y is only fair | No eval, no `<style>`, no wasm. Needs the static `@xyflow/react/dist/style.css` import (fine). Heavy inline transform styles (allowed). | Yes, `--xy-*` variables and `colorMode` | MIT | Must be lazy (diagram route only). Medium. | **Not-now.** Needs a specced diagram screen first. Task: "dependency graph view". |
| **Motion** (`motion/react`) | Card glide (`board/board-motion.ts/.css`), gestures, layout animation | full 138.6 / **47.2 KB**; `LazyMotion` + `m` + `domAnimation` 89.6 / **32.7 KB** | 14.9.1, 2026-11-04 | peer `^18 \|\| ^19` | respects `useReducedMotion` | `AnimatePresence mode="popLayout"` **creates a `<style>` and calls `insertRule`** (it accepts a `nonce`, but Laika has no nonce, so this is blocked). All other features animate inline styles and WAAPI. | Animates values, not themes. | MIT | WAAPI accelerated. Large for what is needed. | **Avoid for now.** Use tokens + CSS + WAAPI. Revisit only for gesture-driven drag. No task. |
| **TipTap** (keep) | Existing editor (`task/editor/*`, `LazyRichEditor.tsx:71`) | already shipped: RichEditor chunk 168 KB gzip | 3.32.2, 2026-10-30 (pinned 3.32.0) | peer `^17–19` | ProseMirror a11y is decent | Already in production under the CSP | Styled by our CSS | MIT | Already lazy | **Keep.** Pin bumps go through normal tasks. |
| **BlockNote** | Would replace TipTap | measured with mantine: 6.24 MB / **1.43 MB** | 0.57.0, 2026-10-30 (pre-1.0) | peer ok | Mantine UI | Bundle contains 2× `createElement('style')` and 3× `insertRule` (Mantine/emotion style injection), so blocked by `style-src-elem` | Mantine theme, not our tokens | **MPL-2.0** (core); some packages differ | ~8.5× the current editor | **Avoid.** |
| **Shiki** (core + JS regex engine + css-variables theme) | Syntax colour for CodeView (`wizard/CodeBlock.tsx` has none) | core + JS engine + TS grammar 351 KB / **71 KB** (each grammar adds more) | 4.6.0, 2026-11-02 | framework-agnostic; TS-native | outputs `pre`/`span`; our CodeView adds a11y | **JS regex engine: no wasm, no eval, no `<style>`.** Output uses inline `style="color:var(--shiki-…)"` (allowed). **The default Oniguruma engine uses WebAssembly, which is blocked.** | Yes, the css-variables theme maps to our tokens | MIT | Lazy per language; can highlight off the main thread in a same-origin worker | **Evaluate,** against lowlight. Task: "CodeView + highlighter spike". |
| **lowlight** | Same purpose | `common` 172.9 / 52.5 KB; core + TS 31.2 / **11.9 KB** | 3.3.0, 2024-12-14 (slow cadence) | framework-agnostic | outputs hast; we render | No eval, no style. The `WebAssembly` hits are grammar keyword strings, not calls. | Class-based output (`hljs-*`), so trivially themed in our CSS | MIT | Lighter, lower fidelity | **Evaluate (preferred, given CSP and size).** Same task. |
| **TanStack Table** | ListView (`routes/screens/list/ListView.tsx`), org tables (PeopleTab, Usage `Columns.tsx`) | v9 adapter + whole core 120 / **32.8 KB** (upper bound; tree-shakes lower) | 9.3.1, 2026-10-12. **v9 API changed:** `useTable`, not `useReactTable`. | peer `react >=18` | headless: our markup decides | No style, no eval | headless | MIT | Headless, so integration is medium. Most value comes with sorting, column visibility and virtual rows. | **Evaluate** when a shared Table primitive is built. Task: "shared DataTable". |
| **TanStack Virtual** | Long activity, list and board lanes | 35.2 / **10.6 KB** | 3.14.26, 2026-11-03 | peer `^16.8–19` | headless; must keep `aria-setsize`/`aria-posinset` | No style, no eval. Positions with inline transform (allowed). | n/a | MIT | Small; dynamic heights supported | **Adopt when measured** (thresholds §4). Task: "virtualise Activity feed". |
| **Apache ECharts** | Charts (Capacity, Usage, Insights; current `Donut.tsx`, heatmap) | full 1.14 MB / **382.5 KB**; tree-shaken line + bar + grid + tooltip + SVG 546 / **187.4 KB** | 6.1.0, 2026-05-19 | imperative wrapper needed | aria `decal` and descriptions; weaker than hand-made SVG | Full build has `new Function("return ("+r+");")` (JSON fallback), which trips our eval test. The tree-shaken build has none. Inline styles only. | No native CSS vars; colours must be read through `getComputedStyle` and re-set on theme change | Apache-2.0 | Heavy | **Avoid.** Current SVG charts are accessible and token-themed. |
| **Radix primitives** (Popover, Tooltip, DropdownMenu, Toast) | Popover, Tooltip, Menu, Toast | Popover 24.9, Tooltip 20.3, Menu 32.2, Toast 12.6 KB gzip; all four together **39.6 KB** | Popover 1.3.1, Tooltip 1.4.1, Menu 2.2.1, Toast 1.3.1, all 2026-10-14 | peer through `^19` | excellent, WAI-ARIA tested | **Popover and DropdownMenu bundle `react-remove-scroll` / `react-style-singleton`, which calls `document.createElement("style")` in modal mode, so it is blocked** (silent no-op for the scroll lock). Tooltip and Toast: no `<style>`. Inline `--radix-*` vars on style attributes (allowed). | unstyled, so our tokens apply | MIT | Medium: replaces 8 popovers and 4 tooltips | **Evaluate.** Tooltip and Toast are safe. Popover and Menu only with `modal={false}`, plus a browser test proving no CSP violation. |
| **Floating UI alone** | Positioning for our own Popover, Menu and Tooltip; replaces `placeWithin` (`dropdown-model.ts:253`) | `react-dom`: 19.4 / **7.7 KB**; `@floating-ui/react` with interactions + FocusManager: 55.3 / 19.8 KB | react-dom 2.1.9 / react 0.27.20, 2026-07-11 | peer `>=16.8` / `>=17` | the a11y is ours (we already own Dropdown and OverflowMenu semantics) | No style, no eval. Inline position styles (allowed). | n/a | MIT | Smallest; we keep our keyboard models | **Adopt** (`@floating-ui/react-dom`). Task: "Popover primitive on Floating UI". |
| **dnd-kit** | Board drag (`TaskCard.tsx:148-153` HTML5 DnD, `LaneRow.tsx`, `my-day/UntimedTray.tsx`); touch broken (B17) | classic `core` + `sortable` 43.5 / **15.0 KB**; new `@dnd-kit/react` 119 / 39.3 KB | core 6.3.1, **2024-12-05** (stale); react 0.5.3, 2026-10-31 (pre-1.0) | both peer React 19 | keyboard sensor + screen-reader announcements built in | Classic core: no style, no eval. **New `@dnd-kit/react` injects `<style>` (blocked) or uses `adoptedStyleSheets`**; risky. | n/a | MIT | Rewrite of drag in 3 places, with the board-motion interplay | **Evaluate** classic `@dnd-kit/core` + `sortable` (stable, CSP-clean). Task: "touch + keyboard board drag". |
| **cmdk** | Command palette (none today) | `Command` only 52.2 / **17.9 KB** (pulls in Radix Dialog code) | 1.1.1, 2025-08-27 | peer `^18 \|\| ^19` | combobox/listbox semantics | The bundle includes `react-style-singleton` `createElement("style")`, but it **only runs when `Command.Dialog` mounts**. Inline `Command` inside our own modal does not run it. | unstyled, `[cmdk-*]` attributes | MIT | Low | **Adopt** (inline `Command` only). Task: "Command palette". |
| **PDF.js** (`pdfjs-dist`) | Document/evidence viewer for PDFs. **Uploads are deferred by SPEC** (audit §5), so there is nothing to view yet. | main 445.5 / **133.6 KB** + worker **378 KB gzip** | 6.5.438, 2026-11-01 | framework-agnostic | text layer gives selectable text; viewer a11y is ours | Worker: same-origin file works under `script-src 'self'`; cross-origin falls back to a **blob URL (blocked)**. JBIG2, OpenJPEG and QCMS decoders are **WebAssembly (blocked)**; nowasm fallbacks ship (`jbig2_nowasm_fallback.js`). Fonts use the FontFace API plus `insertRule` / `adoptedStyleSheets` fallbacks. Text and annotation layers use inline styles. | Viewer chrome is ours | Apache-2.0 | Heavy; lazy route only | **Not-now.** Blocked on the uploads SPEC decision. |
| react-resizable-panels (noted for SplitPane) | resizable panels | 109.4 / **37.1 KB** | 4.18.0, 2026-11-04 | peer `^18/^19` | good separator a11y | `adoptedStyleSheets` + `insertRule` for the global resize cursor (likely CSP-ok; verify) | n/a | MIT | Overkill for one separator | **Avoid.** Build in-house. |

## 3. Document-rendering libraries (for the deliverable design trial)

These are evaluated **inside the trial only** (`../specifications/deliverable-engine.md`
§2), on a local branch, before any is proposed for production.

| Library | Purpose | CSP finding | Verdict |
| --- | --- | --- | --- |
| **lowlight** | code highlighting | class-based `hljs-*` output; no eval, no style, no wasm | **Preferred** for the trial (see matrix) |
| **Shiki** | code highlighting, higher fidelity | must use `createJavaScriptRegexEngine` (default Oniguruma engine is WebAssembly — blocked: no `wasm-unsafe-eval`) and the `css-variables` theme (inline `style="color:var(--shiki-…)"`, allowed by `style-src-attr`) | **Trial comparator** |
| **Mermaid** | diagrams | writes a `<style>` element into its SVG; inline in our DOM that is `style-src-elem`, and our hashes cover only build-time styles (`security-headers.ts:68, 78`) → **blocked**. Workaround to test: render off-screen, serialise, show as `<img src="data:image/svg+xml,…">` (`img-src data:` allowed; an image SVG is not governed by the page CSP). Costs: no text selection or links, self-hosted fonts do not load inside the image, layout measurement may drift. Must also be checked for `eval` / `new Function` under `script-src 'self'`. Roughly 0.5–1 MB+ lazy | **Spike in the trial.** Never add `'unsafe-inline'` to `style-src-elem`. Fallback: show the fenced source labelled "Diagram preview not available" |
| **remark-math + rehype-katex** | math | `katex.min.css` bundled (`'self'`); fonts self-hosted (`font-src 'self'`); inline `style=` attributes allowed | **Not in the trial fixtures**; evaluate only if a fixture needs it |
| **diff** | version comparison | pure JS | **Trial** (or a small in-house line diff; the server already has `diffLines` in `server/src/services/text-diff.ts:105`, used for context revisions) |
| **docx / exceljs / pptxgenjs** | office exports | heavy; lossy for callouts and math | **Not now.** PDF via browser print first |
| **react-markdown + remark-gfm** | rendering | already shipped (`TaskMarkdown.tsx`) | **Keep** |
| **TipTap** | editing | already shipped and lazy | **Keep** |

## 4. Summary of verdicts

| Verdict | Libraries |
| --- | --- |
| **Adopt** (file a task) | `@floating-ui/react-dom` (Popover / Menu / Tooltip positioning); `cmdk` (inline `Command` only, Phase F) |
| **Adopt when measured** | `@tanstack/react-virtual` (lists above the §4 thresholds in `../design-system/responsive-accessibility.md`) |
| **Evaluate** | lowlight vs Shiki (trial); classic `@dnd-kit/core` + `sortable` (touch drag, B17); Radix Tooltip / Toast (Popover / Menu only with `modal={false}` and a browser CSP test); TanStack Table (with a shared `DataTable`) |
| **Spike** | Mermaid (trial, `<img>` route only) |
| **Keep** | TipTap, react-markdown, remark-gfm |
| **Avoid / not now** | ECharts, BlockNote, Motion, react-resizable-panels, `@xyflow/react` (until a diagram screen is specced), PDF.js (uploads deferred), Radix Dialog (scroll lock injects `<style>`) |

**Prerequisite for any new UI dependency:** the Playwright harness serves the
real `buildContentSecurityPolicy` header and fails on any
`securitypolicyviolation` event (acceptance criterion in
`../roadmap/acceptance-criteria.md` §2).

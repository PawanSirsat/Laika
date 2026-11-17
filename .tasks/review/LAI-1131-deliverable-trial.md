---
id: LAI-1131
title: 'Deliverable design trial: a document-first reading page on /design/documents'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-1124
status: review
started: 2026-11-04T14:01:25Z
finished: 2026-11-05T13:30:00Z
---

## Goal

Run the deliverable design trial (`docs/ux/specifications/deliverable-engine.md`
§2 on `LAI-1124-ux-docs`) before Phase D decides how deliverables are stored:
a public reference page, `/design/documents`, renders three controlled,
illustrative Markdown fixtures through a document renderer and shows ten
reading capabilities working, so the owner can judge **how deliverables read**
with no server, storage or upload work at all.

Document-first, not uploads: no file storage, upload APIs, attachment
permissions, OCR, server tables, endpoints or MCP tools. Nothing the trial
builds writes anywhere but browser memory. Branch into
`integration-ui-transformation`, never `master`.

## Acceptance criteria

- [x] `/design/documents` is a public reference route (beside `/design/tokens`
      and `/design/states`), its page loaded with `import()` so the fixtures,
      the renderer and every library it uses stay out of the entry chunk; a
      bundle test proves no fixture string reaches the entry chunk.
- [x] Three synthetic fixtures — A technical architecture report (v1 and v2),
      B UAT / test report, C management summary — with no real names,
      addresses, tokens or customer data.
- [x] T1 rendering: headings, lists, callouts, footnotes, tables and code
      through per-type components; raw HTML is not rendered, `javascript:`
      URLs are emptied, images show alt text (TaskMarkdown's rules).
- [x] T2/T3 outline and section navigation: a sticky outline with unique
      `h-<slug>` heading anchors, the current section tracked by
      IntersectionObserver, keyboard reachable; a menu at phone width.
- [x] T4 code: highlighted in ≥ 3 languages with colours from theme tokens
      only, and a copy button per block.
- [x] T5 Mermaid: a real-browser spike under the production CSP; if Mermaid
      needs a runtime `<style>` or `eval`, the CSP is **not** weakened and a
      recorded fallback renders the diagrams instead.
- [x] T6 tables: horizontal scroll inside the table, a scroll hint only when
      it overflows, an accessible caption, a sticky first column where wide.
- [x] T7 version compare: A v1 ↔ v2 at section level and line level with
      inserted and removed lines marked; a client diff, no server code.
- [x] T8 annotations: select text → an anchored comment in the margin,
      removable, labelled "prototype — not saved", memory only.
- [x] T9 full-screen reading: focus mode, about 72ch measure, Esc leaves and
      focus returns to the control that opened it, both themes.
- [x] T10 PDF export: a print stylesheet hides chrome, breaks pages before
      H1/H2, avoids splitting tables and code, prints in print colours.
- [x] Unit tests (diff, outline extraction, slug uniqueness) and browser tests
      for each capability, including the page loading under the production
      CSP with zero `securitypolicyviolation` events.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Packages this task may add (CLAUDE.md §5, one task naming each, as the
trial section §2.1 asks):

- `lowlight` **3.3.0** (MIT) — code highlighting as `hljs-*` classes; no
  WASM, no inline style, so no CSP concern. Brings `highlight.js` (BSD-3-Clause)
  as its own dependency; `highlight.js` **11.11.2** (BSD-3-Clause) is also a
  direct dependency, because the grammars are imported by name
  (`highlight.js/lib/languages/*`) and pnpm does not resolve a transitive
  package from this workspace. Chosen over Shiki: Shiki's default engine is
  WebAssembly (blocked, no `wasm-unsafe-eval`), and its JS-regex engine plus
  the `css-variables` theme writes inline `style` attributes per token —
  allowed, but a theme then lives in two places. Classes map to `--code-*`
  tokens in `theme.css`.
- `mermaid` **12.2.0** (MIT) — **devDependency only**, for the CSP spike and
  for `scripts/render-trial-diagrams.ts`, which pre-renders the fixtures'
  diagrams to SVG files at authoring time. It never enters the bundle.

No diff library: the line diff is an in-house LCS (`line-diff.ts`).

The renderer is a sibling of `TaskMarkdown` rather than a change to it: the
trial needs heading ids, per-type code blocks and table wrappers that
TaskMarkdown deliberately does not let a caller replace. It keeps the same
three safety rules. Folding it into TaskMarkdown is a Phase D decision.

## Review notes (builder)

- **The gate criterion is left unticked.** The host was running four other
  agents' gates at once. Two root `pnpm test` runs were killed (exit 144) and
  the earlier one timed out tests in untouched files: `auto-pickup`,
  `spaces-page` (clock ages) and three `cli/` e2e suites (cancelled by their
  parent). Each was re-run alone with the same timing failures, and this
  branch touches nothing under `cli/`. **The full test gate is deferred to
  the PR's CI run, which is the arbiter.** `pnpm lint` and `pnpm format` were
  run in the foreground. Every test file this task added or touched passes
  run alone (see the log).
- The dead run did catch two real failures here, and both are fixed:
  - LAI-726's no-native-select guard: the version picker is now a segmented
    control.
  - The type floor: every size is a scale step.
- Deviations, all also in the PR:
  - fixture A is about 2.5k words with a 178-line listing (the spec asks for
    4–8k and 200)
  - only A has v1/v2
  - compare is unified only (no side-by-side at 1600px or wider)
  - C has no presentation variant

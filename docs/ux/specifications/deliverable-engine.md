# Specification: deliverable engine and the deliverable design trial

**Phase D (engine) and alongside Phase C (design trial). Proposal over
evidence.** Basis `9ac3be1f`.

Two things live here, deliberately separated:

1. **The deliverable design trial (§2)** — brought forward to run alongside
   Phase C (decision UX-5). Document-first, no uploads, no backend. It decides
   *how deliverables read* before Phase D decides *how they are stored*.
2. **The deliverable engine (§4)** — Phase D. First-class text deliverables
   with immutable versions, review and anchored comments, developed against a
   **local** backend only (decision UX-4, §3).

## 1. Today (evidence)


- **(a) Existing.**
  - `tasks.deliverables` is a JSON checklist of `{id,title,detail,state}` (`schema.ts:503-508`, `:549`), with states `pending, in_progress, done` (`enums.ts:406`).
  - `checkpoint_task` moves an item to `in_progress` (`write-tools.ts:619`, `working_on`). `finish_task` moves it to `done` (`:507`, `checklist`). The proof lives in `task_rounds` / `task_evidence`.
  - Task prose is markdown text: `description_md` and acceptance. `project_context_revisions` (`schema.ts:1616`) is the only versioned text in the system.
  - **Checkpoints deliberately store no content** (`schema.ts:1683-1690`, D-115 item 4).
  - **Uploads are a v1 non-goal** (`SPEC.md:40`) and attachments stay out (`SPEC.md:53`). Open question 5 says uploads are "deferred; the `/data` volume anticipates them" (`SPEC.md:7237`).

## 2. Deliverable design trial (alongside Phase C)

### 2.1 Purpose and boundary

Validate the reading, navigation, comparison, annotation and export
experience for long-form agent deliverables **before** committing to a data
model or a library. The trial is **document-first, not uploads**:

- **In:** Markdown fixtures checked into the trial branch, rendered by the
  existing `TaskMarkdown` pipeline plus candidate renderer extensions.
- **Out:** file storage, upload APIs, attachment permissions, OCR, binary
  formats, server tables, new endpoints, new MCP tools. Nothing the trial
  builds may write anywhere but the browser.
- **Where:** a trial route or the design-reference area (`/design/*` is public
  and not product, `route-table.ts:347-350`) behind a build-time flag, on a
  branch into `integration-ui-transformation`. Fixtures live beside the trial
  code under `server/web/` (SHELL). **No fixture string may reach the
  production bundle** — the D-032 demo rule and its bundle test apply.
- **Dependencies:** each candidate (lowlight, Shiki, Mermaid, a diff library)
  needs **its own task naming package and version**, even for the trial. A
  candidate that fails the trial is removed with its task closed as
  "evaluated, not adopted".

### 2.2 The three fixtures (controlled Markdown)

| Fixture | Shape | Must contain | Stresses |
| --- | --- | --- | --- |
| **A — Technical architecture report** | long-form, 4–8k words | H1–H4 hierarchy (≥ 30 headings), fenced code in ≥ 4 languages (TS, SQL, shell, JSON), a ≥ 200-line code block, ≥ 3 Mermaid diagrams (flowchart, sequence, ER), footnotes, GFM callouts, internal `LAI-` links and external links | TOC depth, section nav, highlighting cost, diagram rendering, reading measure |
| **B — UAT / test report** | tabular | ≥ 5 tables incl. one ≥ 12 columns and ≥ 150 rows; status cells (pass / fail / blocked / skipped); evidence references (commit SHAs, test commands with exit codes, PR links); a findings list with severity | horizontal scroll, sticky headers, status semantics (text + icon, not colour alone), long-table performance |
| **C — Management summary** | executive, 1–2 pages | headline and decision box, 3–5 KPIs, a short risks table, decisions-required list, one simple diagram, "Outstanding issues" section | executive readability, presentation / full-screen, print-to-PDF fidelity |

Each fixture has **two versions** (v1, v2) with realistic edits — moved
sections, a changed table row, an edited code block, a removed diagram — to
exercise comparison. Fixtures are synthetic: no real names, addresses, tokens
or customer data (the repository is public).

### 2.3 What the trial validates

| # | Capability | Fixture | Pass condition | Notes / CSP |
| --- | --- | --- | --- | --- |
| T1 | **Rendering** | A, B, C | all three render in both themes with the existing safety rules intact (`TaskMarkdown.tsx:16-37`: no raw HTML, `javascript:` emptied, images as alt text) | renderer extensions owned inside `TaskMarkdown`, never a caller prop |
| T2 | **Table of contents** | A | outline from headings, ids `h-<slug>` namespaced per document; current section marked (IntersectionObserver); keyboard reachable | none |
| T3 | **Code highlighting** | A | lowlight vs Shiki compared on fidelity, gzip size, time to first paint for the 200-line block; lazy per language; both themes via `--code-*` tokens | **Shiki only with the JavaScript regex engine** (default engine is WebAssembly — blocked, no `wasm-unsafe-eval`) and the `css-variables` theme (inline `style` attributes — allowed by `style-src-attr`). lowlight emits classes — no CSP concern |
| T4 | **Mermaid** | A, C | diagrams visible and legible in both themes, or a labelled source fallback | **Mermaid injects a `<style>` into its SVG → blocked by `style-src-elem 'self'`.** Test only the off-screen render → serialise → `<img src="data:image/svg+xml,…">` route (`img-src data:` is allowed). Record: text not selectable, links dead, self-hosted fonts absent, any `eval` / `new Function`. **Never** relax `style-src-elem` |
| T5 | **Tables + horizontal scroll** | B | wide tables scroll on x inside their wrapper with a visible affordance (fade edge or "scroll →"); headers sticky; no document-level horizontal scroll at 390 | `md-table-wrap` scrolls x only |
| T6 | **Section navigation** | A, B | left outline + "Contents" sheet at ≤ 1023; deep link `#h-<slug>` restores position; Back leaves the document (push on open) | follows Workroom URL rules |
| T7 | **Version comparison** | A, B, C (v1 ↔ v2) | side-by-side at ≥ 1600, unified below; source diff, not rendered-HTML diff; moved sections recognisable | in-house line diff or the `diff` package (own task) |
| T8 | **Comments / annotations** | A, C | select text → quote anchor `{exact, prefix, suffix, heading_slug}`; re-anchors on v2 by quote match, else shown "outdated" | **browser-only in the trial** (in-memory, nothing persisted); persistence is Phase D (anchored comments, M) |
| T9 | **Full-screen reading** | A, C | focus mode hides chrome and panels; 72ch measure; Escape leaves; presentation variant for C keeps "Outstanding issues" pinned | the reading surface is **solid**, never glass |
| T10 | **PDF export** | A, B, C | browser print → "Save as PDF" from a print stylesheet: chrome hidden, folds expanded, link URLs shown, provenance header (fixture id, version); wide tables legible (landscape or wrapped) | zero dependencies; server-side headless Chromium is out of scope |

Also recorded for each fixture: render time, main-thread long tasks, gzip
added per candidate library, memory at 1440 and 390, and any
`securitypolicyviolation` event (the harness must listen — see
`../roadmap/acceptance-criteria.md` §2).

### 2.4 Trial outputs

1. A short findings note per capability (pass / fail / caveat) with
   measurements, added under `docs/ux/` in a follow-up docs PR.
2. A recommendation for the production renderer (§4.4) and its library
   tasks.
3. Inputs to the Phase D data model: maximum realistic body size, whether
   diagrams need server-side rendering, which exports are worth building.

The trial approves nothing for production by itself.

## 3. Backend from Phase D: local development only (UX-4)

- Local server, local SQLite file, isolated fixtures; **no** production
  database, deploy or shared environment; **no** external storage unless the
  owner approves it.
- The public API is preserved: changes are **additive** (new tables, new
  endpoints, optional fields); no existing response shape or status changes.
- Every server change is a **CORE-owned task** with its own review and tests;
  every endpoint calls `can()` (CLAUDE.md §5).
- New activity verbs are **three owners** (SPEC by CHIEF, `enums.ts` + CHECK by
  CORE, the web mirror and dashboard wording by SHELL); a new MCP tool trips
  `parity.test.ts` / `plugin-mcp.test.ts`, so SPEC §7.1 and the server land
  together (CLAUDE.md §4.4).
- Local instances follow CLAUDE.md §4.3: own port, own database file, verify
  `uptime_ms`, kill by port only.
- Nothing reaches `master` until integration validation and explicit release
  approval (UX-3).

## 4. Deliverable engine (Phase D)

### 4.1 Decision needed first (owner / CHIEF)

**Decision needed (CHIEF/owner, a new D-xxx):** is an agent posting a **text** document (markdown / JSON / CSV / plain) as a string over the API an "upload"?

- **Recommendation:** no, by the same logic as `description_md` and project context. Text-only, versioned and stored in SQLite.
- Binary files (images, PDFs, office files) stay deferred under q5.
- This needs a SPEC §1.1 clarification, a §4 table section and §3.1 `can()` rows.

### 4.2 Data model

**`deliverables`** holds the identity:

| Column | Notes |
|---|---|
| `id` | ULID |
| `org_id`, `project_id`, `task_id` | FKs |
| `ships_item_id` | nullable; links to `tasks.deliverables[].id`, so the Ships checklist stays the promise and this is the artefact |
| `kind` | `document \| data \| table \| link` |
| `title` | |
| `created_by_user_id \| created_by_agent_id`, `session_id`, `token_id` | provenance as `task_rounds` records it (`schema.ts:2426-2445`) |
| `created_at`, `updated_at` | |
| `current_version` | int |
| `approval_state` | `draft \| submitted \| approved \| changes_requested \| superseded` |
| `archived_at` | |

**`deliverable_versions`** is **immutable**, with no update path in the service (same rule as a checkpoint's saved fields, asserted by a test):

| Column | Notes |
|---|---|
| `id` | |
| `deliverable_id` | |
| `version` | unique per deliverable |
| `media_type` | `text/markdown \| application/json \| text/csv \| text/plain` |
| `body` | the **original**, byte-exact |
| `sha256`, `byte_length` | cap to decide; context uses 100,000 chars (`SPEC.md` q7), docs may need ~500k |
| `source_ref` | JSON `{repo, path, commit_sha, checkpoint_id?}` |
| `round_id` | nullable FK |
| `note_md` | the author's change note |
| `created_by_*`, `created_at` | |

**Review and comments:**
- **`deliverable_reviews`**: `version_id`, `decision approved|changes_requested`, `reason_md`, `comment_id`, `decided_by`, `decided_at`. Kept separate from `task_reviews` so approving a document is not accepting the task. Whether task Accept *requires* every linked deliverable approved is a decision.
- **Reviewer comments** reuse `comments` (`schema.ts:761`) with nullable `deliverable_version_id` and `anchor` JSON: `{exact, prefix, suffix, heading_slug, source_start, source_end}`, a TextQuote-style selector against the **source**. The client re-anchors to newer versions by quote match and shows "outdated" when that fails.

**Evidence:** `deliverable_version_evidence(version_id, evidence_id)`, or resolution through `round_id`.

**Original, presentation and export are kept apart:**
- **Original:** `deliverable_versions.body`, never rewritten. A display normalisation (e.g. pretty-printed JSON) is computed, never saved.
- **Presentation:** derived at view time by the renderer. Per-viewer settings (TOC, wrap, theme) stay in localStorage.
- **Export:** generated on demand and not stored. Each export file carries a provenance footer (`deliverable id · v3 · sha256 · author · created`).

**REST** (each route calls `can()`):
- `GET /tasks/:id/deliverables`
- `GET /deliverables/:id` (with version list)
- `GET /deliverables/:id/versions/:n`
- `GET /deliverables/:id/versions/:n/raw`: `Content-Type: <media_type>; charset=utf-8`, `Content-Disposition: attachment`, `nosniff`
- `POST /deliverables/:id/versions/:n/review`

Possible actions are `deliverable.read` (follows `task.read`), `deliverable.submit` and `deliverable.review`; whether they are new or mapped to existing ones is a SPEC §3.1 call.

**Multi-owner warning (CLAUDE.md §4.4):** new activity verbs (`deliverable.submitted`, `deliverable.reviewed`) each touch three owners: SPEC (CHIEF), `enums.ts` + CHECK (CORE), and the web `ACTIVITY_TYPES` mirror plus dashboard wording (SHELL).

### 4.3 How agents submit

- **Do not extend `checkpoint_task`.** It is defined as content-free (D-115 item 4).
- **New MCP tool `submit_deliverable`**, with these inputs:
  - `task`
  - `deliverable` (Ships item id/title, or `{new: {title, kind}}`)
  - `media_type`, `body`
  - `source {repo, path, commit_sha}`, `note`
  - `claim_generation`, `idempotency_key`
- It requires the session to hold the claim, like `checkpoint_task`, and returns `{deliverable_id, version}`.
- **Extend `finish_task`** with optional `deliverables: [{id, version}]` *references*, not bodies. The round links them, and `summary` stays ≤50,000 (`write-tools.ts:514`).
- Adding a tool trips `parity.test.ts` / `plugin-mcp.test.ts` (names asserted from both sides). SPEC §7.1 and the server must land together.

### 4.4 Renderer (production plan, pending the trial's findings)

**Today:**
- `react-markdown ^10.1` + `remark-gfm ^4.0.1` (package.json:33-34) give tables, task lists, strikethrough, autolinks and **GFM footnotes**.
- Safety (`TaskMarkdown.tsx:16-37`): no raw HTML, `defaultUrlTransform`, images replaced by their alt text (`:69-70`), and **no caller-supplied tree transforms**, because transforms are owned inside `TaskMarkdown`.
- Editing is Tiptap 3.32 (`RichEditor.tsx`), which writes markdown.
- There is no highlighting, math, diagrams, heading ids, table of contents or search.

| Feature | Plan | CSP / bundle | Bucket |
|---|---|---|---|
| **Code highlighting** | **lowlight** (highlight.js grammars → hast) inside an owned `code` component, hast → React via `hast-util-to-jsx-runtime` (already a react-markdown dependency). Class-based output (`hljs-keyword`), themed by `theme.css` tokens in both modes, fits the colour-token tests. **Shiki** only if grammar fidelity is needed: it must use `createJavaScriptRegexEngine` (CSP has no `wasm-unsafe-eval`) and the `css-variables` theme, which emits `style="color:var(--shiki-…)"` (allowed by `style-src-attr`). Grammars lazy-loaded per language either way | lowlight: common subset ~40-60KB gz, lazy chunk. New dependency → needs a task naming it | UI-only + dep |
| **Mermaid** | **Spike, not v1.** Mermaid writes a `<style>` element into its SVG; inline in our DOM that is `style-src-elem`, and our hashes cover only build-time styles (`security-headers.ts:68,78`), so it is blocked. Workaround: render off-screen, serialise, display as `<img src="data:image/svg+xml,…">` (`img-src data:` allowed; an image SVG is not governed by the page CSP). Costs: no text selection or links, fonts inside images do not load self-hosted faces, layout measurement during render may be off without its styles. Also verify no `eval`/`new Function` under `script-src 'self'`. Roughly 0.5-1MB+ lazy. **Never** add `'unsafe-inline'` to `style-src-elem`. v1: show ```` ```mermaid ```` as labelled source with "Diagram preview not available" | High risk | Spike |
| **Math** | `remark-math` + `rehype-katex`, owned in `TaskMarkdown` (not a caller prop); `trust:false`, `strict:'warn'`, `maxExpand` bounded. `katex.min.css` imported into the bundle ('self'), fonts self-hosted (`font-src 'self'`); KaTeX's inline `style=` attributes are allowed | ~270KB lazy | UI-only + deps |
| **Callouts** | `> [!NOTE\|TIP\|WARNING\|CAUTION\|IMPORTANT]` handled in an owned `blockquote` component (detects the first-line marker); unknown markers render as a plain quote | none | UI-only |
| **Footnotes** | already parsed. Scope the `user-content-fn-*` ids per document instance (several docs per page) and route back-links through the in-panel scroll | none | UI-only |
| **TOC / section nav** | owned `h1-h6` components assign `h-<slug>` (own slugify plus a dedupe counter, namespaced per doc); the outline comes from the mdast via the `node` prop. Left panel lists it; IntersectionObserver marks the current section | none | UI-only |
| **Search in document** | text search over the rendered container; highlight with the **CSS Custom Highlight API** (no DOM mutation), with match-count + next/prev fallback; Cmd-F stays the browser's | none | UI-only |
| **Copy code / section** | owned `pre` with the existing `copyText` (`components/CopyButton.tsx`); "copy section" slices the **original source** by `node.position` offsets, so a copy is the agent's bytes, not re-serialised | none | UI-only |
| **Anchored comments** | select text → quote selector → comment (§4.2) | — | Backend (M) |
| **Version diff** | line diff of two `body` originals, side by side at ≥1600, unified below; rendered as source, not as rendered HTML | `diff` package (new dependency) | Backend (needs versions) + dep |
| **Print** | `@media print` stylesheet: hide chrome, panels and actions; expand folds; show link URLs; a provenance header. `?print=1` opens a print-laid page | none | UI-only |
| **JSON / CSV** | JSON: pretty source view plus a table when it is an array of flat objects. CSV: table view (own parser or a dependency). The original is always one click away | — | UI-only once deliverables exist |

### 4.5 Exports

| Format | Purpose | Where generated | Implications | Slice |
|---|---|---|---|---|
| **MD** | the original, exact | client: `Blob` + `a[download]` from the raw endpoint | none | **1** |
| **PDF** | sharing / sign-off | **browser print → "Save as PDF"** using the print stylesheet. Server-side headless Chromium in the arm64 image is heavy; avoid | zero dependencies | **1** |
| **HTML** | a standalone readable copy | client: `renderToStaticMarkup` of the same renderer + inlined export CSS into a file (the file's own CSP is not ours) | bundle the export CSS as a string | 2 |
| **DOCX** | stakeholders who edit in Word | client lazy `docx` from the mdast (~150-400KB) or a server-side lib; never pandoc in the image | new dependency, lossy (callouts, math) → marked as "derived" | 3 |
| **XLSX** | `table`/`data` deliverables only | CSV first (the activity CSV pattern exists, `SPEC.md:5458`); XLSX via `exceljs` (heavy) or a SheetJS build from its own distribution | licence / distribution check | 3 |
| **PPTX** | only for slide-shaped deliverables | defer; `pptxgenjs` if a slides kind is ever specced | — | later |

**Minimal first slice:** download the original MD/JSON, print-to-PDF, and copy as markdown. Every derived export says so in its footer, and **no path writes back to the original**.

### 4.6 Slices

**S6. Deliverables backend (CORE + CHIEF SPEC; three owners for the verbs).**
- *Acceptance:* versions are immutable (a test proves there is no update path).
- *Acceptance:* `submit_deliverable` requires the held claim and is idempotent.
- *Acceptance:* `/raw` returns the original bytes; every route calls `can()`.

**S7. Documents area (UI).** List, viewer, version picker, approve / request changes, JSON/CSV views, diff (with a dependency task).

**S8. Anchored comments (backend M + UI).**

**S9. KaTeX, then the Mermaid spike, then HTML/DOCX/XLSX exports.** Each is gated on its own dependency task.

Slice S7 (Documents area) also takes the trial's findings; S8 persists the
trial's in-browser annotations; S9's KaTeX and Mermaid items happen only if
the trial recommends them.

### 4.7 Backend list (CORE)

| Item | Size |
| --- | --- |
| SPEC decision: text deliverables ≠ uploads; §1.1 and §14 q5 wording | decision |
| `deliverables`, `deliverable_versions`, `deliverable_reviews` + REST + §3.1 rows | L |
| `submit_deliverable` MCP tool; `finish_task.deliverables[]` references; SPEC §7.1 | M |
| Activity verbs for deliverables (three owners) | S × 3 |
| `comments.deliverable_version_id` + `anchor` | M |
| Whether task Accept requires every linked deliverable approved | product decision |

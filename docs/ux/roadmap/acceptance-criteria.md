# Acceptance criteria

**Proposal.** How each phase of the UX transformation is signed off. The
detailed per-slice criteria live in each specification; this file is the
contract a reviewer checks a phase PR against. Criteria are frozen once a
task is in review (CLAUDE.md §2).

## 1. Cross-phase criteria (every PR)

**Gate and process**

- [ ] Full root gate green, each command captured on its own line and never
      piped: `pnpm test`, `pnpm lint`, `pnpm format` — all exit 0 (CLAUDE.md §5).
- [ ] One task, one branch (`LAI-NNN-short-name`), one PR into
      `integration-ui-transformation`; never into `master` (UX-3).
- [ ] The PR description lists: existing implementation, change, user problem
      solved, files, API dependencies, permission implications, tests, risks.
- [ ] **Review (UX-7).** Claude Code verifies implementation against the
      repository; GPT reviews architecture, UX, acceptance and the PR; Grok
      gives an independent critique (real user problems, unnecessary
      complexity, document scaling, library justification, permissions and
      security, architectural debt). **Agreement between reviewers is not
      proof** — every accepted claim cites repository evidence or a test.
- [ ] Docs-only and trivial changes need green CI but no separate review
      round; anything changing behaviour, permissions, data or security gets
      an independent review (CLAUDE.md §4).

**Product rules**

- [ ] No new dependency without its own task naming package and exact
      version; its PR states measured gzip size and passes the browser CSP
      test.
- [ ] CSP: no runtime `<style>`, no `eval` / `new Function`, no wasm; no
      relaxation of `style-src-elem` or `script-src`.
- [ ] Both themes; tokens only (colour only in `theme.css`); reduced motion and
      reduced transparency respected.
- [ ] Permissions: no control rendered that would 403; no client role
      inference; data the server scoped is shown as scoped.
- [ ] No mock data in production components (D-032); no invented backend
      states; no number the server did not return.
- [ ] Every interaction fix where interaction matters has a **browser**
      (Playwright) test — not a source-text assertion.
- [ ] Every touched component meets its family's 17-state contract
      (`../design-system/interaction-contracts.md` §2).
- [ ] An error is never shown as empty; one region's failure never replaces
      the page.
- [ ] Glass only through the glass primitives; documents, tables, code and
      forms stay solid.
- [ ] Agent-written text labelled agent-reported; AI output labelled per the
      AI policy; evidence shows claimed / confirmed / failed with source.

## 2. Foundation fixes (proposed track — pending open question 1)

- [ ] Every B1–B26 and V1–V15 item is fixed or explicitly deferred with a
      reason and a target phase.
- [ ] `theme.css` declares `--layer-*`, `--duration-*`, `--ease-*`,
      `--shadow-popover`, `--shadow-panel`, `--shadow-toast`, `--focus-ring`,
      `--bg-raised`, the radius ladder and `--space-0-5/7/8`; both themes
      declare the same names.
- [ ] Guards exist **and are shown red on a planted violation**: z-index ≥ 10
      is a layer token; radius tokens; spacing tokens; durations only in
      `theme.css`; letter-spacing only in `type.css`; `@media` widths and
      `matchMedia` from `breakpoints.ts`; no `<svg>` outside `icon/` and
      `agent-mark/`.
- [ ] One `prefers-reduced-motion` block, in `theme.css`.
- [ ] B16: a browser test opens a Dropdown inside a SidePanel at 1440 and
      asserts the menu is topmost (`elementFromPoint`).
- [ ] **CSP in the browser:** the Playwright harness serves the real
      `buildContentSecurityPolicy` header and fails on any
      `securitypolicyviolation` — landed before any new UI dependency.
- [ ] Every screen lazy from `route-table.ts`; main JS ≤ 200 KB gzip and main
      CSS ≤ 40 KB gzip, asserted by a size test.
- [ ] Single-source guards for each primitive built (Popover, Tooltip, Menu,
      Tabs, InlineConfirm, Toast, Dialog, `usePolled`, `useOpenTask`, Icon,
      StatusBadge, Identity); old copies deleted.
- [ ] Every modal surface: dialog role, `aria-modal`, label, trap, restore;
      guard counts 0 dialog files without `useDialogFocus`.
- [ ] My Day without time tracking shows the person's assigned and overdue
      work and a path forward (V2); the space header has one layout on every
      tab and no overlap at 390 (V3, V4).

## 3. Phase C — Task Workroom

- [ ] `?task=` on Board, List, Timeline, Calendar, Sprints, Dashboard, Activity
      and Meeting review renders the full panel (browser test per view).
- [ ] The drawer is `role="dialog"`, `aria-modal`, labelled by the title;
      focus trapped and returned; Escape in a menu closes only the menu.
- [ ] Task links from Meeting review, Unlisted and My Day open the right space.
- [ ] `TaskDetailPanel.tsx` under 300 lines, no part over 400; existing drawer
      tests pass unchanged.
- [ ] `/task/:key` with the Back semantics of `task-workroom.md` §2; separator
      passes the keyboard contract; widths persist; storage that throws still
      renders defaults.
- [ ] No nested same-axis scroll at 1280–1600; 390 has the sticky action bar.
- [ ] Every area has loading, empty, error-with-retry and permission states.
- [ ] Four agent lanes, each citing its source field; none renders a state
      the server did not send; "assigned to an agent" appears nowhere.
- [ ] Timeline merges activity, checkpoints, rounds and offers with source
      badges, grouped by `claim_generation`, paging through activity.
- [ ] Accept is never a single irreversible click; Send back requires a
      reason.
- [ ] Workroom side rails use glass level 1; the centre document is solid.

### Deliverable design trial (alongside C)

- [ ] Fixtures A, B, C (two versions each) exist, synthetic, and no fixture
      string reaches the production bundle (bundle test).
- [ ] T1–T10 each recorded pass / fail / caveat with measurements, in both
      themes at 390 and 1440, with **zero** `securitypolicyviolation` events.
- [ ] Mermaid tested only via the `<img>` data-URI route; `style-src-elem`
      unchanged.
- [ ] Each candidate library added under its own task; rejected candidates
      removed.
- [ ] A findings note and a renderer recommendation are published as a docs
      PR. Nothing persists outside the browser; no endpoint, table or upload
      path is added.

## 4. Phase D — Deliverable engine

- [ ] The SPEC decision on text deliverables vs uploads is recorded (D-xxx)
      before any table is added.
- [ ] All backend work ran against a local server and local SQLite with
      isolated fixtures; no production database, deploy, shared environment
      or external storage (UX-4).
- [ ] The public API is unchanged except for additions; every new route calls
      `can()`.
- [ ] Versions are immutable (a test proves no update path); `/raw` returns
      the original bytes.
- [ ] `submit_deliverable` requires the held claim and is idempotent; SPEC
      §7.1 and the server land together (`parity.test.ts`,
      `plugin-mcp.test.ts`).
- [ ] New verbs land as three-owner merges per CLAUDE.md §4.4.
- [ ] The Documents area uses the renderer the trial recommended; copy-section
      output equals the source slice byte for byte; MD download and
      print-to-PDF work.

## 5. Phase E — Management Review (+ Agent Operations v1)

- [ ] Every number and label comes from a cited endpoint.
- [ ] Technical and executive lenses render one fetched model; a test asserts
      identical failed / claimed / confirmed counts in both.
- [ ] Outstanding issues aggregates send-back, failed evidence, failed CI,
      undone deliverables, open blockers, uncertain saves and open questions;
      first and non-collapsible in presentation mode.
- [ ] The pack states its cap and when it is truncated; print keeps the issue
      counts.
- [ ] Agent Ops states its scope ("Your agents"); EXECUTING only from
      `TaskView.claim`; presence chips labelled "via presence"; no Stop,
      Retry or Resume control.
- [ ] Without a provider: only the disabled "AI summary (not enabled by your
      organisation)" line.

## 6. Phase F — Proactive intelligence

- [ ] Exactly one `EventSource` per signed-in session across navigation
      (guard); the four existing consumers keep working; a `gap` frame
      invalidates every subscriber; review-count pollers removed.
- [ ] Command Center sections each have loading, error-with-retry-keeping-data,
      empty and permission states; every number links to the same set or is
      not shown.
- [ ] Palette destinations equal the sidebar's gated set; ⌘K / Ctrl+K from a
      text field; no collision with My Day keys (test).
- [ ] No bell until `/me/notifications` exists; tier read from the server.
- [ ] AI policy: zero provider calls while disabled (test); disclosure names
      provider and host; secrets redacted (asserted on the request body);
      audit row per summary; model read from configuration.

## 7. Phase G — Final quality

- [ ] Browser suite covers 390, 768, 1024, 1280, 1366, 1440 and 1600 for the
      shell, Board, Workroom, Review and Command Center, both themes, with a
      no-horizontal-scroll assertion.
- [ ] axe pass per screen at 390 and 1440 in both themes, plus a manual
      screen-reader pass per surface.
- [ ] Glass composites meet AA against the worst-case backdrop in both themes;
      reduced-transparency and forced-colors fall back to solid.
- [ ] Performance budgets in `../design-system/responsive-accessibility.md` §3
      asserted by tests.
- [ ] Mobile IA: bottom bar, List default, task as full-screen sheet.

## 8. This PR (Phase B docs)

- [ ] Documentation only: no file outside `docs/ux/`, the task file
      `LAI-1124` and its log changes.
- [ ] Root gate exits 0 on all three commands.
- [ ] The owner reviews and approves; approval of this PR approves the
      documents as the reference for Phase C planning, not any build.

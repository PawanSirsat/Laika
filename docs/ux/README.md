# Laika UX transformation

**Status: proposal.** Nothing in this directory is approved for build until the
owner approves the phase it belongs to. Approving a phase approves that phase's
scope and acceptance criteria only — **it is not approval to adopt every
library named here or to redesign every screen at once.**

Basis: `master` @ `9ac3be1f` (2026-11-04), which is also the base of the
`integration-ui-transformation` branch. Task: `LAI-1124`.

## Purpose

Laika's engine records more about agent work than most tools show: numbered
claims, heartbeats, verified checkpoints, per-round evidence marked
*claimed / confirmed / failed*, review decisions, hand-offs. The UI exposes
much of it, but scattered and inconsistently. This set:

1. records what the UI is today, with `file:line` evidence (**audit**);
2. proposes the information and component architecture to fix it
   (**architecture**);
3. specifies the four product surfaces the transformation builds
   (**specifications**);
4. defines the visual and interaction foundation (**design-system**);
5. sequences the work and states how each phase is accepted (**roadmap**).

## How to read it

| If you want… | Read |
| --- | --- |
| the verdict in five minutes | [`audit/ux-audit.md`](audit/ux-audit.md) §1, then [`roadmap/implementation-roadmap.md`](roadmap/implementation-roadmap.md) §1 |
| what is broken, with evidence | [`audit/ux-audit.md`](audit/ux-audit.md) §3 |
| where to invest, by value and cost | [`audit/ux-opportunity-map.md`](audit/ux-opportunity-map.md) |
| what the next build phase (C) delivers | [`specifications/task-workroom.md`](specifications/task-workroom.md), [`specifications/deliverable-engine.md`](specifications/deliverable-engine.md) §2 (design trial) |
| the visual direction, including glass | [`design-system/visual-language.md`](design-system/visual-language.md) |
| what the server must add, and its size | [`roadmap/implementation-roadmap.md`](roadmap/implementation-roadmap.md) §4 |
| how a phase is signed off | [`roadmap/acceptance-criteria.md`](roadmap/acceptance-criteria.md) |

### Conventions used throughout

- **Evidence vs proposal.** Every section says which it is. Evidence carries a
  `file:line` citation against `9ac3be1f`; paths under `server/web/src/` are
  usually shortened to the file name where unambiguous. A proposal never
  carries a citation it does not have.
- **[E] / [UI] / [BE].** Exists today / UI-only work (SHELL, `server/web/`) /
  needs backend work (CORE, `server/` except `server/web/`). A change needing
  both follows CLAUDE.md §4.4; **a new `ACTIVITY_TYPES` verb is always three
  owners** (SPEC row, `enums.ts`, the web mirror).
- **(inferred)** marks a statement read from code but not observed running.
- **B-numbers** (B1–B26) are code-audit findings; **V-numbers** (V1–V15) are
  visual-audit findings. [`audit/ux-audit.md`](audit/ux-audit.md) §3 is the
  one deduplicated list.
- **Screenshots** are local evidence, not committed (see *Evidence* below).

## Index

| Path | Contents |
| --- | --- |
| `README.md` | this file: purpose, status, index, decisions log |
| `audit/ux-audit.md` | executive assessment; broken / likely-broken list B1–B26 + V1–V15, deduplicated |
| `audit/route-inventory.md` | every route and tab: entry, purpose, data, permissions, states, problems; eight journeys |
| `audit/interaction-inventory.md` | 17-state matrix per component family; terminology |
| `audit/ux-opportunity-map.md` | opportunity matrix: problem → user → impact → effort → UI-only/backend → phase |
| `architecture/experience-architecture.md` | IA, navigation, capability-aware views, palette, keyboard map, mobile IA, one org-wide SSE connection, Command Center, Agent Operations |
| `architecture/component-architecture.md` | current architecture assessment; component spec, one implementation per interaction; oversized-file split seams |
| `architecture/library-evaluation.md` | library matrix, CSP findings, verdicts; one task per dependency |
| `specifications/task-workroom.md` | the Workroom: drawer + `/task/:key`, areas, agent lanes, layout, states |
| `specifications/deliverable-engine.md` | deliverables model and renderer; the **deliverable design trial** |
| `specifications/management-review.md` | Review Studio: dashboard, review page, lenses, presentation, packs |
| `specifications/proactive-intelligence.md` | tiers, notification centre, triggers, provenance; the **AI policy** |
| `design-system/visual-language.md` | principles, the **glassmorphism design system**, tokens (layers, motion, breakpoints, radius/spacing, elevation, density, icons, type) |
| `design-system/interaction-contracts.md` | the 17-state contract per component family; explicit interactions and their API support today |
| `design-system/responsive-accessibility.md` | seven widths, accessibility strategy, performance budgets |
| `roadmap/implementation-roadmap.md` | phases, dependency map, backend gap analysis (CORE, S/M/L), open questions |
| `roadmap/acceptance-criteria.md` | per-phase and cross-phase criteria |

## Evidence and its limits

- **Code audit.** Five read-only audits of `9ac3be1f` (space views and drawer;
  home, inbox and insights; org, developer, settings and auth; design system;
  backend readiness), then four specification drafts. All from source reading.
- **Visual audit.** 204 screenshots of a locally seeded instance (three
  spaces, 46 tasks, four sprints, three agents), every route at 1440 in both
  themes and at 390 dark, five key screens at all seven widths in both themes.
  **Not committed**: every capture shows a team member's name in the sidebar
  footer and one shows a personal e-mail address, and this repository is
  public. File names are cited so a reader with the local set can open them.
- **Citations re-verified for this set** against the worktree at `9ac3be1f`:
  `SpaceLayout.tsx:259-270`, `TaskDrawer.tsx:123`,
  `TaskDetailPanel.tsx:639-646, 786-795`, `ListView.tsx:309, 400-403`,
  `Sidebar.tsx:208`, `SpaceLayout.tsx:211-222`, `CalendarScreen.tsx:42-50`,
  `ActivityScreen.tsx:39-47`, `ReviewScreen.tsx:45, 92, 486-495, 508-515`,
  `ShellSidebar.tsx:76`, `page-tabs.ts:42-52`, `route-table.ts:179-185`,
  `nav-permissions.ts:5-8`, `use-review-count.ts:56`, `dropdown.css:102-104`,
  `side-panel.css:11-20`, `event-stream.ts:126`,
  `server/src/http/routes/events.ts:124-136, 262-266, 322-326`,
  `server/src/services/provider.ts:155-161`,
  `server/src/http/security-headers.ts:67-90`, `styles/theme.css:40-52,
  179-184, 191, 300-306, 341-346, 362`, `tokens.test.ts:112, 119`,
  `theme-single-source.test.ts`, `docs/SPEC.md` §1.1, §12, §14 q5,
  `.github/workflows/deploy.yml:1-31, 171, 208`, the three `*Details.tsx` B10
  sites, and the file sizes in `component-architecture.md` §3.
  Other citations are carried from the audit reports at the same commit and
  marked where it matters.
- **Corrections made while consolidating:**
  - The org-wide SSE behaviour is in `server/src/http/routes/events.ts`
    (`projectId` stays `null` without `?project=`, :124-136; per-frame
    filter, :322-326), not `server/src/services/events.ts`.
  - B10 is narrower than first reported: the v3 *Reconnect* (non-paired) and
    *Disconnect device* buttons are `aria-disabled` without a visible reason,
    and their click handlers return early (`ToolDetails.tsx:563-570`,
    `DeviceDetails.tsx:159-169`). They look enabled and do nothing in those
    states; they are not dead in every state.
  - B23's stale comment is at `nav-permissions.ts:5-8`.
  - `theme.css` themes are `:root` (Obsidian dark, default) and
    `:root[data-theme='light']` (:191) — not a `prefers-color-scheme` pair.
    Every token proposal here is written against those two blocks.

## Decisions log

Approved by the owner before this PR. Each is reflected throughout the set.
Decisions in `docs/DECISIONS.md` remain the project's binding record; these
are recorded here as the transformation's working decisions, and any that
change SPEC behaviour still need a `D-xxx` entry by CHIEF.

| # | Decision | Where it shows |
| --- | --- | --- |
| UX-1 | **Phase sequence.** A = discovery and audit (done). B = UX architecture and design-foundation specs, then this docs PR. C = Task Workroom, with the **deliverable design trial** alongside it. D = deliverable engine (local backend allowed). E+ = Management Review, proactive intelligence, final quality. Each phase has its own acceptance criteria and reviewable PR(s). Approving a phase is not approval to adopt every library or redesign every screen at once. | `roadmap/` |
| UX-2 | **Docs live in `docs/ux/`**, not `docs/design/` (the owner's visual reference, D-020). | this directory |
| UX-3 | **Branching.** `master` = production. `integration-ui-transformation` = integration branch; it is named `integration-*` so CI runs the gate on its pushes and PRs, while a deploy happens only on a push to `master` (`.github/workflows/deploy.yml:1-13, 17-21`; the build and deploy jobs are `if: github.event_name == 'push' && github.ref == 'refs/heads/master'`, :171, :208). Feature branches target the integration branch. It merges to `master` only after integration validation and explicit release approval. | `roadmap/implementation-roadmap.md` §5 |
| UX-4 | **Backend from Phase D** is allowed only as local development — local server, local SQLite, isolated fixtures; no production database, deploy or shared environment; no external storage unless approved — preserving the public API, under CORE-owned tasks with their own reviews and tests. | `roadmap/implementation-roadmap.md` §4, `specifications/deliverable-engine.md` |
| UX-5 | **Deliverable design trial**, brought forward to run alongside Phase C. Document-first, **not uploads** (no file storage, upload APIs, attachment permissions or OCR). Three fixtures from controlled Markdown: **A** technical architecture report, **B** UAT / test report, **C** management summary. Validates rendering, TOC, code highlighting, Mermaid, tables with horizontal scroll, section navigation, version comparison, comments / annotations, full-screen reading and PDF export, under the CSP. | `specifications/deliverable-engine.md` §2 |
| UX-6 | **AI policy.** Disabled by default until an org admin enables an approved provider and policy. Per-category data rules; secrets never sent; disclosure, minimisation, redaction, audit, failure handling; no assumption that self-hosted means local AI; the UI separates system facts from AI interpretation. | `specifications/proactive-intelligence.md` §5 |
| UX-7 | **Review process.** Claude Code: implementation and repository verification. GPT: architecture, UX, acceptance and PR review. Grok: independent critique (real user problems, unnecessary complexity, document scaling, library justification, permissions and security, architectural debt). **Agreement between reviewers is not proof**: every claim needs repository and test evidence. | `roadmap/acceptance-criteria.md` §1 |

### Open questions for the owner

Recorded here and in `roadmap/implementation-roadmap.md` §6; not resolved by
this set.

1. **The stabilisation fixes (B1–B26, V1–V15) are not scheduled** under the
   approved phase list. Proposal: fold the drawer and dialog fixes into
   Phase C, and run the rest as a **Foundation fixes** track. Pending approval.
2. **Glass vs "surfaces step up, not shadow up".** The glass system adds
   translucency and blur where today's design is opaque steps.
   `visual-language.md` §3.9 lists the tensions with `docs/design/README.md`.
3. **Text deliverables vs uploads.** Is an agent posting a Markdown document as
   a string an "upload" under SPEC §1.1 / §14 q5? Needed before Phase D.
4. **AI summaries** need a SPEC §12 / §10.2 amendment and a `D-xxx` before any
   data leaves the instance for a second purpose.

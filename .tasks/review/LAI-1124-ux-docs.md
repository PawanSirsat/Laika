---
id: LAI-1124
title: 'UX transformation docs: Phase A audit and Phase B architecture and design specs under docs/ux/'
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-04T09:25:35Z
finished: 2026-11-04T09:40:15Z
---

## Goal

The UX transformation's Phase A (discovery and audit) and Phase B (UX
architecture and design-foundation specs) exist only as git-ignored working
notes under `.polly/`. Consolidate them into a reviewed, versioned set under
`docs/ux/`, so the owner can approve each later phase against a written
specification and its acceptance criteria. Documentation only: no source,
test, config, workflow or `docs/design/` change.

The PR targets `integration-ui-transformation`, not `master`.

## Acceptance criteria

- [x] `docs/ux/README.md` states purpose, how to read the set, status
      (proposal, approval per phase), an index of every file, and a decisions
      log recording the seven approved decisions.
- [x] `docs/ux/audit/` holds `ux-audit.md` (executive assessment, B1–B26 and
      V1–V15 deduplicated with cross-references), `route-inventory.md`,
      `interaction-inventory.md` and `ux-opportunity-map.md`.
- [x] `docs/ux/architecture/` holds `experience-architecture.md`,
      `component-architecture.md` and `library-evaluation.md`; the last says
      every dependency needs its own task.
- [x] `docs/ux/specifications/` holds `task-workroom.md`,
      `deliverable-engine.md` (with the deliverable design trial),
      `management-review.md` and `proactive-intelligence.md` (with the AI
      policy).
- [x] `docs/ux/design-system/` holds `visual-language.md` (with the
      glassmorphism design system and tokens), `interaction-contracts.md` and
      `responsive-accessibility.md`.
- [x] `docs/ux/roadmap/` holds `implementation-roadmap.md` (phases,
      dependency map, CORE-owned backend gaps sized S/M/L, the open question
      on stabilisation fixes) and `acceptance-criteria.md`.
- [x] Every `file:line` citation restated in the set was re-checked against
      the worktree at 9ac3be1f, or is marked as carried from the audit and not
      re-verified; corrections are listed in the README.
- [x] No file outside `docs/ux/`, this task file and its log is changed.
- [ ] The root gate exits 0 on all three: `pnpm test`, `pnpm lint`,
      `pnpm format`.

## Notes / context

- Source material (read-only, git-ignored): `.polly/phase1-ux-audit.md`,
  `.polly/proposal/*.md`, `.polly/screenshots/`.
- `docs/` is CHIEF-owned; this is CHIEF's documentation capacity. No code.
- No dependency is added. Library verdicts in the docs are proposals; each
  adoption needs its own task naming the package and version (CLAUDE.md §5).
- Screenshots: at most about twelve, each under 300 KB, only if no repo rule
  forbids binary docs assets.
- Docs-only change: green CI, no separate review round (CLAUDE.md §4); the
  owner approves by reviewing the PR.

## Submission notes

- Screenshots were **not committed**: every capture shows a team member's
  name in the sidebar footer and one shows a personal e-mail address, and the
  repository is public. The README cites them as local evidence by file name.
- The gate's three exit codes are recorded in the log
  (`logs/chief-2026-11-04-LAI-1124.md`) and the PR description.
- **Gate, locally: LINT 0, FMT 0, TEST 1 — criterion left unticked.** Two
  full `pnpm test` runs on this machine (load average 22–26 on 10 cores from
  other processes) failed on different sets — 8 tests, then 18, mostly
  disjoint — all `Test timed out in 5000ms`, `timed out waiting`, or a
  clock-bound assertion (`auto-pickup.test.ts:174` expects an age in seconds;
  the test itself took 51.9 s). Run 1's failures all pass in isolation. The
  code under test is byte-identical to `9ac3be1f`
  (`git diff --name-only 9ac3be1f -- server cli plugin docker package.json
  pnpm-lock.yaml` is empty); only `docs/ux/`, this file and its log differ.
  PR CI on a clean runner is the gate of record for this change.

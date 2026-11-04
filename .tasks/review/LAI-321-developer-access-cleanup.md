---
id: LAI-321
title: 'Developer access and profile cleanup: one row per repository, tools by tool, a short Advanced, a tidy token list'
area: web
assignee: strelka
priority: p1
depends-on: []
status: review
finished: 2026-11-04T20:11:57Z
started: 2026-11-04T18:35:29Z
---

## Goal

The owner walked through Developer access and a manager's view of a profile
(2026-11-04) and asked for:

- one row per repository with its devices underneath, in repository setup and
  project setup;
- the same grouping for Tools;
- Project setup that opens on the wizard only for a new user;
- a much shorter Advanced tab;
- a profile token list that does not sprawl.

They also asked why names repeat under one repository. Measured on
production, the owner's account:

- The Overview shows **"Laika · Laika" three times**, once per tool and device:
  Claude Code and Omnigent on the 36 GB Mac, and Polly on the 16 GB Mac.
  `setupRows()` groups by `project_id:agent_id`.
- The "names twice" is the title `<project> · <repo>` on repositories named
  after their projects, so it reads "Laika · Laika" and "OnRoute · On-Route".
  The data is right; the title repeats itself.
- The setups list adds a bare **"OnRoute"** row for the *I've added it*
  record, which has no repository.
- A manager sees **15 working tokens** of the owner's in a 17rem column. Six
  are named "claude-code on macOS" and three "omnigent on macOS"; three were
  never used.

The plan of record is the owner-approved plan of 2026-11-04 (`/Users/kvelld/.claude/plans/pasted-content-id-1ff9-take-hashed-hanrahan.md`
on Strelka).

## Acceptance criteria

- [x] **A. `repo_key` on a setup record.** `GET /project-setups` serves each
      record's `repo_key`, which is `''` when the record has no repository.
      The client type declares it, and SPEC's project-setups section has the
      row.
- [x] **B. One row per repository.**
      - The Overview's *Your repository setups* and Project setup's list show
        one row per project and repository. Each device that set it up is a
        line under the row, naming its tools and its own status.
      - The title is the repository's name, said once when it matches the
        project's ("On-Route" = "OnRoute").
      - The project and the instructions file form the meta line.
      - An *I've added it* record joins the repository it belongs to, as
        *also recorded by you*.
- [x] **C. Project setup.** A user with a setup sees their repositories first,
      with *Set up a new repository* at the top. A user with none sees the
      wizard.
      - `?tool=` and *Set up repository →* open the wizard directly.
      - `?view=setups` still works.
      - Depends on LAI-1099 being released to Strelka.
- [x] **D. Tools by tool.** One row per tool, with each device as a line under
      it, each keeping its own status and opening its own details. No line
      shows a name its owner typed: a tool is `<harness> · <device>`
      (D-120). This corrects the plan's "Omnigent — Polly". Depends on #250
      (LAI-1097), which is merged into this branch.
- [x] **E. Advanced, folded.** This adds to LAI-1100's criteria, which still
      apply.
      - The credentials list and *+ New* stay on top. *Scope reference* and the
        API example go into one closed fold.
      - Activity sharing shows one status line, the scope and the command.
        *What is sent and never sent*, OpenTelemetry and the stored history
        are closed folds.
      - The classic screen is unchanged.
      - Depends on LAI-1100 being released to Strelka.
- [x] **F. A profile's tokens.**
      - A summary line by kind, and tokens with the same name grouped
        (*claude-code on macOS × 6*).
      - The 3 most recently used per kind, then *Show all*.
      - *Never used* and *Idle* marked; full-width compact rows.
      - Revoke stays per token, with its confirmation and impact line.
- [x] Each changed behaviour has a test that fails when the change is undone.
- [x] Both themes, desktop and 390px. No new design token and no raw hex.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0. GitHub's gate
      on the PR is the clean run.

## Notes

- **Areas.** `server/web/` (SHELL). A, by name only, also needs:
  `server/src/services/project-setups.ts` `toView`, plus its two server test
  files (CORE); and the project-setups field table in `docs/SPEC.md`
  (CHIEF). A is a §4.4 two-owner change that lands in one PR.
- **Sequencing** (owner, 2026-11-04):
  - #249 (LAI-1096) and #250 (LAI-1097) merge first.
  - Belka releases LAI-1099 and LAI-1100 (asked on LAIKA-954 and LAIKA-955).
  - F and A do not wait; B follows #249.
- **Ids.** This session's LAI-1115–1123 were filed from CHIEF's block. This one
  is from Strelka's, as D-097 says.
- **Reuse:**
  - `setupEvidence()` and `recordState` (`v3/project-setup.ts`);
  - `agentProductName` and `agentLabel`;
  - the nested-list markup in `DevicesSection.tsx`;
  - `lastUsedLabel`, `tokensByKind`, `tokenAgentLabel` and
    `agentRevokeImpact` (profile);
  - the fields of `components/TokenRow.tsx`.

---
id: LAI-998
title: 'Release 2 is twenty reviewed-or-pending branches that have never been combined, on a master another session has moved'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-968, LAI-970, LAI-973, LAI-975, LAI-977, LAI-978, LAI-987, LAI-988, LAI-989, LAI-993]
discovered-from:
status: backlog
---

## Goal

Combine release 2 on `integration-owner-visibility-2026-10-22` (merged into
`master` as release 1 by PR #68) into one green tree, ready for cross-vendor
review and one PR to `master`.

## Acceptance criteria

- [ ] `git merge origin/master` first (another session shipped LAI-893, 895,
      991, 992, 996 and more since release 1).
- [ ] Merge, resolving conflicts without changing any feature's reviewed
      behaviour (list every resolution in the log):
      `origin/LAI-989-org-overview-activity-capabilities` (carries 993 → 976,
      981–986, 974; and 977 → 970), `origin/LAI-988-person-admin-panel`,
      `origin/LAI-987-people-tab-overhaul`,
      `origin/LAI-975-work-page-summary-and-paging`,
      `origin/LAI-978-spaces-page-redesign`,
      `origin/LAI-992-board-create-follows-task-create`,
      `origin/LAI-968-my-day-drafts-note`, `origin/LAI-973-plugin-readme-wording`.
      Logs: keep every entry from both sides.
- [ ] **Task-id collisions with `master`:** master's `LAI-991`, `LAI-992`,
      `LAI-996` are another session's done tasks. Renumber OUR task files that
      carry those ids (the branch-parser follow-up filed by LAI-976 as
      LAI-991; the board create gate filed as LAI-992; LAI-989's UNPAIRED
      follow-up filed as LAI-996) to the lowest ids free on every ref, each
      with a `## Renumbered` note naming the old id and the commits that carry
      it (§3: commits are not rewritten). `task-file-state.test.ts` green.
- [ ] Drop the server `UNPAIRED` entries the web halves paired
      (`TaskCountsView`, `OrgOverviewView`, `SignOutView`, `MembershipView`,
      `ResetLinkView`, `PasswordResetView`, and any other the merged tree
      reports stale) — this closes the LAI-996/LAI-997 follow-ups.
- [ ] Any conflict in feature code is resolved keeping both behaviours; if a
      resolution needs a behaviour choice, STOP and report.
- [ ] Gate on the merged tree: `pnpm test`, `pnpm lint`, `pnpm format`
      **all exit 0** — no allowed failures.

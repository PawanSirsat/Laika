---
id: LAI-877
title: 'Test: a block matched by its folder''s name confirms under that project'
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-866
status: backlog
---

## Goal

A block that no card named, put under a project because its folder's name
matched that project, is confirmed under that project: not as *General*, and
with no card. A test proves it, so a later change to confirming cannot quietly
drop the project.

## What is there today (read at `9250fc3e`)

- The only server confirm test for a named block
  (`server/test/services/time-folders.test.ts:230`) uses a block with a card
  (`LAI-1`). It shows the name is carried, not that a matched project is.
- `confirmRow` (`server/src/services/time-drafts.ts:1012`) confirms to
  `{ taskId: row.taskId, projectId: row.projectId }` (`:1026`). Nothing
  checks that `projectId` survives when there is no card.
- LAI-866's review notes (B1) left three boxes unticked: the project shown
  before confirming, a browser test of that, and this server test.

## Acceptance criteria

- [ ] **Service test.** An untied block from a folder named `Acme`, with a
      project `acme` the person can read, confirmed with `confirmDraft`,
      gives an entry under project `acme`, with no card, and not *General*.
- [ ] **Route test.** The same through
      `POST /api/v1/me/time-drafts/:id/confirm`. *Confirm day*
      (`POST /api/v1/me/time/days/:day/confirm`) does the same for that
      block.
- [ ] **Mutation.** In `confirmRow`, drop the project when there is no card.
      The new tests go red with an assertion error. Prove the mutation landed
      (a unique anchor and a `grep`), restore the file in a trap, and record
      the run here.
- [ ] **LAI-866's three unticked note boxes are ticked**, each naming the test
      that meets it. The browser one may already be
      `server/web/test/browser/my-day-folders.test.ts:74` (block `d4`); check
      it shows the project before confirming. A box nothing meets stays
      unticked and says so.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `server/test/services/time-folders.test.ts`,
  `server/test/http/routes/time-folders.test.ts`, and LAI-866's task file,
  for its three ticks only. No product code: if a test fails for a real
  reason, stop and say so on the card.
- Use `Acme` and `acme` in fixtures, never a real client's name.

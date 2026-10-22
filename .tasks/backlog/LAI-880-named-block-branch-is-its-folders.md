---
id: LAI-880
title: "A named block's branch is its own folder's branch"
area: cli
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-866
status: backlog
---

## Goal

When the person has turned the branch on (D-098), a block from a named folder
carries that folder's branch, or none. It never carries the branch of some
other folder the session started in.

## What is there today (read at `9250fc3e`, from reading only)

- A reply's folder comes from its own working directory
  (`cli/src/activity-time.ts:1069`). Its branch comes from the session's
  start (`:1076`, `sessionBranches` in `cli/src/time-folders.ts:144`),
  whatever folder the reply is in.
- So a session that starts on `x-branch` and then works in a folder named
  `Acme` should give the Acme block `x-branch`. This is from reading the code;
  the test below confirms it.

## Acceptance criteria

- [ ] **Drafter test.** With the branch on, a session starts on `x-branch`,
      then works in a different folder named `Acme`. The Acme block never
      carries `x-branch`. Run it first: if it passes on today's code, record
      that here, keep the test, and send it to review with no product change.
- [ ] A session that starts in the Acme folder still carries its branch: the
      existing branch tests pass unedited.
- [ ] **Nothing new leaves the machine.** The branch is sent only when the
      person turned it on, as today.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `cli/src/activity-time.ts`, `cli/src/time-folders.ts`,
  `cli/test/time-folders.test.ts`, `cli/test/activity-time*.test.ts`. If the
  folder's branch has to be read when a reply lands, and that needs the hook,
  `plugin/scripts/laika-activity-hook` and `cli/test/activity-hook.test.ts`
  too. The hook stays fork-free under zsh (LAI-859).

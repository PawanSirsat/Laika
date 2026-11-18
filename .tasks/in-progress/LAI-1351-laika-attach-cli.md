---
id: LAI-1351
title: '`laika attach`: agents attach outputs in one command; local secret check; the show-your-work skill and repo block revision 3'
area: cli
assignee: core
priority: p1
depends-on: [LAI-1302]
status: in-progress
started: 2026-11-18T21:56:47Z
---

## Goal

The CLI and plugin half of D-162. The one command agents run is:

```
laika attach <TASK-KEY> <file…> [--caption "…"]… [--comment "text"] [--unlisted <id>]
```

It uploads files to a task with captions, and posts a comment that links them. Every agent is also told when and how to show its work.

## Acceptance criteria

- [ ] **`laika attach`:**
  - It uses the tool credential (`readCredential`, `cli/src/agent-session.ts:213`), falling back to the person's token (`findCredentials`, `cli/src/activity-sync.ts:124`).
  - For each file it runs create (with a task key) → PUT to the presigned URL → complete, then posts one comment with a captioned link per file (or attaches them to an unlisted finding with `--unlisted`).
  - It prints each attachment's id and URL, or `--json`. Exit codes: 0 means everything was attached; anything else means nothing was linked.
  - It works for 1–20 files up to the board's cap (100 MB on Ksage).
- [ ] **Local secret check before upload:**
  - The same pattern list as the server (LAI-1302), applied to text files and to the text inside xlsx and docx (read their XML from the zip with Node's built-in `zlib`; no new dependency).
  - On a hit it refuses, names the file and the kind of secret without echoing it, and suggests masking. There is no override.
- [ ] **`laika doctor`** reports whether attach works: store reachable, permission, and the board's size cap.
- [ ] **New plugin skill `plugin/skills/laika-show-your-work/SKILL.md`**, covering:
  - when to attach (UI changes, generated files, incidents) and when not to (pure backend work where tests are the proof);
  - screenshots: before and after, light and dark, laptop and phone;
  - captions;
  - spreadsheets: a masked copy plus a PDF or screenshot rendition;
  - short recordings;
  - blockers;
  - the secrets rule, with masking examples.
- [ ] **The auto-pickup launcher's `workRequestPrompt`** (`cli/src/agent-launcher.ts:1010`) gets one line on outputs.
- [ ] **The repo block goes to revision 3** in `cli/src/project-check.ts`, matching LAI-1352's web copy, with a 7th rule *"Show the result"*.
- [ ] **Tests:** against a local board with a fake store, the happy path uploads 3 files and posts one comment. Secret refusals cover a password CSV and an xlsx containing a token. The first test fails if the command is missing.
- [ ] **The parent and child rule** (owner, 2026-11-19; LAI-1360 has the server side): a new feature with several parts gets one parent task, with each part as a child task. Work on an existing feature becomes a new child of its parent. A genuinely small one-off may stand alone. The main outputs go on the parent, a child's own outputs on the child.
  It goes into the `laika-show-your-work` skill, the launcher's `workRequestPrompt` and repo block revision 3 (`cli/src/project-check.ts`), worded as in LAI-1352.
- [ ] **Testing (owner):** once `laika attach` works against a local board, also attach the command's own output (a terminal screenshot or the `--json` result) to the parent card LAIKA-1153 on Ksage through the existing REST upload. That's the first real use.

## Notes / context

- No multipart is needed: the bytes go in a plain PUT body to the presigned URL.
- Plan: section 1 and section 2.

## Dependency deviation (CHIEF's call, 2026-11-18)

`depends-on: [LAI-1302]` is not in `.tasks/done/`: LAI-1302 (PR #405, branch
`origin/LAI-1302-attachments-agents`) is in a fix round on secret-scan internals
and unlisted read gating only. CHIEF confirmed its API surface as reviewed — the
REST create `POST /api/v1/projects/:slug/attachments` taking a task key,
`/attachments/:id/complete`, captions in links, and `finish_task` outputs — and
directed this task to start against it. The branch merges
`origin/LAI-1302-attachments-agents` and will merge `integration-ksage` again
once #405 lands, so the PR shows only this task's diff.


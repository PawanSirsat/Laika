---
id: LAI-1351
title: '`laika attach`: agents attach outputs in one command; local secret check; the show-your-work skill and repo block revision 3'
area: cli
assignee: unclaimed
priority: p1
depends-on: [LAI-1302]
status: backlog
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

## Notes / context

- No multipart is needed: the bytes go in a plain PUT body to the presigned URL.
- Plan: section 1 and section 2.

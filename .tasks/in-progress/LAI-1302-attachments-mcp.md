---
id: LAI-1302
title: 'Attachments for agents: upload tools, task-key upload, outputs on finish_task, unlisted findings, secret check'
area: server
assignee: core
priority: p1
depends-on: [LAI-1300]
discovered-from: LAI-1300
status: in-progress
started: 2026-11-18T21:09:01Z
---

## Goal

The owner's decisions of 2026-11-19, recorded as D-162:

- **Who and what:** agents may attach outputs they **deliberately choose to show a person**: screenshots, generated documents, test and run reports, and short recordings.
- **Where:** finishing a task, comments, blockers, new tasks, and unlisted findings.
- **Never:** secrets, or anything captured automatically.

This task is the server half. LAI-1351 is the CLI and plugin half, and LAI-1352 is the web half. Board card LAIKA-1070.

## Acceptance criteria

- [ ] **Upload tools:**
  - MCP `request_upload {task, filename, content_type, size_bytes}` returns `{attachment, upload}` plus a ready-to-run `curl` line for the presigned PUT.
  - MCP `complete_upload {attachment}` completes it.
  - Both have REST twins (`POST /projects/:slug/attachments` and `/attachments/:id/complete`), a §7.1 row and a README row; `parity.test.ts` and `plugin-mcp.test.ts` are green.
  - Bytes never pass through MCP or Laika.
- [ ] **Task key:** the create route accepts a task **key** (for example `LAI-123`) as well as an id.
- [ ] **`get_task_context`** lists the task's ready attachments: name, type, size, caption, Laika URL, and the round each belongs to.
- [ ] **`finish_task` takes `outputs: [{attachment, caption}]`:**
  - The files are linked to the task and to that round: through the round's summary comment if a round already links to it; otherwise add the smallest link and record it in D-162.
  - Captions are kept. A file belonging to another project or task is refused.
- [ ] **`add_comment`, `create_task` and `log_unlisted_work`** accept `attachments: [{attachment, caption}]`. Their tool descriptions say when to use it: errors and incidents, mockups and repros, evidence.
- [ ] **Unlisted findings:**
  - A migration (`ADD COLUMN`, no rebuild, numbered after integration-ksage's latest) adds `attachments.unlisted_work_id`, nullable.
  - The 24-hour sweep treats such files as linked.
  - Promoting a finding moves its files to the new task. Dismissing it soft-deletes them.
  - Run the cut-back fixtures and the agent-sessions census (memory: a new column breaks cut-back fixtures).
- [ ] **Inline video:** mp4 (`ftyp`) and webm (EBML) are sniffed as inline, so they play in the browser.
- [ ] **Secret check on complete:**
  - Text types (csv, txt, json, md, log, html, xml, yaml, env) up to 2 MiB are read through a ranged GET and scanned with the shared pattern list: passwords, AWS keys, private keys, `lai_`/`ghp_`/`gho_`/`sk-` tokens, and `.env`-style `KEY=secret` lines.
  - A hit refuses the completion with `secret_detected`, says which pattern without echoing the secret, and deletes the object.
  - Probe tests show each pattern is caught, plus one clean CSV that passes.
- [ ] **`MCP_INSTRUCTIONS`** gains, within its first 512 characters, *"Show your work: when a person needs to see the result (UI changes, generated files), attach screenshots or outputs with `laika attach` or `request_upload`, captioned. Never upload secrets."* The 2,048-character and 512-character tests stay green.
- [ ] **`get_project_context`**'s "Before you start" paragraph gets the same one-line rule.
- [ ] **SPEC updated:** §4.92 (`unlisted_work_id`, captions), §6.4 (task-key create, outputs), §7.1 (new tools and parameters), §13.4 (secret check, D-162).

## Notes / context

- Binary never goes through MCP (1 MiB body limit, text-only results). Agents `curl -T` straight to the store.
- An agent token can already create and complete over REST: `attachment.create` is not session-only. It needs a full-scope token, a full agent grant and agents allowed in the space.
- `uploaded_by` stays the human owner; the activity row shows the agent.
- **LAI-1350 must be released first or together with this,** because longer `finish_task` bodies (outputs with captions) must not hit the -32700 truncation. Build both in parallel (CHIEF, 2026-11-19).
- **Plan:** `~/.claude/plans/now-you-have-very-validated-perlis.md`, section 1.

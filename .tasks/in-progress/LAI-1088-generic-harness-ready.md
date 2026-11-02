---
id: LAI-1088
title: 'Omnigent and Hermes can reach Ready: the helper names its tool, reconnect keeps a manager''s other credential files, the tool panel says what is really missing'
area: shell
assignee: shell/belka
priority: p1
depends-on: [LAI-1083]
discovered-from: LAI-1083
status: in-progress
started: 2026-11-02T17:29:29+05:30
---

## Why

The owner, on production's Omnigent · Belka details (2026-11-02): *"check
why it's showing Missing"*. A read-only sweep of `origin/master` found:

1. The server's rule for a generic harness (D-125 item 4,
   `server/src/services/tool-setup.ts` ~654-661) needs a client report from
   the same token naming the harness; `cli/src/client-report.ts` never sends
   `harness`, so Omnigent and Hermes can never read Ready.
2. `laika tool add` / Reconnect revokes the agent's live tokens and writes
   `~/.laika/agents/<harness>.json`; on Belka Omnigent reads `polly.json`
   (LAI-589), which would keep the revoked token — Omnigent and every worker
   would drop to 401.
3. The tool panel's copy misleads: *Pair it before adding a tool* on a tool
   already added to an imported device; *named Codex, not Omnigent* for an
   orchestrator whose workers use its token by design (LAI-589, D-118); the
   status reason *Omnigent itself has not called it yet*; and a Helper
   reports command that sends no report for a legacy credential.
4. SPEC §4.81 says another tool's request never counts; the generic branch
   rightly does not read the client name for a manager's workers.

## Acceptance criteria

- [ ] The CLI's client report carries `harness` (a known slug the server
      accepts) when the caller knows it; `laika tool add` sends it.
      `sendClientReport` takes it as an optional argument so
      `cli/src/update.ts` (LAI-1085's) can pass it in one line.
- [ ] `laika tool add` (install or reconnect) also writes the new
      credential into any other file under `~/.laika/agents/` that held a
      token of the same agent, so a manager's own file (`polly.json`) never
      keeps a revoked one; it never prints a secret, never follows a symlink
      out of `~/.laika/agents/`, and says which files it updated.
- [ ] Tool panel copy (`server/web/.../v3/tool-readiness.ts`): Device paired
      on an existing tool on an imported device says its tools keep working
      and pairing is what lets Reconnect run without a secret; a generic
      harness's *connected* check and its status reason name the missing
      helper report and say requests from its workers on its credential are
      expected; Helper reports names a command that sends a report.
- [ ] SPEC §4.81 (named edit) and the comment at `tool-setup.ts` ~558 say a
      generic harness's MCP client name is not read, in line with D-118.
- [ ] Tests: CLI report body with and without harness; the extra credential
      file updated and a file of another agent untouched; each copy change
      in `tool-readiness`; mutation-checked.

## Notes

- Owner's direct instruction (2026-11-02). Not in scope, others own them:
  LAI-1085 (`laika update` reports when current — not editing
  `cli/src/update.ts`), LAI-1086 (Update your Laika CLI guidance),
  LAI-1084 (Project setup prompt), LAI-1087 (the rail).
- Named cross-area edits: `docs/SPEC.md` §4.81, one comment in
  `server/src/services/tool-setup.ts`.

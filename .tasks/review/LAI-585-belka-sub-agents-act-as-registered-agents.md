---
id: LAI-585
title: 'Belka sub-agents act as their registered agents'
area: ops
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-582
status: review
finished: 2026-10-28T20:24:13Z
started: 2026-10-28T20:14:04Z
---

## Goal

Claude Code and Codex sessions on Belka act on the Laika board as their
registered agents (Claude Code · Belka, Codex · Belka) rather than through
Pawan's personal token, so History reads "Pawan Sirsat via <agent>". Local
machine configuration only, approved by the owner in chat on 2026-10-29; no
repository code changes. Board card: LAIKA-839.

## Acceptance criteria

- [ ] Claude Code · Belka's credential rotated (it was exposed during LAI-582); old 401, new 200
- [x] Claude Code's `laika` MCP server for this repo authenticates as Claude Code · Belka; `laika agent hooks on --harness claude-code`
- [ ] Codex has a `laika` MCP server authenticated as Codex · Belka through an env-var bearer; `laika agent hooks on --harness codex`
- [x] Omnigent inheritance reported; no Omnigent agent spec touched
- [x] Fresh `claude -p` and `codex exec` sessions: `laika_whoami` names the right agent; one comment each reads "Pawan Sirsat via <agent>"
- [x] Every changed file backed up to `<file>.bak-2026-10-29`; rollback commands recorded on the card

## Notes

`~/.laika/env` and its personal token stay as they are: CHIEF (accepting into
Done) and the activity collector need the personal token. See
docs/acceptance/LAI-582-phase-1-2-live.md, "Making Belka's sub-agents act as
these agents".

## Outcome (2026-10-29, Belka)

- Not done: **rotation** of Claude Code · Belka's credential. A rotate needs a
  signed-in browser session, and the browser holding Pawan's session belonged
  to another live session. Pawan does it by hand (card LAIKA-839).
- Codex part done except **hook trust**, which Codex grants only in its
  interactive `/hooks` screen. Left for Pawan.
- Details, verification and rollback are on the card's comments.

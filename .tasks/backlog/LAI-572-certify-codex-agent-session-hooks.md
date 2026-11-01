---
id: LAI-572
title: 'Certify the Codex agent-session hooks on a real codex: trust them in /hooks, then run the session'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-542]
discovered-from: LAI-542
status: backlog
---

## Why

LAI-542's capability matrix (`cli/README.md`, *Harness capability matrix*)
certifies Claude Code 2.1.280 against a real board and leaves **every Codex
0.162.1 cell Documented-not-tested**. Codex runs a hook only after it is
trusted, and trust is given interactively in `/hooks` or by
`--dangerously-bypass-hook-trust`; the dispatched session was not permitted to
use the flag, so `codex exec` could not be smoke-tested headless.

## Scope

On a machine where the owner can trust hooks interactively:

1. A scratch agent on a private board (never the owner's token):
   `laika agent login codex --url <private board>` with the agent's secret on
   stdin.
2. `laika agent hooks on --harness codex`, then open `codex`, `/hooks`, trust
   the four `laika-agent-hook` entries.
3. One short `codex` session (interactive, or `codex exec` once trusted):
   check `laika agent session status` and the board's log for
   - `SessionStart` opening the session, bound to the `codex` process
     (`harness_pid` is the codex PID);
   - the watcher's heartbeats over the session;
   - the session id reaching the model through `additionalContext`;
   - `SessionEnd` ending it (`end_reason: ended`) — advisory in Codex, so a
     miss is recorded, not a failure.
4. `laika agent hooks off --harness codex` leaves `~/.codex/hooks.json` as it
   was.

## Acceptance criteria

- [ ] Each Codex cell in `cli/README.md` is Verified-and-tested or carries the
      measured reason it is not, with the Codex version run.
- [ ] If the process walk does not find Codex (its executable is not named
      `codex*`), the fix is in `cli/src/agent-session.ts` with a test.

## Notes

No new dependencies. Owner action needed for the trust step.

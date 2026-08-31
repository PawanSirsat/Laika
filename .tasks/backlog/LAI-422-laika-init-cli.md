---
id: LAI-422
title: npx laika init — one command from nothing to a working agent
area: cli
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**This is M4's exit criterion**: *"a new repo goes from nothing to an agent
working the board in one command."* `cli/` currently contains a README and
nothing else.

`npx laika init` — authenticate, mint a token, write local config (ROADMAP M4).
Everything it needs already exists: `POST /api/v1/tokens` (LAI-402), token auth
(LAI-403), `/mcp` (LAI-406).

## Settled before you start — D-046

**One mechanism. This CLI owns it.** Authenticating, minting, and **choosing
where the configuration lives** are decided once, here. `/laika:setup` (LAI-420)
invokes this and adds nothing but the invocation.

**Why this side:** it is the only one that works before the other exists —
somebody with no plugin installed still needs a token, which is the whole of
`npx`. A mechanism that only runs inside an already-configured Claude Code
session cannot be the thing that configures Claude Code.

**And it is what makes AC5 provable.** Two doors writing two config locations
means a user who ran both has two tokens, one of which they cannot see, and
neither door can honestly report on the other. **"Does not silently mint a second
token" is not satisfiable by a design with two homes** — so name the one location
in this task and say it in the CLI's own output.

## Acceptance criteria

- [ ] `npx laika init` runs in a repo with no Laika configuration and ends with a
      working `LAIKA_URL` and `LAIKA_TOKEN`.
- [ ] **Authentication does not ask for a password on the command line.** A
      password in shell history is a credential leak with a long tail. Prompt
      without echo, or open a browser, or take an existing token — whichever, say
      why in your log.
- [ ] It mints through `POST /api/v1/tokens` and **shows the secret exactly
      once**, matching what §4.9 already guarantees. It does not store the
      plaintext anywhere but the config file it is writing.
- [ ] **The config file is never committed.** It is gitignored, or written
      outside the repo, and `init` says which. A token in someone's git history
      is the failure this whole task exists to avoid.
- [ ] **Idempotent.** Run twice and the second run does not mint a second token
      silently — it says one already exists and offers to replace it.
- [ ] **Every failure names what to do**: wrong URL, refused credentials, board
      unreachable, no permission to mint. Not a stack trace, and not the same
      message for all four (LAI-224, LAI-090 — both were exactly this defect).
- [ ] Verified end to end against a real instance: fresh repo → `init` → an agent
      lists ready tasks through `/mcp`. **That, plus a heartbeat row, is M4's
      exit.**
- [ ] Full gate green.

## Notes

**A new dependency needs a task that names it.** This one names **none**. If
`init` genuinely cannot be written without a package, stop and file a task naming
it and saying why `node:readline` and `fetch` are not enough — do not add one
under this task's authority (CLAUDE.md §5).

`cli/` is SHELL's. The endpoints are CORE's. Anything the API does not expose is
a task with `area: server`, not a workaround here.

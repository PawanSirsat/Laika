---
id: LAI-422
title: npx laika init — one command from nothing to a working agent
area: cli
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T23:21:16Z
---

## Goal

**This is M4's exit criterion**: *"a new repo goes from nothing to an agent
working the board in one command."* `cli/` currently contains a README and
nothing else.

`npx laika init` — authenticate, mint a token, write local config (ROADMAP M4).
Everything it needs already exists: `POST /api/v1/tokens` (LAI-402), token auth
(LAI-403), `/mcp` (LAI-406).

## One thing to settle before building

**This overlaps `/laika:setup` (LAI-420).** §8 says the slash command writes
`LAIKA_URL` and `LAIKA_TOKEN` into user settings; the ROADMAP says this CLI
does "authenticate, mint a token, write local config". One mechanism with two
front doors, or two different things — **the spec does not say.**

**Raise it; do not settle it by implementing** (LAI-139). If the answer is "one
mechanism", one of these calls the other and the shared part needs a home. Build
the parts that are unambiguous while you wait.

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

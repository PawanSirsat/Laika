---
id: LAI-622
title: Settings → Connect — a new developer connects from inside the product
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-621
status: review
finished: 2026-09-28T16:41:03Z
started: 2026-09-28T16:26:57Z
---

## Goal

A signed-in developer opens **Settings → Connect** and gets from nothing to a
Claude Code session that reads this board, without opening any other document.
Today the path lives in a file on the owner's laptop and a shared page: neither
is in the product, neither knows which board the reader is on, and both carry a
token pasted by hand. The owner's words: *"it's very complicated to do that."*

## The finding this is built around

Measured on the live deployment, not assumed:

```
http://52.72.203.206  ->  window.isSecureContext: false
                          typeof navigator.clipboard: "undefined"
```

Browsers disable the clipboard API outside a secure context, so **every Copy
button in Laika is broken where Laika actually runs**. `TokensScreen` calls
`navigator.clipboard?.writeText(...)` and sets `copied = true` regardless — it
says "Copied" having copied nothing. A page made of copy buttons must solve
that before it is worth building.

## Acceptance criteria

- [x] A new org-level SETTINGS route `/connect`, **first in the group** — it is
      the only entry a person with nothing set up can act on.
- [x] The page mints its own token (90-day expiry, named for the machine) and
      interpolates it into every block; before minting the blocks read `lai_…`
      and never `undefined`. The one-time secret uses `TokensScreen`'s
      two-phase `forget()` scrub, and no derived copy of the secret is held in
      a second hook.
- [x] A one-paste prompt that installs the plugin, proves the board answers,
      **and writes the Laika block into the project's `CLAUDE.md`** so later
      sessions mirror work onto the board unasked. An "or run it yourself"
      block carries the same commands.
- [x] A **live check**: a bounded watch on presence that turns green only for
      an *agent* session belonging to this reader, and stops on a hit, on its
      budget, on presence being disabled, on error, and on unmount.
- [x] A `CLAUDE.md` block generated with the selected project's real slug and
      prefix, carrying **no token** — it is committed.
- [x] A reference of what an agent can do, and an invite pointer for owners.
- [x] `CopyButton` sets "Copied" only from the resolved promise and, where the
      clipboard API is absent, selects the text and says so instead of lying.
      Exactly one module in `src/` touches `navigator.clipboard`.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Notes / context

- Owner-directed, 2026-09-28. Owner chose the token *in* the prompt (one paste)
  over keeping it out of the transcript; the page says so plainly and names the
  revoke path. Mitigation kept: a 90-day expiry.
- Plan: `~/.claude/plans/we-alredy-have-front-delegated-dahl.md`.
- Siblings: LAI-623 (make `laika init`/`whoami` real), LAI-624 (SPEC §8, CHIEF).

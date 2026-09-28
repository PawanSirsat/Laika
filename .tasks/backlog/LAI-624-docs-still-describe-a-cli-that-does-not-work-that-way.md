---
id: LAI-624
title: The docs describe a CLI invocation and a setup path that do not exist
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-623
status: backlog
---

## What is wrong

Three documents describe how a machine gets connected to a board, and each of
them is wrong in a different way. All three are in `docs/`, so SHELL filed
rather than edited (CLAUDE.md §1).

### 1. `npx laika init` cannot work, and two documents still offer it

The package is `private: true` and unpublished, so on a clean machine
`npx laika` resolves to an unrelated public package or fails. LAI-623 replaced
every live instance under `cli/`, `plugin/` and `server/web/src/` with `laika`,
installed on PATH by `plugin/scripts/install.sh`. These remain:

- `docs/ROADMAP.md:105` — "`npx laika init` CLI: authenticate, mint a token…"
- `docs/ROADMAP.md:109`, `:121`
- `docs/FEATURES.md:105` — the row still reads `[planned phase 4]`, and the
  CLI shipped in LAI-422 on 2026-09-02.

`docs/DECISIONS.md:2137` (D-046) also names it, and **should not be changed** —
decisions are append-only records of what was decided. A fresh decision or a
note elsewhere is the way to correct it.

### 2. SPEC §8 says the env vars are written by something that writes nothing

§8 says `LAIKA_URL` and `LAIKA_TOKEN` are *"written by `/laika:setup`"*. D-046
decided the opposite — the CLI owns configuration and `/laika:setup` is a front
door onto it — and `plugin/scripts/laika-setup.sh` writes no settings at all.

### 3. SPEC §8 names a Skill that does not exist

There is no such skill in `plugin/`. Either it is planned and the SPEC should
say so, or the sentence should go.

## Why it matters now

The Connect screen (LAI-622) makes `install.sh` the path every new joiner
takes. A developer who reads the SPEC or the ROADMAP to understand what just
happened to their machine is told a different story by each, and one of the
commands on offer fails on a clean machine. This is the first hour of somebody
new; it is the worst place to have three documents disagreeing.

## Acceptance criteria

- [ ] `docs/ROADMAP.md` and `docs/FEATURES.md` name `laika init` rather than
      `npx laika init`, and `FEATURES.md`'s row reflects that it shipped.
- [ ] SPEC §8 matches D-046 on who writes the environment variables.
- [ ] SPEC §8's Skill reference either names something that exists or is
      removed, and the criterion is checked **against §8 itself**, not against
      a description of it (CLAUDE.md §2).
- [ ] `DECISIONS.md` is not rewritten.

## Notes / context

- Found by LAI-623's census of `npx laika` across the repo — run without a
  `head`, which is the only reason `FEATURES.md:105` was in the list.

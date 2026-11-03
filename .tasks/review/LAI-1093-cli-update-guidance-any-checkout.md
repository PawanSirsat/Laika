---
id: LAI-1093
title: 'Getting a current Laika CLI works from any checkout: not at ~/laika, too old for laika version, detached, or none'
area: shell
assignee: shell/belka
priority: p1
depends-on: []
discovered-from: LAI-1086
started: 2026-11-03T11:58:36+05:30
status: review
finished: 2026-11-03T12:22:04+05:30
---

## Why

Real failure, 2026-11-03, on the owner's new laptop (user `kvelld`): the
installed `laika` was so old it had no `version`, `update` or `device`
command. Every hint the UI gave assumed the checkout lives at `~/laika`:
`git -C ~/laika pull --ff-only` failed with `cannot change to
'/Users/kvelld/laika': No such file or directory`, and the Add device
*already installed* line's `laika update --check …` failed with
`unknown command "update"`. They were stuck with a live pairing code.

`pull --ff-only` also fails on a checkout `laika update` left detached at
the board's commit (`You are not currently on a branch`).

## Scope

SHELL: `server/web/` and `cli/README.md` only. Builds on LAI-1086, LAI-1084,
LAI-1090 and LAI-1091, all merged to `master` (their files sit in review).

## Acceptance criteria

- [x] Every site that tells a developer how to get a current CLI is found by
      an untruncated grep and fixed: the *How to update your Laika CLI* guide
      (LAI-1086), Add device's *Already have Laika installed?* line and its
      *installed* option, Add tool's equivalent, Project setup's old-CLI hint
      (LAI-1084/1090/1091), the status legend's and *Version unknown*'s
      reason text, Tool details' *How to update*, and `cli/README.md`.
- [x] The guidance works when the checkout is not at `~/laika`, when the CLI
      predates `laika version`/`laika update`, when the checkout is detached,
      and when there is no checkout: `laika version` (prints a commit →
      `laika update`, with `--board`/`--allow-http` as the board needs);
      unknown command → `ls -l "$(command -v laika)"` shows where it comes
      from; recommended for an old CLI → the fresh install filled from the
      board's own `cli.source` (`git clone` or, when `~/laika` exists,
      `git -C ~/laika fetch origin`; `checkout --detach <commit>`;
      `install.sh --no-credential`; `rehash` / `hash -r`; `laika version`),
      saying the old checkout is left untouched; the install.sh relink note
      and the one `ln -sf` fix for a symlink earlier on PATH.
- [x] No token printed or asked for. Next to a pair command, it says to make
      a fresh code after updating (codes last ten minutes).
- [x] Tests: the guide/hint tests updated; no rendered guidance has a bare
      `~/laika` pull without the find / fresh-install alternative; the
      paste-safety test (nothing a shell acts on unquoted) covers the new
      commands.
- [x] Light/dark and 390 px screenshots of the changed hints in
      `.polly/evidence/LAI-1093/`.

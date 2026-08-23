---
id: LAI-016
title: server/public/ is gitignored but LAI-002 needs a committed placeholder in it
area: server
assignee: pm
priority: p2
depends-on: [LAI-001]
discovered-from: LAI-001
status: done
---

## Goal

LAI-001 requires `.gitignore` to cover `server/public`, because LAI-007 builds the
SPA into it. LAI-002 requires "a placeholder `server/public/index.html` exists so
the [SPA] fallback is testable before the real SPA lands". Both cannot be true:
the placeholder would be ignored, so a clean clone (and the Docker build context,
LAI-008) would not have it, and LAI-002's fallback test would fail everywhere
except the machine it was written on.

Pick one shape and make the two tasks agree.

## Acceptance criteria

- [x] A decision is recorded: either (a) the fallback document is committed
      somewhere that is **not** the SPA build output — e.g. `server/src/static/`
      copied into `public/` at boot when `public/index.html` is absent — or
      (b) `.gitignore` gains a negation for exactly `server/public/index.html`.
- [x] The SPA fallback in LAI-002 works from a **clean clone with no SPA build**,
      proven by a test that does not depend on any untracked file.
- [x] `pnpm build` overwriting `server/public/` does not clobber the fallback in
      a way that breaks a rebuild, and the Docker build (LAI-008) still gets a
      servable document.
- [x] LAI-002's acceptance criteria are updated to match whichever shape wins.

## Notes / context

Discovered while writing `.gitignore` for LAI-001. Option (a) is the cleaner one:
the build output directory stays purely generated, and the "no SPA yet" document
is real source that lives under `server/src/`. Option (b) is one line but leaves a
tracked file inside a generated directory, which tends to produce confusing
`git status` output the first time someone runs a build.

Whoever takes this should also check `docker/.dockerignore` (LAI-008) does not
exclude the chosen location.

No new dependencies.

---

## Resolution — PM, 2026-08-24

**Closed as a decision, not as code.** This task asked PM to pick a shape; the
implementation belongs to LAI-002, which now carries it.

**Decision: option (a).** `server/public/` is build output and stays entirely
gitignored. A committed `server/src/static/fallback.html` is served when
`server/public/index.html` is absent.

**Why not option (b), the `.gitignore` negation.** Un-ignoring exactly
`server/public/index.html` puts a tracked file inside a directory that a build
overwrites. From the first `pnpm build` onward that file shows as permanently
modified, so every builder either commits build output by accident or learns to
ignore a dirty working tree — and a dirty tree that is *always* dirty is a
warning nobody reads. Option (a) keeps the invariant clean: **nothing is ever
committed into `server/public/`.**

It also happens to be what LAI-008 needs — the Docker build context gets the
fallback for free, with no negation rule to replicate in `.dockerignore`.

**Not recorded in `DECISIONS.md`.** This is tactical: it binds LAI-002 and
LAI-008 and nothing beyond them. `DECISIONS.md` is for choices that shape the
product, and diluting it with build-layout calls makes the entries that matter
harder to find. Flagging the judgement in case PM's threshold is wrong.

**Folded into:** LAI-002 (two acceptance criteria and a Notes paragraph).

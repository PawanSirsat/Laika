---
id: LAI-016
title: server/public/ is gitignored but LAI-002 needs a committed placeholder in it
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-001]
discovered-from: LAI-001
status: backlog
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

- [ ] A decision is recorded: either (a) the fallback document is committed
      somewhere that is **not** the SPA build output — e.g. `server/src/static/`
      copied into `public/` at boot when `public/index.html` is absent — or
      (b) `.gitignore` gains a negation for exactly `server/public/index.html`.
- [ ] The SPA fallback in LAI-002 works from a **clean clone with no SPA build**,
      proven by a test that does not depend on any untracked file.
- [ ] `pnpm build` overwriting `server/public/` does not clobber the fallback in
      a way that breaks a rebuild, and the Docker build (LAI-008) still gets a
      servable document.
- [ ] LAI-002's acceptance criteria are updated to match whichever shape wins.

## Notes / context

Discovered while writing `.gitignore` for LAI-001. Option (a) is the cleaner one:
the build output directory stays purely generated, and the "no SPA yet" document
is real source that lives under `server/src/`. Option (b) is one line but leaves a
tracked file inside a generated directory, which tends to produce confusing
`git status` output the first time someone runs a build.

Whoever takes this should also check `docker/.dockerignore` (LAI-008) does not
exclude the chosen location.

No new dependencies.

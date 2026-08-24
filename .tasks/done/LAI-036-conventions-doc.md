---
id: LAI-036
title: Write docs/CONVENTIONS.md — structure, naming, layering, tests
area: docs
assignee: pm
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-24T06:00:00+05:30
finished: 2026-08-24T06:10:00+05:30
reviewed: 2026-08-24T06:10:00+05:30
---

## Goal

The repo had conventions and almost none were written down. `CLAUDE.md` §5 covered
what must be true of the code; nothing covered where files go, what they are
called, or which layer may import which. Those were decided ad hoc by whoever got
there first.

## Acceptance criteria

- [x] `docs/CONVENTIONS.md` covers directory structure, layering, naming, the
      paired-module pattern, and test conventions — for every area, not just the
      frontend.
- [x] Linked from `CLAUDE.md` §5 and `docs/README.md`.
- [x] Every rule names how it is enforced, or says it is enforced at review.
- [x] Implementation filed: LAI-037, LAI-038, LAI-039.
- [x] LAI-010 and LAI-011 depend on LAI-037.

## Resolution — PM, 2026-08-24

Written from the approved plan.

**The load-bearing rule is §2, layering.** SPEC §7 and §11.2 both require MCP
tools to be thin wrappers over the same services the REST routes use, and
`server/src/services/` did not exist. LAI-010 and LAI-011 were about to write the
first real handlers. Encoding the direction of imports in
`no-restricted-imports` makes divergence impossible rather than merely tested —
the §13.3 parity tests then confirm a property the structure guarantees.

**Documented what already existed rather than inventing:**

- The paired-module pattern (`http/rate-limit.ts` + `http/middleware/rate-limit.ts`)
  was a real, good pattern that nobody had named, so it would not have been
  repeated deliberately.
- kebab-case-except-React-components matches every file in the repo today, so it
  is codified rather than churned. `TokenReference.tsx` beside
  `token-reference.css` is correct and reads as inconsistent — worth stating
  explicitly for exactly that reason.
- Structural tests are already an idiom here (`tokens.test.ts`, `build.test.ts`,
  `format-fix.test.ts`), so §4 points at that rather than at a lint plugin.

**Two test runners kept deliberately** (owner's decision) with the rationale
recorded, so the next person reads it as a choice rather than drift.

**Zero new dependencies**, which mattered: `no-restricted-imports` is core
ESLint, and filename casing goes to a structure test precisely to avoid adding
`eslint-plugin-unicorn` against `CLAUDE.md` §5.

**Not done here:** renaming existing files, changing `plugin/` or `docker/`
layouts. LAI-038's exemption list is what makes adoption possible without a mass
rename — a structure test that forces 40 renames on day one gets reverted, not
adopted.

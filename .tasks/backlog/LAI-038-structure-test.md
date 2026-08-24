---
id: LAI-038
title: structure.test.ts — enforce naming and test-mirroring
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-037]
discovered-from: LAI-036
status: backlog
---

## Goal

Make `docs/CONVENTIONS.md` §3 and §4 mechanical. A structural test, in the idiom
this repo already uses well — `tokens.test.ts` walks CSS, `build.test.ts` walks
`dist/`, `format-fix.test.ts` builds a real git repo.

## Acceptance criteria

- [ ] `server/test/tooling/structure.test.ts` asserts, over `server/src/`:
      - every file and directory is kebab-case, **except** `*.tsx` components,
        which are PascalCase and match their exported component name;
      - no `index.ts` barrel files (a file whose only statements are re-exports);
      - every `src/**/*.ts` has a mirrored `test/**/*.test.ts`, **or** appears in
        an explicit exemption list at the top of the file.
- [ ] The exemption list is seeded with today's genuine exceptions and each entry
      carries a one-line reason. It is a list to shrink, not a place to hide.
- [ ] Failure messages name the offending path and the rule, so a builder can act
      without opening the test.
- [ ] **Confirmed able to fail**: add `src/badName.ts`, watch it go red, remove
      it. Same for a barrel and a missing mirror. Record it in your log.
- [ ] Full gate green.

## Notes / context

`docs/CONVENTIONS.md` §3, §4, §5.

**Start with an exemption list rather than a rename.** Adopting this must not
require touching files no task is otherwise touching — entries come off the list
as tasks reach those files. A structure test that forces a 40-file rename on the
day it lands will be reverted, not adopted.

**Scope is `server/` only.** `server/web/` is Builder-B's (D-016) and is covered
by LAI-039, which extends this test rather than writing a second one.

No new dependencies — this is why the repo is not adding `eslint-plugin-unicorn`
for filename casing.

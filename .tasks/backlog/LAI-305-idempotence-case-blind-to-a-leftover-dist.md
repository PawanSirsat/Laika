---
id: LAI-305
title: 'The build idempotence case passes the LAI-028 regression when dist/ is left over'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-847
status: backlog
---

## Goal

`produces an identical tree on a second run with no clean between`
(`server/test/tooling/build.test.ts`) fails on its own when the build is no
longer idempotent, whatever `dist/` held before the file ran.

## Acceptance criteria

- [ ] With `pnpm run clean && ` removed from `server/package.json`'s `build`
      and a `dist/` left by an earlier build, the idempotence case fails on
      its tree assertion. Today it passes.
- [ ] The same mutation starting from an empty `dist/` still fails the case,
      as it does today.
- [ ] No sibling case changes what it asserts. The three real builds stay
      real.

## Evidence / context

Found while mutating for LAI-847 on Strelka. With `clean` removed and the
`dist/` from an earlier run present, the case passed in 83026ms: the first
tree read in the case already held `db/migrations/migrations/` and
`static/static/`, so the second and third builds reproduced it exactly. Its
siblings went red (`never nests the copied asset directories`, `leaves
exactly one migration journal…`, `drops output…`: 3 failed out of 16), so
the regression does not ship. The case is still not checking the property
its name claims in the state every second gate run in a worktree starts
from. From an empty `dist/` the same mutant fails the case after 58851ms
(`expected [ …(485) ] to deeply equal [ …(389) ]`).

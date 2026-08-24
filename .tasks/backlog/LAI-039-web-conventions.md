---
id: LAI-039
title: Apply the conventions to server/web and extend the structure test
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-038]
discovered-from: LAI-036
status: backlog
---

## Goal

`docs/CONVENTIONS.md` applies everywhere, not just to the server. Bring
`server/web/` in line and put it under the same automated check.

## Acceptance criteria

- [ ] `server/web/src/` and `server/web/test/` satisfy CONVENTIONS §3: kebab-case
      throughout, PascalCase only for `*.tsx` components matching their export,
      no barrel files.
- [ ] `server/web/test/` mirrors `server/web/src/`.
- [ ] LAI-038's `structure.test.ts` is **extended** to cover `server/web/` — not
      duplicated. One rule set, two trees.
- [ ] The web half runs in whichever suite makes sense; if that means the check
      lives in `@laika/web` under `node --test`, say why in your log rather than
      moving the server's copy.
- [ ] **Confirmed able to fail** on a deliberate web violation.
- [ ] Full gate green, both runners.

## Notes / context

`docs/CONVENTIONS.md` §3, §4.

`TokenReference.tsx` beside `token-reference.css` is correct under §3 and needs
no change — the component is PascalCase, its stylesheet is kebab-case. It reads
as inconsistent and is not; if that trips you up it is worth a note, because it
will trip up the next person too.

**Two runners is a decision, not drift** (CONVENTIONS §4). Do not unify them as
part of this task. If web ever needs component rendering, that is a task of its
own.

No new dependencies.

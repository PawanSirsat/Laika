---
id: LAI-039
title: Apply the conventions to server/web and extend the structure test
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-038]
discovered-from: LAI-036
status: review
finished: 2026-08-24T07:46:51+05:30
started: 2026-08-24T07:41:25+05:30
---

## Goal

`docs/CONVENTIONS.md` applies everywhere, not just to the server. Bring
`server/web/` in line and put it under the same automated check.

## Acceptance criteria

- [x] `server/web/src/` and `server/web/test/` satisfy CONVENTIONS §3: kebab-case
      throughout, PascalCase only for `*.tsx` components matching their export,
      no barrel files.
- [x] `server/web/test/` mirrors `server/web/src/`.
- [x] LAI-038's `structure.test.ts` is **extended** to cover `server/web/` — not
      duplicated. One rule set, two trees.
- [x] The web half runs in whichever suite makes sense; if that means the check
      lives in `@laika/web` under `node --test`, say why in your log rather than
      moving the server's copy.
- [x] **Confirmed able to fail** on a deliberate web violation.
- [x] Full gate green, both runners.

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

---

## Implementation notes for review (Builder-B)

**One file changed:** `server/test/tooling/structure.test.ts`, extended from 8
tests to 17. Nothing under `server/web/` needed moving.

### I edited a file in Builder-A's tree — please confirm that was intended

`server/test/` is Builder-A's under D-016, so this needs saying out loud rather
than being buried in a diff. Two things made me read it as sanctioned:

1. **AC3 names the file**: *"LAI-038's `structure.test.ts` is **extended** to
   cover `server/web/` — not duplicated."* CLAUDE.md §1 says a task may widen an
   area by naming exact files, and this names one.
2. **Builder-A wrote the invitation into the file itself**: *"Scope is
   `server/src` only. `server/web/` is Builder-B's under D-016 and is covered by
   LAI-039, which extends this file rather than adding a second one."*

If that reading is wrong, the alternative is a second copy of the rules, which
AC3 forbids — so I would rather be told now than guess again next time.

### Why the web check runs under vitest, not `node --test` (AC4)

AC4 allows the check to live in `@laika/web`. It does not, and the reason is
mechanical rather than aesthetic: **the rules cannot be shared across the two
runners.** Builder-A exported `isKebabCase`, `isPascalCase` and
`looksLikeBarrel` — clearly for reuse — but they live in a file that imports
`vitest`, and importing it from `node --test` dies with
`TypeError: Cannot read properties of undefined (reading 'config')`. Verified,
not assumed.

So the choice was: one rule set in the server suite, or two copies across two
suites. AC3 settles that. The check only reads files, so the runner is
irrelevant to what it asserts — and **the two test runners stay separate**, which
is the decision CONVENTIONS §4 records and this does not disturb.

### `main.tsx` is exempt, not renamed

The one §3 violation in `server/web/src` was `main.tsx` — a `.tsx` file that is
not PascalCase. It is Vite's entry point, named by convention, referenced from
`index.html`, `.tsx` only because it contains JSX, and it **exports nothing**.

Renaming it `Main.tsx` would satisfy the letter of the rule while asserting the
opposite of the truth — that it is a component. Exempted through
`WEB_ENTRY_POINTS`, with a test that the exemption still names a real file, in
exactly the shape Builder-A used for `src/index.ts` and the barrel rule: *the
test is what the file does, not what it is called.*

### `.tsx` components are exempt from the mirror rule as a class

Not one by one. `@laika/web` has no component renderer by design (CONVENTIONS
§4), so forty per-component entries would say the same sentence forty times.
`.ts` modules still need a mirrored test or a named exemption, and the thirteen
exemptions each name the test that actually covers them.

### On the thing the task predicted would trip me up

`TokenReference.tsx` beside `token-reference.css` is correct, and the extended
rule agrees: `.tsx` is checked for PascalCase, `.ts` and `.css` for kebab-case.
It still reads as inconsistent at a glance. It did not trip me up because the
task warned me — which is the note earning its keep.

### Confirmed able to fail (AC5) — nine violations, each caught

| Injected | Result |
| --- | --- |
| web `.ts` renamed `Validation.ts` | 3 failed |
| `Sidebar.tsx` → `sidebar.tsx` | 1 failed |
| directory `src/BadDir/` | 2 failed |
| re-export-only `api/barrel.ts` | 2 failed |
| new `api/orphan.ts`, no test, no exemption | 1 failed |
| exemption naming a deleted file | 2 failed |
| exemption with a one-character reason | 1 failed |
| web test in a non-mirroring directory | 1 failed |
| everything restored | **17 passed** |

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`@laika/server` **340/340** (vitest), `@laika/web` **109/109** (`node --test`) —
both runners green, which is AC6.

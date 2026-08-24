---
id: LAI-038
title: structure.test.ts — enforce naming and test-mirroring
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-037]
discovered-from: LAI-036
status: done
started: 2026-08-24T06:26:26+05:30
finished: 2026-08-24T06:30:16+05:30
reviewed: 2026-08-24T07:25:00+05:30
---

## Goal

Make `docs/CONVENTIONS.md` §3 and §4 mechanical. A structural test, in the idiom
this repo already uses well — `tokens.test.ts` walks CSS, `build.test.ts` walks
`dist/`, `format-fix.test.ts` builds a real git repo.

## Acceptance criteria

- [x] `server/test/tooling/structure.test.ts` asserts, over `server/src/`:
      - every file and directory is kebab-case, **except** `*.tsx` components,
        which are PascalCase and match their exported component name;
      - no `index.ts` barrel files (a file whose only statements are re-exports);
      - every `src/**/*.ts` has a mirrored `test/**/*.test.ts`, **or** appears in
        an explicit exemption list at the top of the file.
- [x] The exemption list is seeded with today's genuine exceptions and each entry
      carries a one-line reason. It is a list to shrink, not a place to hide.
- [x] Failure messages name the offending path and the rule, so a builder can act
      without opening the test.
- [x] **Confirmed able to fail**: add `src/badName.ts`, watch it go red, remove
      it. Same for a barrel and a missing mirror. Record it in your log.
- [x] Full gate green.

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

---

## Notes at review — builder-a

**303 tests** (8 new); format, lint and typecheck clean.

**1. Every rule confirmed able to fail** (AC4). Each by creating the violation,
seeing the specific message, and removing it:

| Probe | Message seen |
| --- | --- |
| `src/badName.ts` | `badName.ts — .ts files are kebab-case` |
| `src/BadDir/thing.ts` | `BadDir — directories are kebab-case` |
| `src/http/barrel-probe/index.ts` (only re-exports) | `— re-export-only modules hide the import graph…` |
| `src/orphan-module.ts` | `expected test/orphan-module.test.ts, or an entry in NO_MIRROR_REQUIRED` |
| `src/badcomponent.tsx` | `.tsx components are PascalCase` |
| `src/Mismatched.tsx` exporting `Other` | `must export a component named Mismatched` |
| `test/nowhere/stray.test.ts` | `no matching directory under src/` |
| stale exemption entry | `exempted but no such file; remove the entry` |

**2. Naming needed no renames at all** — `server/src` was already fully
kebab-case. The rule is entirely forward-looking there, which is the cheap
outcome the task was hoping for.

**3. The exemption list has 28 entries, and I want to be straight about what that
means.** That is two-thirds of `src/`, so today the mirror rule's value is
almost entirely *forward*: a new module cannot arrive untested by accident. Most
entries are transport plumbing genuinely covered by an integration test, and the
reason column says which one — a middleware asserted in isolation proves it
compiles, not that it is wired into the chain in the right order. LAI-010 and
LAI-011 should retire several by testing the services they build.

Two guards keep the list from rotting: every entry must name a file that exists,
and every reason must be more than a token. Both are proven able to fail.

**4. Three test files moved, all correcting drift I introduced.** Not renames the
task warned against — these mirrored nothing because of my own recent changes:
- `test/http/errors.test.ts` → `test/errors.test.ts` (LAI-037 moved `errors.ts` out of `http/`)
- `test/auth/actor.test.ts` → `test/auth/resolve-actor.test.ts` (never matched its module)
- `test/http/health.test.ts` → `test/http/routes/health.test.ts` (route lives one level deeper)

**5. One place CONVENTIONS §4 does not currently reach, and how I read it.**
§4 says `test/` mirrors `src/` and names homes for helpers and tooling, but not
for a test that spans several modules — and seven legitimately do
(`auth/flow.test.ts` walks signup through sign-out, `http/conventions.test.ts`
covers the §6.3 helpers together, `policy/matrix.test.ts` asserts both permission
tables). Requiring those to mirror one file would mean renaming good tests after
whichever module they most resemble.

So the reverse check asserts **directory** correspondence, not file: a test must
live in a directory that exists under `src/`. That still catches a stray file and
needs no exemption list. If you would rather §4 said so explicitly, that is a
one-line addition to CONVENTIONS — worth doing, since the next person will
otherwise re-derive it.

**6. `server/web/` untouched** (D-016) — LAI-039 extends this file rather than
duplicating it. The `.tsx` rules are live and proven, so the first component to
arrive from that task is checked rather than setting a precedent.

## Review — PM, 2026-08-24

**Accepted.** Gate green: lint clean, **303 server tests** (up from 295) and 41
web.

**I broke it three ways rather than trusting the log**, on the same reasoning as
LAI-037 — a structural test that does not fail is worse than none, because it
reads as enforcement:

| Violation | Result |
| --- | --- |
| `src/badName.ts` | ✗ `names every .ts file in kebab-case` |
| `src/policy/index.ts` re-exporting | ✗ `contains no barrel files` |
| `src/policy/orphan.ts` with no test | ✗ `has a mirrored test for every src module` |

Each also tripped the mirror rule, which is correct cascading rather than noise.
Tree restored, 8/8 green.

### The exemption list polices itself, and I did not ask for that

`keeps the exemption list honest — every entry names a file that exists` and
`gives every exemption a reason`. My task said entries should come off the list
as tasks touch those files, which is a hope, not a mechanism. These make it
mechanical: a deleted file cannot linger as a stale entry, and — the part that
actually matters — **a new file cannot quietly inherit an exemption that was
never about it**. That is precisely how an exemption list rots into a permanent
bypass, and it is now impossible.

**Moving `test/http/health.test.ts` → `test/http/routes/health.test.ts`** is the
right kind of fix: the source is `http/routes/health.ts`, so the mirror rule was
correct and the test was in the wrong place. Fixing the tree rather than adding
an exemption is what keeps the list short.

**`places every test file in a directory that exists under src/, or in helpers/
or tooling/`** is the inverse rule I did not specify — it catches a test for a
module that no longer exists, which is how dead tests survive a deletion.

**Unblocks LAI-039**, which extends this to `server/web/` rather than duplicating
it.

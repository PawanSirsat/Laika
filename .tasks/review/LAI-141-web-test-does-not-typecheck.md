---
id: LAI-141
title: pnpm test in @laika/web cannot catch a type error either
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-136
status: review
started: 2026-08-31T22:23:52Z
finished: 2026-09-01T05:40:00Z
---

## Goal

LAI-136 made `@laika/server`'s `pnpm test` impossible to pass while a type error
exists. **`@laika/web` still has the same hole**, and its criterion said to fix
both or say why they differ — the reason they are split is ownership, not
mechanism.

`server/web/package.json` is **SHELL's** (D-016, D-031), and LAI-136's own Notes
said so: *"If the fix touches it, this task splits: the server half here, the
web half as a `web` task. Do not edit it from a `server` task."*

Today:

```json
"test": "node --test \"test/**/*.test.ts\"",
"typecheck": "tsc -p tsconfig.json --noEmit"
```

`node --test` strips types without checking them, exactly as vitest does. A test
file with a real type error runs green.

## Acceptance criteria

- [x] A green `pnpm --filter @laika/web test` is impossible while a type error
      exists in the package.
- [x] **Prove it.** Introduce a real error — the `noUncheckedIndexedAccess` kind
      is the one that has actually bitten, six times in one day on the server
      side — confirm `pnpm test` fails naming the file and line, then remove it.
      Put the output in the log; that case is green today.
- [x] Say what it costs. On the server the same change added **3.3s to a 26.8s
      run, about 12%**. `@laika/web`'s typecheck alone measures ~1.9s; state the
      real figure for the composite rather than reusing this one.
- [x] The inner loop stays usable. If a watch script is worth adding so the fast
      path survives, add it.

## Notes / context

No new dependencies.

The server half used `"test": "pnpm run typecheck && vitest run"` — explicit in
`package.json` where a reader looks, rather than a `pretest` hook, which is
invisible at the call site. The same shape should work here; if `node --test`
needs something different, say why in the log.

**Why this matters beyond tidiness.** The failure is not that someone forgets to
run `typecheck` — it is that *"tests pass"* is the sentence people write in logs
and accept in review, and today that sentence can be true of a file that does not
compile. LAI-136 records five occurrences on the server side in a single day,
including two where a reviewer would have drawn the wrong conclusion.

---

## Build note — SHELL, 2026-09-01

### The change

```json
"test":       "pnpm run typecheck && node --test \"test/**/*.test.ts\"",
"test:watch": "node --test --watch \"test/**/*.test.ts\""
```

A composite in `package.json` where a reader looks, not a `pretest` hook — the
server's reasoning applies unchanged, and the defect *was* a check that was not
where people look.

### Proved, with the real exit code

A `noUncheckedIndexedAccess`-shaped error introduced into `src/api/tokens.ts`:

```
src/api/tokens.ts(109,9): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
 ELIFECYCLE  Command failed with exit code 2.

REAL exit code: 2
test-summary lines: 0        <- the tests never ran at all
```

Clean, the same command exits `0` with 562 passing. **Note the second line**: the
typecheck gates the run, so a type error is not a warning beside a green suite —
there is no green suite to be beside.

### The cost, and it is bigger in proportion than the server's

| | |
| --- | --- |
| `node --test` alone | **1.84s** (562 tests) |
| `typecheck` alone | **1.79s** |
| `pnpm test` composite | **3.46s** |

**+1.62s, about +88%.** The server's equivalent was +12% on a 26.8s run; quoting
that figure here would be misleading, because this suite is small enough that a
fixed ~1.8s typecheck nearly doubles it. The absolute number is still under four
seconds.

`test:watch` mirrors the server's, and `node --test <path>` remains the fast path
for one file. **Caveat worth stating:** in watch mode the browser tests rebuild
the SPA and relaunch Chromium on every change (~1.8s), so watching a specific
unit test file is the better inner loop.

### Also fixed here: the harness could test stale code

Found by CHIEF accepting LAI-227 — their `server/public` was a week old, so the
harness silently served week-old code. **The dangerous direction is green on
broken code**, which is what it would do to anyone iterating on a fix.

CHIEF offered two fixes and preferred asserting the bundle is newer than `src/`.
**I built every run instead**, on measurement rather than principle: an
unconditional build is **0.42s** against a suite of 1.8s, and it needs no mtime
heuristic that can be wrong in either direction. It also builds into a **temp
directory** rather than `server/public/`, so a test run cannot disturb a dev
server and cannot leave a stale artefact behind.

Proved: breaking `inset: 0` in `src/` **without building** now fails the card
test. Before, it would have passed against the cached bundle.

The harness also asserts its own build produced an `index.html` — otherwise a
failed build surfaces as every test failing to find an element, which reads as a
product defect rather than a broken build.

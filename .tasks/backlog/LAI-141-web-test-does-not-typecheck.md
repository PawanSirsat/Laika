---
id: LAI-141
title: pnpm test in @laika/web cannot catch a type error either
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-136
status: backlog
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

- [ ] A green `pnpm --filter @laika/web test` is impossible while a type error
      exists in the package.
- [ ] **Prove it.** Introduce a real error — the `noUncheckedIndexedAccess` kind
      is the one that has actually bitten, six times in one day on the server
      side — confirm `pnpm test` fails naming the file and line, then remove it.
      Put the output in the log; that case is green today.
- [ ] Say what it costs. On the server the same change added **3.3s to a 26.8s
      run, about 12%**. `@laika/web`'s typecheck alone measures ~1.9s; state the
      real figure for the composite rather than reusing this one.
- [ ] The inner loop stays usable. If a watch script is worth adding so the fast
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

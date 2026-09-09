---
id: LAI-464
title: 'LAI-452''s fix is the deliverable and nothing guards it — 72 green with the cause put back'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-452]
discovered-from: LAI-452
status: backlog
---

## Goal

LAI-452's diagnosis was that `execFile` reports a **failure to start** through the
same callback as a non-zero exit, and the harness mapped a string errno to `1` —
so a spawn failure arrived as `code: 1`, both streams empty, **byte for byte what
a hook exiting 1 silently looks like.**

The fix distinguishes them. **Nothing tests the fix.** Measured, by restoring the
exact pre-LAI-452 line:

```ts
resolve({ code: typeof error.code === 'number' ? error.code : 1, stdout, stderr, ms });
```

```
# pass 72
# fail 0
```

**Seventy-two green tests with the flake's cause put back.**

## Why p2

**This is LAI-441's finding in a different file, one day later** — *"71 green
tests with the password-echo bug put back"* — and it is worse here, because
**LAI-452 exists precisely because that mapping cost a day.** A later
simplification back to the one-liner reintroduces a defect that only appears
under load, presents as a different test each time, and **names the wrong
component when it does.**

The behaviour LAI-452 proved by hand — *"spawning a nonexistent path yields
`ENOENT` and maps to exactly that"* — **is the assertion. It was performed and
not written down.**

## Acceptance criteria

- [ ] A test drives the runner at a **path that does not exist** and asserts the
      three things that distinguish the two outcomes: `code` is **not** `1`,
      `spawnError` is `'ENOENT'`, and the thrown message names the machine rather
      than the hook.
- [ ] **`ENOENT` is asserted not to be retried.** It is the one errno in this path
      that is a real fault, and the retry list is what keeps it that way — assert
      **one** attempt, so adding `ENOENT` to `TRANSIENT_SPAWN_ERRORS` goes red.
- [ ] **Prove it by restoring the old one-liner** and watching this test — not the
      suite — go red. Say so in the log.
- [ ] **Do not simulate the errno.** Stubbing `execFile` to hand back a fake
      `error.code` tests the mapping against a fixture of itself. A real path that
      does not exist costs nothing and is the actual mechanism.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Not a criticism of LAI-452's rigour** — that task retired two of its own leads
by measurement, found that the reported test was not the failing one, and caught
its own soak conflating two outcomes. **It is that the deliverable moved during
the task**: the criteria were written about *"unconfigured is silent"*, the cause
turned out to be the harness, and **the criteria could not be widened once
submitted** (CLAUDE.md §2). This is that widening, as its own task, which is the
mechanism working rather than a gap in it.

**`EAGAIN` cannot be provoked reliably and should not be attempted.** `ENOENT`
exercises the same branch and is deterministic; the retry list is asserted
separately.

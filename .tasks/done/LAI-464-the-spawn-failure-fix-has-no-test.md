---
id: LAI-464
title: 'LAI-452''s fix is the deliverable and nothing guards it — 72 green with the cause put back'
area: cli
assignee: shell
priority: p2
depends-on: [LAI-452]
discovered-from: LAI-452
started: 2026-09-09T23:00:19+05:30
finished: 2026-09-09T23:04:49+05:30
status: done
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

- [x] A test drives the runner at a **path that does not exist** and asserts the
      three things that distinguish the two outcomes: `code` is **not** `1`,
      `spawnError` is `'ENOENT'`, and the thrown message names the machine rather
      than the hook.
- [x] **`ENOENT` is asserted not to be retried.** It is the one errno in this path
      that is a real fault, and the retry list is what keeps it that way — assert
      **one** attempt, so adding `ENOENT` to `TRANSIENT_SPAWN_ERRORS` goes red.
- [x] **Prove it by restoring the old one-liner** and watching this test — not the
      suite — go red. Say so in the log.
- [x] **Do not simulate the errno.** Stubbing `execFile` to hand back a fake
      `error.code` tests the mapping against a fixture of itself. A real path that
      does not exist costs nothing and is the actual mechanism.
- [x] Full gate green — **`EXIT 0`**, repo root.

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


---

## Submitted — SHELL

Root gate `EXIT 0` — 1871 server, 644 web, **75** cli.

### AC3, which is the criterion this task turns on

Restoring the **exact** pre-LAI-452 one-liner:

| mutation | this guard | whole file |
| --- | --- | --- |
| **the pre-LAI-452 one-liner restored** | **RED** | red |
| `ENOENT` added to `TRANSIENT_SPAWN_ERRORS` | **RED** | red |
| the message stops naming the machine | **RED** | red |
| the attempt count dropped from the message | **RED** | red |

**Before this task, the first row was `72 passing, 0 failing`.**

### A real absent path, never a stubbed errno

`spawnOnce` is extracted so the classification can be asked what the operating
system actually produces. Nothing fakes an `error.code`: the test points at
`heartbeat.sh.does-not-exist` and asserts what comes back — `spawnError:
'ENOENT'`, `code: -1`, both streams empty.

**And it checks the probe first**: that the missing path is genuinely missing and
the real hook is genuinely present. Otherwise every assertion could be satisfied
by a hook that ran.

### `code` is asserted **not to be 1**, explicitly

`1` is the whole bug — a real exit status a hook could return, which is why
nothing downstream could tell the two apart. So the assertion names it rather
than only checking for `-1`.

### One attempt, and why the count is in the message

`ENOENT` is the one errno on this path that is a real fault, and the retry list is
what keeps it loud. The thrown message carries the attempt count, so **adding
`ENOENT` to the transient set turns `after 1 attempt` red** rather than silently
retrying a missing hook three times before reporting it.

### One correction on the way

My third mutation came back **green** and it was the mutation that was wrong, not
the test: it replaced the message's trailing sentence while the assertion checks
`the machine, not the hook`, which is earlier in the string. Re-aimed at the text
the assertion actually reads, it is red. **A mutation that misses is a green that
means nothing** — the same failure this repo has now hit in a harness, a fixture,
and a soak.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Gate `EXIT 0` — 1871 server, 644 web, **75** cli.

**The hole is closed, verified here.** Restoring the exact pre-LAI-452 one-liner
now gives `# pass 73  # fail 2`. **It was `# pass 72  # fail 0` this afternoon.**

And `ENOENT` added to `TRANSIENT_SPAWN_ERRORS` is **red** — which is only
assertable because you put the attempt count in the thrown message. **Without
that, adding an errno to the retry set is invisible**, and the criterion asking
for it would have had nothing to hold.

**`code` asserted not to be `1` *by name*** is the detail that makes this guard
about the actual defect: `1` is a real exit status a hook could return, **and that
collision is the bug** — not "a spawn failure produces a wrong number".

### Taking it ahead of LAI-460 was right

**Closing a hole in what you just shipped before starting a sweep is the correct
order**, and you would not have needed to ask. I sequenced LAI-460 first without
knowing LAI-464 would land in the same message; **you had the newer information.**

### The mutation aimed at the wrong words — and I did the same thing twice today

> *"It replaced the message's trailing sentence while the assertion reads `the
> machine, not the hook`, earlier in the string."*

**Fourth instance of the day, and you are right that it is the worst place for
it:** the mutation is supposed to *be* the verification.

**I did it twice while reviewing your work.** Once on LAI-163 — `.notNull()`
inserted inside `users.id`, so `tsc` produced the red and I nearly recorded it as
the guard firing. And once **on this task, an hour ago**: my anchor no longer
matched your refactored code, the script raised, **the test run went ahead
anyway**, and `# pass 75  # fail 0` looked exactly like *"still unguarded."* I
came within one sentence of telling you this task had not worked.

**The fix is mechanical and it is the same one LAI-405 landed:** the edit must be
confirmed on disk, and the run must not happen if it was not. Mine now does
`assert` → `grep` → `set -e`, and it is why the number above is trustworthy.

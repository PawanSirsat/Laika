---
id: LAI-470
title: '`pnpm lint` has been red on `master` since LAI-466 — one empty arrow function'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-175
status: backlog
---

## Goal

```
server/test/jobs/restore-drill.test.ts
  147:32  error  Unexpected empty arrow function  @typescript-eslint/no-empty-function
```

`logger: createLogger(() => {})`, from `46b4933` (LAI-466). **`pnpm lint` exits
`1` on `master`, and has for 54 commits and nine accepted tasks.**

**One line to fix. p1 for what it means, not for what it costs.**

## Why nobody saw it

**`CLAUDE.md` §5's gate rule named `pnpm test` and nothing else.** Every *"gate
`EXIT 0`"* in this repo's recent history is **true and incomplete** — including
nine of CHIEF's accept notes, and the push that introduced it.

> *"The gate has two exit codes and §5 names one."* — SHELL

**That is the same "the instrument cannot see the thing" failure §5 is otherwise
full of, arriving in the rule that names the instrument.** §5 now runs `test`,
`lint` and `format`, and says the gate is all three.

## Acceptance criteria

- [ ] `pnpm lint` exits `0` at the repo root.
- [ ] **Do not silence it with a disable comment.** The logger sink is genuinely
      a no-op; **give it a body that says so**, or use whatever the repo's other
      test loggers already do. **A rule disabled at one site is a rule nobody can
      rely on at the others.**
- [ ] **Check whether other test files construct a discarded logger the same
      way**, and make them consistent rather than leaving one spelling that
      passes and one that does not. **Report what you found, including "nothing
      else".**
- [ ] **All three gates green** — `pnpm test`, `pnpm lint`, `pnpm format`, each
      `EXIT 0`, per the amended §5.

## Notes / context

**SHELL reported it rather than fixing it** — `server/test/` is CORE's, and the
file is one line outside their area. **Correct, and it is why this task exists
rather than a silent cross-boundary edit.**

**The 54 commits are not wasted work.** Nothing shipped is wrong; the tests were
green throughout. **What was wrong is the claim**, and the claim is what a gate is
for.

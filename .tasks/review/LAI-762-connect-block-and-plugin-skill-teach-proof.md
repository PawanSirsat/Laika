---
id: LAI-762
title: 'The Connect block and the plugin skill teach attaching proof to finish_task and reading a send-back first'
area: web
assignee: owner-direct
priority: p2
depends-on: [LAI-758]
discovered-from: LAI-758
status: review
started: 2026-10-18T04:24:18Z
finished: 2026-10-18T04:34:45Z
---

## Goal

LAI-758 (D-082) gave `finish_task` optional proof — `commits`, `branch`,
`pull_request`, `tests` with exit codes — and made a person's send-back the
first thing `get_task_context` returns. The server's `instructions` and the
`finish_task` description say so, which reaches every MCP client. Two other
places that teach an agent how to work the board still say only "finish into
review, never done": the CLAUDE.md block the Connect screen hands a project
lead (`claudeMdBlock` in `server/web/src/routes/screens/connect/connect-copy.ts`,
rule 5) and the plugin's skill plan (`plugin/skills/README.md`). An agent
following either never learns to attach proof.

## Acceptance criteria

- [x] Rule 5 of the Connect block says to finish with proof (commits, branch,
      pull request, test commands and exit codes) and that a sent-back task's
      reason comes first in `get_task_context`; its tests are updated.
- [x] `plugin/skills/README.md`'s list says the same in one line.
- [x] Wording matches the server's `MCP_INSTRUCTIONS` (`server/src/mcp/server.ts`)
      so the three do not disagree.

## Notes / context

Found while building LAI-758, which was scoped to the MCP tool description and
the server's built-in rules text. Two areas (`server/web/`, `plugin/`); both
are text edits.

## Builder notes (at review)

Owner-direct, through the orchestrator. Worktree `Laika-teach-proof/`, branch
`LAI-762-teach-proof` from `master` 4d48470d. Committed locally, not pushed.

**The function is `projectBlock` now.** LAI-737 renamed `claudeMdBlock` when it
made the block agent-neutral. Rule 5 is in `projectBlock`.

**What the server already says, quoted.** I read it first and left it alone.
It is clear, and its two texts agree:

- `MCP_INSTRUCTIONS` (`server/src/mcp/server.ts`): *"`finish_task` moves it to
  review with your proof (commits, branch, pull request, test commands and exit
  codes): an agent never marks work done, a person does."* and *"4. A task a
  person sent back opens with their reason in `get_task_context`: fix that
  first, then `finish_task` again with fresh proof."*
- `finish_task`'s description (`server/src/mcp/write-tools.ts`): *"attach your
  proof so a person can check it: the `commits` you made (sha and first line),
  the `branch`, the `pull_request` URL, and the `tests` you ran with their exit
  codes. … an agent never marks work done — a person accepts it, or sends it
  back with a reason that `get_task_context` shows you first."*

**Rule 5, before:**

> 5. **Finish into review, never done.** `finish_task` hands it to a human.
>    Agents do not close their own work.

**Rule 5, after.** Both sentences are `MCP_INSTRUCTIONS`, word for word:

> 5. **Finish into review, never done.** `finish_task` moves it to review with
>    your proof (commits, branch, pull request, test commands and exit codes):
>    an agent never marks work done, a person does. A task a person sent back
>    opens with their reason in `get_task_context`: fix that first, then
>    `finish_task` again with fresh proof.

**Plugin.** In `plugin/skills/README.md`'s plan list, one bullet: *"finish with
your proof (commits, branch, pull request, test commands and exit codes); a task
a person sent back opens with their reason in `get_task_context`: fix that
first"*. In `laika-mark-your-task/SKILL.md`, step 4 already covered finishing,
so it gets one sentence: *"Pass `finish_task` your proof (commits, branch, pull
request, test commands and exit codes) so a person can check it."* "pull
request" is written as plain words: `cli/test/plugin-skills.test.ts` reads every
backticked snake_case word as a tool name, and `pull_request` is not a tool.

**Tests** (`server/web/test/routes/screens/connect/connect-copy.test.ts`):

- *it teaches finishing with proof, and reading a send-back first.* Checks that
  the block names each part of the proof, `get_task_context` and "fix that
  first".
- *its finishing rule says what the server tells every agent.* Reads
  `MCP_INSTRUCTIONS` out of `server/src/mcp/server.ts`, takes out the proof list
  and the send-back sentence, and requires both in the block after folding
  whitespace. A vacuity guard fails if either extraction comes back empty. The
  test copies no wording from either text: if the server's wording changes,
  the test fails until the block matches.

Mutation-checked. Each edit was confirmed to have landed, and the files were
restored by checksum:

| mutation | result |
| --- | --- |
| drop "pull request" from the block | both new tests red |
| add "build logs" to the server's proof list | parity test red only |
| rename `MCP_INSTRUCTIONS` in the server | vacuity guard red ("no proof list found") |
| reword the block's send-back sentence | parity test red only |

**Gate on f8afe869** (the last code commit), each command to its own file:

- `pnpm test`: **exit 1**. web 2095/2095 and cli 409 pass + 1 skipped (node
  test cases); server vitest 2959 passed, 8 skipped, **2 failed**, both in
  `server/test/db/migrate.test.ts` with "Test timed out in 5000ms": "migrates
  a populated pre-rebuild database with nothing dangling" and "0031 adds the
  heatmap … fills the board rollup". That is the LAI-768 load family, and
  LAI-768 names this file and that test. Nothing in this diff touches
  `server/`.
- `pnpm exec vitest run test/db/migrate.test.ts` (in `server/`), alone:
  **exit 0**, 23/23.
- `pnpm lint`: **exit 0**. `pnpm format`: **exit 0**.

The root gate is run again after this commit. Its codes are on the card
(LAIKA-569) and in the orchestrator report.

Not done here: `cli/test/plugin-skills.test.ts` could pin the skill's new
sentence the same way. It is in `cli/`, outside this task's grant, and LAI-773
is working in the CLI.

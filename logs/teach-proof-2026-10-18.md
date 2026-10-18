# teach-proof — 2026-10-18

Owner-direct build of LAI-762 through the orchestrator, temporary worktree
`Laika-teach-proof/`, branch `LAI-762-teach-proof` from `master` 4d48470d.
Committed locally; not pushed, not merged.

## 2026-10-18T04:34:45Z — LAI-762

**What changed**
- server/web/src/routes/screens/connect/connect-copy.ts — rule 5 of `projectBlock` (it was `claudeMdBlock`; LAI-737 renamed it) now says `finish_task` moves the task to review with your proof (commits, branch, pull request, test commands and exit codes), and that a sent-back task opens with its reason in `get_task_context`. The wording is taken from `MCP_INSTRUCTIONS`
- server/web/test/routes/screens/connect/connect-copy.test.ts — two tests: the block names each part of the proof and the send-back; and a parity test that reads the proof list and the send-back sentence out of `server/src/mcp/server.ts` and requires both in the block, whitespace folded
- plugin/skills/README.md — one bullet in the plan list: finish with your proof, and fix a send-back's reason first
- plugin/skills/laika-mark-your-task/SKILL.md — step 4 adds one sentence: pass `finish_task` your proof so a person can check it
- .tasks/review/LAI-762-connect-block-and-plugin-skill-teach-proof.md

**Decisions**
- The server text is unchanged. `MCP_INSTRUCTIONS` and the `finish_task` description already agree (proof = commits, branch, pull request, tests with exit codes; a send-back reason comes first in `get_task_context`), and neither is unclear.
- Rule 5 quotes `MCP_INSTRUCTIONS`, and a test reads the phrases from the server source, so the wording is not written out a second time in the test. A copy of the expected text in the test would have passed while the server moved on.
- In SKILL.md, "pull request" is plain words, not `pull_request` in backticks: `plugin-skills.test.ts` reads every backticked snake_case word as a tool name and would have failed on it.
- No assertion added in `cli/test/plugin-skills.test.ts` for the skill's new line. `cli/` is outside this task's grant, and LAI-773 is in the CLI.

**Discovered**
- The task file and the card still call the function `claudeMdBlock`; it is `projectBlock` since LAI-737.
- Mutation-checked, each edit confirmed landed, restored by checksum: dropping "pull request" from the block fails both new tests; adding a proof item to the server's list fails only the parity test; renaming `MCP_INSTRUCTIONS` fails the vacuity guard ("no proof list found"); rewording the block's send-back sentence fails only the parity test.
- A fresh worktree's `pnpm install` skips better-sqlite3's build script; its shipped darwin-arm64 prebuild loads, as chief-2026-10-12 recorded.

**State**
In .tasks/review/. Gate on the last code commit, f8afe869: `pnpm test` exit 1: two LAI-768 5 s timeouts in `server/test/db/migrate.test.ts` ("migrates a populated pre-rebuild database…", "0031 adds the heatmap…"); that file alone exit 0, 23/23; web 2095/2095, cli 409 pass + 1 skip, server 2959 passed / 8 skipped / 2 failed. `pnpm lint` 0, `pnpm format` 0. The root gate runs again after this commit, and its codes are on LAIKA-569. Not pushed.

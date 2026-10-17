---
id: LAI-762
title: 'The Connect block and the plugin skill teach attaching proof to finish_task and reading a send-back first'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-758]
discovered-from: LAI-758
status: backlog
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

- [ ] Rule 5 of the Connect block says to finish with proof (commits, branch,
      pull request, test commands and exit codes) and that a sent-back task's
      reason comes first in `get_task_context`; its tests are updated.
- [ ] `plugin/skills/README.md`'s list says the same in one line.
- [ ] Wording matches the server's `MCP_INSTRUCTIONS` (`server/src/mcp/server.ts`)
      so the three do not disagree.

## Notes / context

Found while building LAI-758, which was scoped to the MCP tool description and
the server's built-in rules text. Two areas (`server/web/`, `plugin/`); both
are text edits.

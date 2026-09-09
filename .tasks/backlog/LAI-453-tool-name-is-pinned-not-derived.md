---
id: LAI-453
title: '`/laika:tasks` pins the MCP tool name as a literal; nothing derives it'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-420]
discovered-from: LAI-420
status: backlog
---

## Goal

`cli/test/plugin-commands.test.ts:199` asserts the `allowed-tools` line **as a
string**:

```ts
assert.match(tasks, /allowed-tools: mcp__plugin_laika_laika__list_ready_tasks/);
```

**Both `laika`s are derivable from the repo** — `plugin/.claude-plugin/plugin.json`
`name`, and `plugin/.mcp.json`'s `mcpServers` key — and **neither is read.**
Rename either and the command silently stops pre-approving its tool while this
test stays green.

## Why it is worth a task and not a shrug

**This is LAI-419's own lesson, one task later.** That task replaced a count
with *"assert the names from both sides and require them to match, never a
number"*, on the grounds that **a value copied into prose drifts silently.** An
`allowed-tools` literal is the same shape: copied from a measurement, correct on
the day, and coupled to two files nobody will think to check.

**And it fails in the worst way** — LAI-420 found this itself: a wrong
`allowed-tools` value surfaces as *an unexplained permission prompt, never an
error*. There is no red anywhere; the user just gets asked something they were
promised they would not be.

## Acceptance criteria

- [ ] The test **builds** the expected name from `plugin.json`'s `name` and
      `.mcp.json`'s server key, and compares it to what `tasks.md` declares.
- [ ] **Both sources are asserted non-empty first.** A missing key that reads as
      `""` makes `mcp__plugin__` compare equal to itself — the *"two empty lists
      compare equal"* trap LAI-419 named, in its other form.
- [ ] Renaming the plugin **or** the server key turns it red. Prove both,
      separately, and say so in the log.
- [ ] The existing negative assertion — that `mcp__laika__` does **not** appear —
      is kept. It names the guess, and the guess is what a future author writes.

## Notes / context

**Do not extend this to the tool suffix.** `list_ready_tasks` is a name in
`server/src/mcp/`, which is CORE's; the parity check LAI-419 built already
covers it from both sides. This task is only the **prefix** — the part derived
from two files that live in this area.

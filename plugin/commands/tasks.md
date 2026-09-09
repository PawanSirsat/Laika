---
description: Ready work on your Laika board — unassigned, unblocked, p1 first
allowed-tools: mcp__plugin_laika_laika__list_ready_tasks
---

Call `list_ready_tasks` on the `laika` MCP server.

**The response carries two payloads and you may be handed either.** On the wire
there is a rendered `text` block — markdown, sorted, using display keys like
`LC-1` — and a `structuredContent` object with the same tasks including their
**ULIDs**. Which of them reaches you depends on the client, and it has varied
between runs.

So the rule is about the output, not the input: **print display keys and never
an `id`.** §7 is explicit that an agent works in display keys, and a ULID on
screen is unusable by the person reading it. If you were given the rendered
block, show it. If you were given the structured payload, render it yourself —
key, priority, status, title — and drop every id.

Do not re-sort. That order is §4.5's, derived by the server, and re-deriving it
here would be a second definition of "ready" that can disagree with the board's
own Ready column. Do not filter the list, and do not add tasks from memory.

If the tool is unavailable, the plugin is not configured: say so and suggest
`/laika:setup`. Do not fall back to guessing what might be ready.

<!-- The tool's full name is `mcp__plugin_laika_laika__list_ready_tasks` —
     `mcp__plugin_<plugin>_<server>__<tool>`, not `mcp__laika__<tool>`, which is
     the shape a plugin author guesses and which silently pre-approves nothing.
     Measured by asking a real session to print the names it could see.

     The two-payload wording was measured too, twice. The first version said the
     tool "returns markdown, render as-is"; a real run answered "the tool
     returned raw JSON rather than pre-rendered markdown". The second version
     said to show the text block; the next run answered "only the structured
     payload came through this time". **Both instructions were true of the wire
     and false of what the agent held**, so the rule is now stated about the
     output — display keys, never ids — which holds whichever arrives. -->

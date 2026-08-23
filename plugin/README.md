# plugin/ — owned by **Builder-B**

The Claude Code plugin that lets an agent session talk to a Laika board: the
plugin manifest, hooks, skills, slash commands, and the `.mcp.json` that points
at a Laika deployment's `/mcp` endpoint.

Nobody except Builder-B edits anything under this directory. If you need a
change here, write a task file in `.tasks/backlog/` with `area: plugin`.

Expected layout once LAI-011 lands:

```
plugin/
  .claude-plugin/plugin.json
  .mcp.json
  hooks/
  skills/
  commands/
```

Note: this is the *shipped* plugin for Laika users. It is not the same thing as
the repo-local `.claude/` directory, which configures the three sessions that
build Laika.

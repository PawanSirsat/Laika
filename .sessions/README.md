# .sessions/ — who is who

Three sessions build Laika in parallel. One file each. Read **your own** at the
start of every session, before you touch anything. Never edit another session's
file — if something in theirs is wrong, tell CHIEF.

| Name | File | Command | Branch | Directory | Owns |
| --- | --- | --- | --- | --- | --- |
| **CHIEF** | `chief.md` | `/chief` | `master` | `Laika/` | plan, tasks, review, docs, integration |
| **CORE** | `core.md` | `/core` | `core` | `Laika-core/` | `server/` except `server/web/` |
| **SHELL** | `shell.md` | `/shell` | `shell` | `Laika-shell/` | `server/web/`, `plugin/`, `cli/`, `docker/` |

**CORE** is the engine — API, database, policy, MCP. **SHELL** is everything
wrapped around it — the UI, the plugin, the CLI, the container. **CHIEF** writes
no code at all.

## Renamed 2026-08-31 (D-035)

These sessions used to be called **PM**, **Builder-A** and **Builder-B**:

| Was | Is |
| --- | --- |
| PM | CHIEF |
| Builder-A | CORE |
| Builder-B | SHELL |

The old names are **still correct wherever they were already written**. Anything
in `.tasks/done/`, `logs/`, or an existing `docs/DECISIONS.md` entry is a record
of what happened and is not rewritten — the same append-only rule that governs
decisions. Read an old name as its new one and carry on.

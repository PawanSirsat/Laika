# plugin/hooks/ — session hooks

Hook configuration lives in `hooks.json`, declared by the `hooks` field of
`.claude-plugin/plugin.json`. It is present and **deliberately empty** so the
manifest resolves cleanly today.

## Filled in M4

The heartbeat, per SPEC §5: `SessionStart`, `Stop`, and a throttled `PostToolUse`
POST to `$LAIKA_URL/api/v1/heartbeats` carrying **metadata only** — git remote
basename and branch name. Never file contents, never a diff.

Two rules that are not negotiable when this gets written:

- **Fail silent.** Every hook command ends in `|| true`. A board that is down,
  slow, or unconfigured must never break someone's coding session.
- **No secrets on the command line.** `LAIKA_TOKEN` is read from the environment
  inside the script, never interpolated into `hooks.json`.

## Sequencing note

M4 schedules these hooks, but `POST /api/v1/heartbeats` is an **M5** deliverable
(`docs/ROADMAP.md`). Until that endpoint exists the hooks would post into the
void — survivable, because they fail silent, but worth knowing before you wire
them. Raised as **LAI-013**.

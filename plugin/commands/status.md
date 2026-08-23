---
description: Show which Laika board this session is configured against
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/laika-status.sh"`

Report the status above to the user as-is. It is already formatted — do not
re-run the script, do not fetch the board, and do not attempt to read, echo, or
reconstruct `LAIKA_TOKEN`. The token value is deliberately never printed.

If the output says the plugin is not configured, that is a normal state, not a
failure — repeat the two `export` lines it suggests and stop there.

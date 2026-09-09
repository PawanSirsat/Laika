---
description: Check whether this session is configured, and how to configure it
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/laika-setup.sh"`

Report the output above as-is.

**This command configures nothing, and that is deliberate (D-046).** One
mechanism owns Laika's configuration — `npx laika init` — and a second path
would make its "do not mint a second token" guarantee unprovable.

So: do not offer to run `npx laika init` for the user, do not ask them for their
password, and do not write `LAIKA_URL` or `LAIKA_TOKEN` to any file yourself.
The command asks for a password, and a password typed into this conversation is
a password in a transcript.

Repeat the instruction and stop.

---
description: Check whether this session is configured, and how to configure it
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/laika-setup.sh"`

Report the output above as-is.

**This command configures nothing, and that is deliberate (D-046).** One
mechanism owns Laika's configuration — `laika init` — and a second path
would make its "do not mint a second token" guarantee unprovable.

So: do not offer to run `laika init` for the user, do not ask them for their
password, and do not write `LAIKA_URL` or `LAIKA_TOKEN` to any file yourself.
The command asks for a password, and a password typed into this conversation is
a password in a transcript.

**This matters more since LAI-623, not less.** The command used to be printed as
`npx laika init`, which could not work — so an agent that "helpfully" ran it
failed harmlessly. It is a real command now, so the same helpfulness succeeds,
into a session where the user then types their password where it will be stored.
Print it and stop.

Repeat the instruction and stop.

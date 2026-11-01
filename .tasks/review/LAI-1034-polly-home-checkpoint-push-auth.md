---
id: LAI-1034
title: 'A checkpoint save from a Polly session cannot push: polly-home hides git''s credential helper and gh''s login'
area: cli
assignee: shell
priority: p1
depends-on: []
started: 2026-11-01T17:10:38Z
finished: 2026-11-01T17:14:50Z
discovered-from: LAI-1019
status: review
---

Board card LAIKA-890, under LAIKA-785.

## Goal

A checkpoint saved from a Polly · Belka session pushes its branch and tag
the way one from a plain Claude Code session does. Today it cannot, so every
automatic (hook) save from Polly fails at the push once consent is on.

## Acceptance criteria

- [ ] A checkpoint save started from a Polly session on Belka (`HOME=~/.laika/polly-home`) pushes its branch and its tag with no prompt, and with no token on a command line or added to `GIT_ENV_ALLOW`.
- [x] The fix names where it lives, either the LAI-589 local setup (polly-home's git and gh configuration resolve to the person's) or a CLI change, and why. `GIT_ENV_ALLOW` (`cli/src/checkpoint-git.ts`) still admits no credential-bearing variable.
- [ ] Shown live once: `laika agent checkpoint save` from a Polly session reaches `registered`.

## Notes / context

Found live on LAI-1019, 2026-11-01 09:59:47Z (`docs/acceptance/LAI-1019-live-checkpoint.md` §3.1). The save committed `4bb1f372` and exited 2:

```
laika agent checkpoint: the push of refs/heads/LAI-1019-phase6-sandbox to origin failed:
fatal: could not read Password for 'https://PawanSirsat@github.com': terminal prompts disabled
```

Cause, verified in that session: `~/.laika/agents/agent-hook.sh` runs Polly sessions with `HOME=~/.laika/polly-home`. Git's global config (`~/.gitconfig`, with `credential.https://github.com.helper = !/opt/homebrew/bin/gh auth git-credential`) and gh's keyring login are both found through HOME, so under polly-home git has no helper. `GIT_ENV_ALLOW` passes HOME, XDG_CONFIG_HOME and GH_CONFIG_DIR. Pointing `XDG_CONFIG_HOME` at a git config naming the helper as `!HOME=<real home> gh auth git-credential` made the retried push succeed, which proves the diagnosis. It is not offered as the fix.

Do not route around the allowlist (D-116's "no credential reaches a hook") to fix this.

## Builder notes (SHELL, 2026-11-01)

**Where the fix lives: local setup, written by a CLI command.** polly-home is
LAI-589's local construct and the CLI has no idea of it, and the allowlist is
right to pass HOME and nothing credential-shaped. What was missing was
configuration *under* that HOME. So `laika agent git-home <dir>`
(`cli/src/agent-git-home.ts`) writes `<dir>/.gitconfig` (0600, marked, never
over a file it did not write): an `[include]` of the person's
`~/.config/git/config` and `~/.gitconfig`, then per credential section a reset
and each global helper again as `!export HOME='<real home>'; <helper>`. The
real home comes from `os.userInfo()`, not `$HOME`. gh's login is found through
HOME, macOS keychain included (measured: `GH_CONFIG_DIR` or a linked
`~/.config/gh` alone still fails `gh auth status`), so the helper itself must
run as the person; the token goes to git over the credential protocol only.
`GIT_ENV_ALLOW` is unchanged and a test pins it.

**One-time step for Belka (owner):**
`laika agent git-home ~/.laika/polly-home`. The session was not permitted to
write the real polly-home, so criteria 1 and 3 are left unticked: proved on a
scratch HOME with the same push the checkpoint helper makes (`gitRunner`):
before, exit 128 `could not read Password … terminal prompts disabled`; after,
exit 0. A live `checkpoint save` reaching `registered` also needs consent on,
which an agent cannot give.

Commit `4d38f849` is an empty probe commit pushed by that live test.

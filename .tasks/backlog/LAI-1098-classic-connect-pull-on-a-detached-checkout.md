---
id: LAI-1098
title: 'Classic Connect: the plugin step fails on a checkout laika update left detached'
area: shell
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1093
status: backlog
---

## Why

LAI-1093 fixed every V3 place that tells a developer how to get a current CLI.
The **classic** Connect flow (`LAIKA_DEVELOPER_ACCESS=classic`, and the
classic Agents tab) still gets the plugin with

```
git clone https://github.com/PawanSirsat/Laika.git ~/laika 2>/dev/null || git -C ~/laika pull --ff-only
```

in three places: `server/web/src/routes/screens/connect/connect-copy.ts`
(`machinePrompt` step 1) and `connect-agents.ts` (`cliBlock`, and the
`rest-cli` block). On a `~/laika` that `laika update` left detached at the
board's commit, `pull --ff-only` answers `You are not currently on a branch`
and exits 1, and the machine prompt says *stop at the first one that fails*.

Measured on 2026-11-03 (scratch repos, git on macOS):
`git -C <checkout> pull --ff-only origin HEAD` fast-forwards a detached
checkout, fast-forwards a branch that tracks the default one, and refuses a
diverged one (`Not possible to fast-forward, aborting`).

Related, found in LAI-1093's review round: the classic *by hand* commands,
`manualCommands()` in `connect-copy.ts`, are a clone and an `install.sh` on
two unchained lines. That path asks for a token by design, so it is not the
V3 defect, but a refused clone still runs whatever `install.sh` is already in
`~/laika`; `&&` would make it stop.

Not done in LAI-1093 because `test/browser/golden/connect.json` snapshots this
text, and that test's header says the golden is not to be regenerated to make
a red run green: changing the classic copy is a decision about that screen,
not a follow-on edit.

## Acceptance criteria

- [ ] The classic Connect plugin step works on a detached `~/laika` (or the
      owner decides classic is retired and this is closed).
- [ ] The golden is regenerated only as that test's header allows, and the
      reason recorded.

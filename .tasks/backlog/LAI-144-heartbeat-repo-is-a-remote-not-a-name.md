---
id: LAI-144
title: The plugin sends a git remote; §4.3 stores `owner/name`
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-116]
discovered-from: LAI-116
status: backlog
---

## Goal

LAI-116 made repo attribution case-insensitive, which is what its criteria
asked for. It did **not** address a bigger mismatch found while building it,
because that was not in scope.

`plugin/hooks/README.md` says the hooks POST *"metadata only — git remote"*.
A git remote is a URL:

```
git@github.com:PawanSirsat/Laika.git
https://github.com/PawanSirsat/Laika.git
https://github.com/PawanSirsat/Laika
```

§4.3 and `projects.repo` store **`owner/name`** — `PawanSirsat/Laika`.

None of those three forms matches `PawanSirsat/Laika` by any comparison, case
folded or not. So on a correctly configured instance, with the plugin sending
exactly what it says it sends, **every heartbeat resolves to no project** and
presence (§9.3) is permanently empty.

## Why it is filed rather than fixed

LAI-116's criteria are about the one-to-many ambiguity LAI-108 created, and its
one normalisation requirement is case. Normalising a URL to `owner/name` is a
different rule about a different failure, and folding it in would have been
widening a task in flight.

It is also not obviously the server's job — see below.

## Acceptance criteria

- [ ] A heartbeat whose `repo` is any of the three forms above resolves to a
      project storing `PawanSirsat/Laika`.
- [ ] The normalisation is written down in §9.1 or §4.3, wherever the decision
      below puts it.
- [ ] A `repo` that is neither a URL nor `owner/name` still degrades rather than
      erroring (§9.2).
- [ ] Whichever side normalises, the **other** side has a test proving it does
      not need to.

## Notes / context

**Decide where it normalises, and say so once.**

- **Server.** `resolveRepoProjects` accepts both forms. Every client gets it
  right for free, including ones nobody wrote, and it is the only place that can
  be fixed after a plugin ships. Costs a parser for URL shapes the server has no
  other reason to know about.
- **Plugin.** The hook sends `owner/name`. Keeps the server's model clean —
  §4.3 means one thing everywhere. But it is `plugin/`, so SHELL's, and every
  future client repeats the work.

**Recommendation: the server, and the plugin sends its best effort.** §9.2's
rule is already that the server does resolution because *"the plugin cannot know
a deployment's project prefixes"*, and the same argument applies: a hook running
in someone's editor should send what git gave it and not be the place a mapping
rule lives. That also makes an old plugin work against a new server, which is
the direction that matters for something self-hosted.

**Do not add a dependency to parse the URLs.** Three shapes, one regex.

**Check `.git` stripping and a trailing slash** — both appear in real remotes and
neither is exotic.

---

## CHIEF ruling — 2026-09-01 (D-043)

**The server normalises. The plugin sends `git config --get remote.origin.url`
verbatim and does not parse it.** Recommendation accepted; reasoning recorded as
**D-043**, and the deciding argument is the one you did not make:

§9.2's stated reason generalises, but **direction** is what settles it. The
server is the only side that can be fixed after a client ships, and a self-hosted
board controls nobody's plugin version. **An old plugin against a new server is
the only direction that can be relied on** — so a normalisation rule on the
client is one you can never change again.

**I have sharpened what I told you in chat.** I said the plugin should send *"its
best effort"*; that was too loose. A plugin that half-normalises invents a fifth
form and the server ends up accepting each client's idea of best effort.
**Verbatim is a contract; best effort is a suggestion.**

**Raised to p1 and sequenced ahead of the p2 list**, because M4's exit is a
heartbeat *visible and attributed*, and a row attributed to nothing does not
satisfy that in any sense a person would accept.

### Added criterion

- [ ] The four forms are enumerated in **one place** — a single table or array
      the regex is driven from — not spread across the parser and its tests. The
      next form (a self-hosted GitLab path, an `ssh://` URL) should be one line.

AC4 as filed — *"whichever side normalises, the **other** side has a test proving
it does not need to"* — is the right criterion and is the one to be careful with.
The plugin half is `plugin/`, so **SHELL's**; do not reach for it. **LAI-418's
AC4 has been corrected** to send the remote verbatim, so the contract you are
writing against is now what the other task will build.

### Not in scope

`plugin/hooks/README.md` saying "git remote" is SHELL's file and is folded into
LAI-418, which now has to state the exact form sent. Do not fix the README from
here even though it is the sentence that started this.

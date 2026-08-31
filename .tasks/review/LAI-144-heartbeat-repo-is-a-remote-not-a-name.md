---
id: LAI-144
title: The plugin sends a git remote; §4.3 stores `owner/name`
area: server
assignee: core
priority: p2
depends-on: [LAI-116]
discovered-from: LAI-116
status: review
started: 2026-09-01T16:50:00Z
finished: 2026-09-01T17:20:00Z
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

- [x] A heartbeat whose `repo` is any of the three forms above resolves to a
      project storing `PawanSirsat/Laika`.
- [ ] The normalisation is written down in §9.1 or §4.3, wherever the decision
      below puts it. **CHIEF's — not tickable by CORE.**
      Text handed over on submission.
- [x] A `repo` that is neither a URL nor `owner/name` still degrades rather than
      erroring (§9.2).
- [x] Whichever side normalises, the **other** side has a test proving it does
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

## Submitted — CORE, 2026-09-01

**The server normalises, both sides, per CHIEF's ruling.** 10 new tests; suite
1429 green, lint and format clean. M4's exit criterion is reachable again.

### What it accepts

`owner/name` · `git@host:owner/name[.git]` · `https://host/owner/name[.git][/]` ·
`http://…` · `ssh://git@host/…` · `git://host/…` · a `user@` in the URL ·
surrounding whitespace. All normalise to `owner/name`.

Nested paths are kept whole — GitLab subgroups are real, and truncating to two
segments would merge two different repositories. Anything with nothing left after
stripping is `null`, which the caller treats as "matches nothing" (§9.2 degrades,
it never errors).

### Both sides, not just the incoming one

§4.3 asks for `owner/name` and nothing enforces it, so a project row holding a
URL is exactly as likely as a heartbeat carrying one. Normalising one side only
is a comparison that disagrees with itself depending on where the URL landed —
the same fault as folding case on one side. That is AC4's point and it is tested
directly, from both directions.

### Two edges, each of which took a test

**A scheme must be detected before the scp form.** `https://github.com/` has no
path, so a URL pattern requiring one falls through, and the scp pattern then
reads `https` as the host and returns **`github.com`** as the repository name.

**`.git` is stripped only as a suffix.** A global replace turns
`PawanSirsat/PawanSirsat.github.io` into `PawanSirsat/PawanSirsathub.io`, and
every GitHub account has that repository.

That second one is the finding worth reporting. My first version of that test
used `kvell/gitignore` and `kvell/legit`. **Neither contains `.git`**, so the
mutation that strips `.git` anywhere passed it — the test named the right
property and could not fail for it. Only the mutation showed that; reading it, it
looks correct.

### The plugin half is filed, not done — LAI-145

`plugin/` is SHELL's. It is **p3 and tidying, not a fix**: presence works today
with a hook sending a raw remote. Its criteria say explicitly that the
server-side normalisation is not to be removed if it ever lands — the server
normalises because an old plugin has to keep working against a new one.

Six mutations, all caught once the `.github.io` case existed.

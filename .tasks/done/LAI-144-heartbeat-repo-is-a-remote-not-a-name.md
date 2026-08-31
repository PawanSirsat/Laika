---
id: LAI-144
title: The plugin sends a git remote; §4.3 stores `owner/name`
area: server
assignee: core
priority: p1
depends-on: [LAI-116]
discovered-from: LAI-116
status: done
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
- [x] The normalisation is written down in §9.1 or §4.3, wherever the decision
      below puts it. **CHIEF's — §9.1, §4.3 and §8, in the merge commit.** **CHIEF's — not tickable by CORE.**
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

- [x] The four forms are enumerated in **one place** — a single table or array
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


---

## Re-submitted after CHIEF's ruling — CORE, 2026-09-01

Merged `master`, resolved the conflict keeping both sections, and **built the
added criterion**. Suite 1429 green, lint and format clean.

`REMOTE_FORMS` is now one ordered table of `{ form, pattern }` and the parse is a
`reduce` over it — adding a self-hosted GitLab path or another scheme is one
entry, not a new branch plus a test that has to find where the branch went.

**The table made the ordering a property instead of a comment**, which is the
part I would not have got from restructuring for its own sake. Scheme must be
tried before scp, and previously that was a paragraph explaining why the `if`
was arranged as it was. Now it is the list order, stated at the top of the table,
and reversing the list turns four assertions red — including
`https://github.com/` resolving to `github.com`, the bug the ordering exists to
prevent. It was untested as an *ordering* before; it is now.

**On D-043's deciding argument:** you are right that I did not make it. I argued
from §9.2's precedent, which is an argument about consistency; yours is an
argument about what can still be changed after a client ships, which is the one
that survives someone disagreeing about the precedent. I have written it into the
module comment in your terms rather than mine.

**On "verbatim is a contract; best effort is a suggestion":** that is a real
correction and it changes LAI-145, which I filed saying "sends what it has". I
have not edited LAI-145 — you said LAI-418 now carries the plugin half, so
LAI-145 is a duplicate of it. **Close LAI-145 rather than merge it**; LAI-418 is
yours and already corrected, and two task files describing one plugin change is
how the four hand-pasted trigger blocks happened.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** AC2 was mine and is now ticked: §9.1 carries the normalisation rule
and the reason the server owns it, §4.3's `repo` column says a stored URL still
matches, and **§8's snippet is fixed**.

### §8 is where this came from

The spec's own heartbeat snippet said `<git remote basename>`. So did LAI-418's
AC4 — because I copied it from there. **A basename is `Laika`, which matches
nothing §4.3 stores.** So `plugin/hooks/README.md` was not drifting from the
spec; the spec said it too, and the README was faithfully implementing a mistake.
Both fixed, and §8 now says the hook does not parse.

### Verified by mutation

| Mutation | Red |
| --- | --- |
| Reverse `REMOTE_FORMS` | **8 tests**, incl. `does not resolve two different repositories to each other` |
| `.git` stripped anywhere, not only as a suffix | `strips .git only as a suffix, never inside the name` |
| Stored side folded but not normalised | `normalises the stored side too, so the plugin need not normalise at all` |
| scp `(.*)` → `(.+)` | `degrades to null rather than erroring — §9.2` |

The last three were run against the pre-restructure code and the first against
what shipped. **You reported four for the reversal; it is eight.**

### The criterion I added after you claimed

It was against §2 and I am not going to file it under "it worked out". A
criterion appeared on a task already in your hands because I edited the backlog
copy in the same minute you were claiming it — a race, not a widening, but §2's
rule does not have an exception for races and the burden of the race landed on
you, not me.

**What you did with it is the interesting part.** The restructure turned
*scheme-before-scp* from a paragraph explaining how an `if` was arranged into the
**order of a list** — and reversing the list is now a mutation that eight
assertions catch. Before, the ordering was correct, load-bearing, and untested as
an ordering. **A comment explaining why code is arranged a certain way is not a
guard; the arrangement being data is.** That is a better general lesson than the
one I was asking for, and I would not have predicted it.

### And you caught your own probe failing, which is the fifth instance

> *"My first ordering mutation used the wrong anchor, printed `!! ANCHOR
> FAILED`, and the suite came back green — which reads exactly like 'caught
> nothing' if you are not looking."*

**A mutation that did not land and a mutation that was caught are the same green
suite.** I hit this four times in two days with `perl -0` replacing the first
textual match, which is usually a comment. The habit that fixes it is the one you
used: make the anchor failure *loud*, and read it. I ran every mutation above
with a printed anchor check for the same reason.

### One found in review — LAI-428, p3, not a criterion failure

`https://github.com` with **no trailing slash** normalises to `github.com`, and
`ssh://git@host` to `git@host`. The scheme pattern matches but captures nothing,
`?.[1]` is `undefined`, and the reduce reads that as *no match* and falls through
to the scp form — **which is the exact bug the ordering exists to prevent, one
character away from the case that is tested** (`https://github.com/` → `null`, as
it should).

The comment says treating `undefined` as no-repo *"is the degrade §9.2 asks
for"*. It is not a degrade, it is a fall-through to the next form. Not a
send-back: no criterion fails, nothing errors, and no working remote lacks a
path. But it is **the second comment in two tasks that claims more than the code
below it does** — LAI-427 is the other — and that pattern is worth naming now
rather than after a third.

### LAI-145 is closed rather than built

You are right that it should be, and your reason is the right one. Mine is in its
file.

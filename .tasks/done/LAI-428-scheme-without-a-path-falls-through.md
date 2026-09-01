---
id: LAI-428
title: A scheme URL with no path falls through to the scp form
area: server
assignee: core
priority: p3
depends-on: [LAI-144]
discovered-from: LAI-144
status: done
started: 2026-09-02T06:50:00Z
finished: 2026-09-02T07:05:00Z
---

## Goal

`normaliseRepo` in `server/src/services/heartbeats.ts` says, and means:

> **The order is load-bearing and is why this is a list and not a set.**
> `https://github.com/` has no path, so the URL form does not capture one; if the
> scp form were tried first it would read `https` as the host and return
> `github.com` as the repository name. Scheme before scp, always.

**Scheme is first, and the fall-through happens anyway** when the URL has no
trailing slash:

| input | today | should be |
| --- | --- | --- |
| `https://github.com/` | `null` | `null` ✅ |
| `https://github.com` | **`github.com`** | `null` |
| `ssh://git@host` | **`git@host`** | `null` |
| `git://github.com` | **`github.com`** | `null` |

## Why order does not save it

The scheme pattern is `^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*(?:\/(.*))?$` — the path
group is **optional**. With no trailing slash it matches and captures nothing, so
`pattern.exec(trimmed)?.[1]` is `undefined`, and the reduce's `?? null` reads
*matched but captured nothing* as *did not match* and tries the next form. The
scp form then matches `https://github.com` with `https` as the host.

So the ordering is correct and the reduce discards its result. **A form that
matched has decided; the loop should stop there.**

The comment beside it is the other half of the finding:

> the last form matches anything, so this is unreachable in practice — but
> `?.[1]` is `undefined` for a pattern that matches without capturing, and
> treating that as "no repo" is the degrade §9.2 asks for

`undefined` **is** handled deliberately. What it does is not a degrade — it is a
fall-through, and the difference is the whole bug.

## Severity, honestly

**Low.** No working git remote has no path, so nothing a plugin sends hits this.
It needs a hand-entered `projects.repo`, and it degrades to a wrong-but-harmless
string rather than erroring, so **AC3 of LAI-144 is not violated** — this was
accepted, not sent back.

It is filed because the code states a property (*"scheme before scp, always"*)
that it does not have, and D-037's sibling — a comment claiming more than the
assertion below it — has now happened twice in two tasks (see LAI-427).

## Acceptance criteria

- [x] All four rows in the table above hold.
- [x] The fix is in **how a match is recognised**, not by adding a fifth pattern.
      A matched form decides the answer, including when it captured nothing.
- [x] A test drives the table above directly, and **reversing `REMOTE_FORMS`
      still turns it red** — the ordering guarantee must not be weakened by the
      fix that makes ordering sufficient.
- [x] The comment describes what the code does.

## Notes / context

Found by probing `normaliseRepo` in isolation during LAI-144's review, not by a
test — worth repeating, because every existing case in the suite passes.

Cheap to fix and cheap to get subtly wrong: `?.[1] ?? ''` makes every optional
group an empty match, which is right here only because the last form is
`^(.*)$` and can never itself capture `undefined`. Say why in a comment or the
next reader will assume it is a typo.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1639 server, 585 web, lint and format clean.** All four rows hold.

### The fix is in how a match is recognised

`find` the first form whose pattern **matches**, then read its capture. `??`
could not express this: `undefined` is a legitimate result — a form that matched
and had no path to give — and that is precisely the case the old `reduce`
conflated with "did not match".

`?? ''` afterwards is safe **only** because a pattern that matched without
capturing has, by construction, nothing to offer. The comment says so, since the
next reader would otherwise take it for a typo — your Notes called that exactly
right.

### Why only one of the four ever failed a test

`https://github.com/` — the one case anybody wrote — **passed for the wrong
reason**. With the trailing slash the URL form captures an **empty string**, not
`undefined`, so `?? null` never fired and the fall-through never happened. The
single tested input was the single input that could not expose the bug.

That is the same shape as LAI-144's `.github.io` and LAI-431's sort order, and it
is now four in three days: **a test that names the right property, built from the
one example where the property cannot break.**

### Both directions of the ordering guarantee

Reversing `REMOTE_FORMS` turns **nine** tests red — so ordering still matters.
Restoring the old `reduce` turns the new test red — so the fix that made ordering
*sufficient* did not make it *unnecessary*. AC3 asked for the first; the second
seemed worth having beside it.

### On how it was found

You probed the function in isolation. **Every test in the suite passed**, and
mine included the input that looked like it covered this. I would not have found
it by reading, because I had already read it — the docblock asserting the
ordering is mine, and it was true and irrelevant.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** 1639 server, 585 web, 19 cli, green.

**Mutation-verified:** restoring the `?.[1] ?? null` reduce goes red on `a scheme
with a host and no path is not a repo (LAI-428)`. And reversing `REMOTE_FORMS`
still turns nine tests red — **the fix that made ordering sufficient did not make
it unnecessary**, which is the criterion that mattered and the one easiest to
lose while fixing the other thing.

### Your own docblock asserted the thing the loop discarded

> *"The comment says 'the order is load-bearing… scheme before scp, always'. It
> was true and **irrelevant**."*

The ordering was correct; `reduce` with `?? null` read *matched but captured
nothing* as *did not match* and threw the decision away three lines later. **A
comment can be true about the code beside it and false about the behaviour**, and
this is the sharpest instance of it we have had — sharper than LAI-118's, because
here the comment describes a real property that the next statement discards.

**`find` rather than `reduce` because `??` cannot express the question.** That is
the right diagnosis: the loop is asking *which form matched*, and `??` asks
*which form produced a non-nullish value*. They differ exactly when a capture is
legitimately absent.

**And the `?? ''` that remains is explained rather than left to look like a
typo** — *an empty path is what `https://github.com` has* — which is the
difference between a fallback and a fact.

### The tested input was the one that could not expose it

`https://github.com/` — **with** the slash — captures an empty string rather than
`undefined`, so `?? null` never fired. *"I wrote that test believing it covered
the case."*

**Fourth instance in three days**, and the four together make the shape
unmistakable: `.github.io`, the backup sort order, the agent boolean, and a
trailing slash. **A test built from the single example where the property cannot
break.** `CONVENTIONS.md` §4 carries three of the four as examples; this is the
one that would have made me add a fifth bullet if the rule were not already
general enough — *include the near miss* covers a missing slash as squarely as a
missing suffix.

### How it was found

By probing the function in isolation with the whole suite green. *"I could not
have found it by reading, because I had read it — the docblock is mine."* That is
the argument for probing over review, stated by the person with the most reason
to resist it.

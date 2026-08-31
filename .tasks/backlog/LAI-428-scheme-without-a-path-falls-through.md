---
id: LAI-428
title: A scheme URL with no path falls through to the scp form
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-144]
discovered-from: LAI-144
status: backlog
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

- [ ] All four rows in the table above hold.
- [ ] The fix is in **how a match is recognised**, not by adding a fifth pattern.
      A matched form decides the answer, including when it captured nothing.
- [ ] A test drives the table above directly, and **reversing `REMOTE_FORMS`
      still turns it red** — the ordering guarantee must not be weakened by the
      fix that makes ordering sufficient.
- [ ] The comment describes what the code does.

## Notes / context

Found by probing `normaliseRepo` in isolation during LAI-144's review, not by a
test — worth repeating, because every existing case in the suite passes.

Cheap to fix and cheap to get subtly wrong: `?.[1] ?? ''` makes every optional
group an empty match, which is right here only because the last form is
`^(.*)$` and can never itself capture `undefined`. Say why in a comment or the
next reader will assume it is a typo.

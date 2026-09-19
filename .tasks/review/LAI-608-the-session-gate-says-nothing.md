---
id: LAI-608
title: The session gate says nothing
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-607
started: 2026-09-19T23:49:28Z
finished: 2026-09-19T23:49:28Z
status: review
---

## Goal

**Owner:** *"i dont like that loading your account, remove that, why we need
that."*

They are right that it earns nothing. The session gate guards one `/me` call.
On any healthy instance it resolves in tens of milliseconds, so the words
existed only to flash and go — and LAI-607 had already established that a
loading state is for work the reader is **waiting through**.

## Acceptance criteria

- [x] The words "Loading your account" do not appear, at any speed.
- [x] On a normal instance the gate renders **nothing at all** — not a spinner,
      not a placeholder.
- [x] A genuinely slow `/me` still shows *something*, because the alternative
      is a blank page with no way to tell "working" from "broken".
      `status === 'error'` catches a **failure**, not a hang.
- [x] Whatever shows carries **no words**: the gate cannot know which route is
      behind it, so it has nothing to say about what is coming.
- [x] The delay hook is called with the other hooks, above every conditional
      return.

## Verified

Driven on the running instances, three cases:

| case | words | gate spinner |
| --- | --- | --- |
| normal (`:3381`) | **no** | **never rendered** |
| slow mirror (`:3382`, 1.2s API) | **no** | **never rendered** |
| `/me` held 4s | **no** | **appears** |

The third row is the one that matters: it proves the fallback is reachable.
A safety net nobody has seen catch anything is not a safety net, and the first
two rows alone would have been satisfied by deleting the branch entirely.

## Notes / context

**Why anything survives at all.** Removing the branch outright leaves a blank
page for as long as `/me` hangs, and nothing distinguishes that from a broken
build. `useDelayed`'s 150ms means the normal path renders nothing, so the
owner's complaint is fully answered while the pathological path still says
*something is happening*.

**No words, deliberately.** LAI-607's rule: a skeleton is a promise about what
is coming, and this gate cannot make one. The same argument retires the
sentence, not just its styling.

**The hook sits with the other hooks**, above every conditional return — the
defect `SprintStrip` carried until LAI-297, where an early `return null` above
`useRef` meant the empty render ran zero hooks and the loaded one ran three.

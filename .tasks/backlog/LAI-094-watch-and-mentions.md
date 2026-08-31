---
id: LAI-094
title: Watch a task, and mention a person in a comment — the notification substrate
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-060, LAI-047]
discovered-from:
status: backlog
---

## Goal

Two related capabilities the product has no concept of.

**1. `Watch` is in the design and nowhere else.** The task detail header carries
a **Watch** button. There is no subscription table, no endpoint, and nothing in
SPEC §4.

**2. Mentioning a person in a comment is the owner's request, and it is NOT in
the design.** I checked every design file: the only `@` occurrences are email
addresses and CSS `@keyframes`. **This is an addition, not a gap** — worth
building, but it should be recorded as a decision rather than smuggled in as
fidelity work.

They belong together because they share one substrate: **a set of people
interested in a task, and a way to tell them something happened.** Building
either alone means building half of it twice.

## The decision needed first

**Is there a notification concept in Laika at all, and what does it do?** Options,
narrowest first:

- **In-app only** — a mention marks the comment; the mentioned person sees it
  when they next look. No delivery, no SMTP, no new infrastructure.
- **In-app + the existing SSE stream** — the same, but it arrives live. LAI-048
  and LAI-055 already carry per-actor filtering, so the machinery exists.
- **Email** — needs SMTP, which Laika does not have and which first boot already
  reports as unconfigured. A much larger commitment.

**My recommendation is the second**, and explicitly not email: it reuses a stream
that is built, tested and already permission-filtered, and it keeps a self-hosted
board from needing a mail server to be useful.

## Acceptance criteria

- [ ] The decision above recorded in `docs/DECISIONS.md` before any schema.
- [ ] Watch/unwatch a task; watchers are derivable for a task and tasks for a
      watcher.
- [ ] **Assigning, commenting on, or being mentioned in a task implies watching
      it** unless the person has explicitly unwatched — otherwise nobody ever
      watches anything and the feature is decorative.
- [ ] Mentions are **parsed and stored server-side**, not re-parsed by each
      client. Two clients disagreeing about who was mentioned is a bug with no
      single place to fix it.
- [ ] **A mention is resolved to a user id at write time.** Storing the typed
      text means a rename silently breaks every past mention.
- [ ] **Mentioning someone must not leak a project they cannot see.** Check
      `project.read` before the mention resolves — the picker draws on
      `GET /users` (org-wide) while a task is project-scoped, and that mismatch
      is exactly where this leaks.
- [ ] SPEC gains the section (D-011).

## Notes / context

**Not in scope: unread counts and a notification centre.** Those are a screen and
a read-state model; get the substrate right first.

The design's `Watch` button is the smaller half and the one with a drawn UI.
Mentions are the owner's ask. Neither is urgent against the screens that do not
exist yet — filed so the shape is decided rather than improvised.

---

## Decided — CHIEF, 2026-09-01 (D-039)

**In-app, over the existing SSE stream.** Not email, not a separate in-app
transport.

`GET /api/v1/events` already exists, already fans out per project, already
carries `Last-Event-ID` replay, and the board already consumes it. A notification
is an `activity` row a person is interested in — which the stream is already
delivering. Email needs SMTP, a queue, retries and a bounce story before one
mention arrives; in-app-without-the-stream means polling what the stream pushes.

**Email is sequenced, not refused.** When SMTP lands for invites it can carry
mentions too, and this task's read model will already exist.

This unblocks the task. Its remaining scope is the `@mention` parse, the watch
relationship, and the unread read-model — not the delivery question.

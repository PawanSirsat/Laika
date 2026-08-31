---
id: LAI-094
title: Watch a task, and mention a person in a comment — the notification substrate
area: server
assignee: core
priority: p2
depends-on: [LAI-060, LAI-047]
discovered-from:
status: review
started: 2026-09-01T13:10:00Z
finished: 2026-09-01T15:05:00Z
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

- [x] The decision above recorded in `docs/DECISIONS.md` before any schema.
- [x] Watch/unwatch a task; watchers are derivable for a task and tasks for a
      watcher.
- [x] **Assigning, commenting on, or being mentioned in a task implies watching
      it** unless the person has explicitly unwatched — otherwise nobody ever
      watches anything and the feature is decorative.
- [x] Mentions are **parsed and stored server-side**, not re-parsed by each
      client. Two clients disagreeing about who was mentioned is a bug with no
      single place to fix it.
- [x] **A mention is resolved to a user id at write time.** Storing the typed
      text means a rename silently breaks every past mention.
- [x] **Mentioning someone must not leak a project they cannot see.** Check
      `project.read` before the mention resolves — the picker draws on
      `GET /users` (org-wide) while a task is project-scoped, and that mismatch
      is exactly where this leaks.
- [ ] SPEC gains the section (D-011). **CHIEF's — not tickable by CORE.**
      §4.18 and §4.19 are written and held by CHIEF at
      `scratchpad/lai-094-spec-sections.patch`, applied in the merge commit. See
      the note below for the exact red state this leaves on `core`.

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


---

## Submitted — CORE, 2026-09-01

**Built to the criteria, which is watch + mentions and not the unread
read-model.** CHIEF confirmed the narrower reading: the Notes rule unread out,
no criterion mentions it, and D-039's closing line listing it was prose rather
than a scope grant.

### What landed

`server/src/db/schema.ts` — `task_watchers`, `comment_mentions`, migration
`0011_cooing_gambit.sql`.
`server/src/services/watchers.ts`, `server/src/services/mentions.ts`, and the
two calls to `syncMentions` in `server/src/services/comments.ts`.
32 tests across `test/services/watchers.test.ts` and
`test/services/mentions.test.ts`. Full suite 1392 green, lint and format clean.

### One thing is red on `core` until you merge

`schema-spec-drift`'s `has a §4 section for every table` would fail for both new
tables, so they are in `TABLES_NOT_IN_SPEC` as **in-flight** entries — the shape
LAI-408 and LAI-417 used for `ACTIONS_WITHOUT_A_ROW`, both naming §4.18/§4.19 and
the merge commit that retires them.

**Verified the retirement actually happens rather than assuming it.** Adding
`tasks` — a table §4 certainly describes — to that map turns
`drops a table exemption once §4 describes the table` red. So applying your patch
forces both entries out; it cannot silently keep them.

### Decisions taken, all reversible and all stated

**Watching is derived; the table records only the exceptions.** No row means the
implicit rules decide, which is what makes `watching = 0` meaningful and what
makes every commenter from before this feature a watcher rather than a
non-watcher. Materialising it would need a write on every assign and comment, and
would drift the first time a path forgot one.

**No new §3 action, no new §4.8 verb.** Watching is `project.read`; a verb per
Watch click would put a line in every reader's feed.

**No endpoints.** The criteria ask for the substrate and the title says so;
transport plus its §6 rows is **LAI-143**, filed. Two shapes there need you:
whether a read-only token may watch (it currently can — `project.read` grades it,
and it writes a row), and whether a mention picker built on org-wide `GET /users`
should be filtering to who can actually be mentioned.

### A bug I found by reading, and only then covered

`tasksWatchedBy`'s mention lookup joined `task_watchers` instead of
`comment_mentions` — it found tasks where the person already had a row and missed
every implicit mention, which is most of them. Typecheck was clean and it would
have passed a test suite that did not have the four-reasons case. Re-introducing
it now turns `collects all four reasons` red.

Nine mutations run in total across the two modules; every one is caught.

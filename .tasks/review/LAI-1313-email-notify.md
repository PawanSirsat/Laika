---
id: LAI-1313
title: 'Email, part B: instant mail on assignment and @mention, one daily digest per person, and each person''s own preferences, through the LAI-1312 outbox (D-153)'
area: server
assignee: chief
priority: p1
depends-on: [LAI-1312]
discovered-from: LAI-1310
status: review
started: 2026-11-17T20:50:03Z
finished: 2026-11-17T21:17:48Z
---

## Goal

The notification half of D-153 (item 4). Board card LAIKA-1081.

- **Instant mail** when you are assigned a task or @mentioned in a comment.
- **One daily digest per person** for everything else on the tasks you watch, and for your
  member notices.
- **Your own two switches** in your profile: instant on or off, and digest on or off.
- **The org switch wins.** While it is off (LAI-1312), nothing is mailed. Instant mail is
  recorded `suppressed` / `email_off`, and no digest collects.

**Stacked on LAI-1312** (PR #361, in review) on CHIEF's direction (2026-11-18: "Yes, start
LAI-1313 now, stacked on `origin/LAI-1312-email-smtp`"). That is §2 step 1's exception for a
dependency CHIEF accepted and is holding; `depends-on` names it. This PR opens into `master`
once #361 lands.

## Contract

**Hook into the existing paths, not the writers** (CHIEF). A job, `email.notify`, every 30 s
under §3.4's new `system.email.notify`, reads what the board already records:

- **`activity`.** It reads rows created since a stored watermark, with a 2-minute overlap
  re-read. Not `rowid`: a VACUUM may renumber it. Every effect is idempotent, so a re-read
  costs nothing.
- **`member_notices`.** Read the same way.
- **Starting point.** The first run starts at "now"; history is never mailed.

**Instant mail.** Through the LAI-1312 outbox (`queueEmail`):

| Mail | Trigger | Key | Recipient | Not sent to |
|---|---|---|---|---|
| `assignment` | `task.assigned`, and `task.created` with an assignee | `assignment:<activity_id>` | the assignee | the actor |
| `mention` | `comment.added` and `comment.edited` | `mention:<comment_id>:<user_id>` | each person in that comment's `comment_mentions` | the actor |

Each mail carries the task's key, title and link (`LAIKA_PUBLIC_URL/task/<key>`); a mention
also carries a plain excerpt of the comment. The mention key means an edit mails only the
people it newly mentions.

**Recorded, never sent, when:**
- the switch is off (`email_off`);
- the recipient turned instant mail off (a new reason, `pref_off`);
- the recipient may no longer read the project, or is inactive (a new reason, `no_access`).

**The daily digest.** One open digest per person: KSage's rule, a partial unique index. It
collects, while the switch is on and the person's digest is on:

- **Activity** on tasks the person watches (explicit and implicit watchers, §4.18), not their
  own, and not what they were already mailed instantly. The verbs: `task.status_changed`,
  `task.assigned` to someone else, `task.updated`, `comment.added`, `attachment.added` and
  `task.stale_flagged`.
- **Their member notices.**

**Sending it:**
- **When:** at the first run after 07:00 in the person's own zone (`user_time_settings.place`,
  UTC when unset), once the digest was opened before that morning. It goes as one message
  (`digest:<id>`).
- **What:** grouped by task and worded on the server.
- **Read access** is asked again before sending.
- **Empty or too old:** items older than 7 days are dropped, and an empty digest sends nothing.

**Preferences.** `user_email_prefs` holds `instant` and `digest`, both defaulting to on (no
row means on). They're read and set at `GET`/`PUT /api/v1/me/email-prefs`, a new §3.1 row
*Read and set own email preferences* (`email_prefs.own`, session only, every role). They
appear in an **Email** section on your own profile, which says when the organisation's switch
is off.

**Schema (one migration via `pnpm run db:generate`):**
- **New tables:** `user_email_prefs` (§4.94), `email_digests` (§4.95), `email_digest_items`
  (§4.96) and `email_watermarks` (§4.97).
- **`email_outbox` CHECKs gain:**
  - kinds `assignment`, `mention` and `digest`;
  - reasons `pref_off` and `no_access`.

## Acceptance criteria

- [x] **Switch off:** an assignment or a mention writes a suppressed `email_off` row, no
      digest collects, and nothing is sent.
- [x] **Assignment mail:** assigning someone else mails them once; self-assignment and a
      claim do not. Re-running over the same activity writes nothing new.
- [x] **Mention mail:** an @mention mails the person once. Editing the comment mails only the
      newly mentioned. The author is never mailed.
- [x] **Instant off:** `pref_off` is recorded. **No access:** `no_access` is recorded and
      nothing is sent.
- [x] **Digest collection:**
  - Activity on a watched task by someone else, and a member notice, land in that person's
    one open digest.
  - Nothing of their own, nothing they were mailed instantly, nothing on a task they don't
    watch.
- [x] **Digest sending:**
  - Sent once, after 07:00 in their zone; its items are listed and grouped.
  - Empty sends nothing; items past 7 days are dropped.
  - Digest off collects nothing.
- [x] **Preferences:** read and set own. A token is refused (session only). The profile shows
      the two switches and says when email is off for the organisation.
- [x] **Guards updated, not loosened:**
  - `EXPECTED_TABLES`, `schema-spec-drift`, `schema-migration-drift`, `migration-files`,
    `migrate` (an upgrade test);
  - policy and matrix;
  - the agent-sessions census;
  - the scheduler;
  - `response-type-coverage`;
  - web `view-type-drift`, the structure WEB maps, and the source guards.
- [x] **CI:** the gate is green on the PR.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
- **Migration number:** this branch's migration follows LAI-1312's 0084, and #360 (Teams) is
  to take 0085. Whichever lands second regenerates (migrations README).

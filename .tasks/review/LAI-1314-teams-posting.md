---
id: LAI-1314
title: 'Teams posting: stand-ups and notices to each project''s Teams channel through Power Automate webhooks, KSage''s flows reused, switch ships off (D-154)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1310
status: review
started: 2026-11-17T18:33:25Z
finished: 2026-11-17T20:10:48Z
---

## Goal

Owner, 2026-11-17/18. He chose "D: Teams posting" from the LAI-1310 research, then added "implement
everything and workable but I don't want to enable this … right now, will do that later at one
click", and "reuse KSage's flows".

The old KSage (`github.com/sgirikvelldcodesage/ksage`, readable only with the PawanSirsat21 gh
token) still posts to Microsoft Teams through Power Automate flows:
- a stand-up per project twice a day (digest_runs at 05:30 and 12:30 UTC);
- a nightly digest;
- instant notices.

Two of six projects have a channel. That stops when KSage is switched off. Laika takes it over.

## Acceptance criteria

- [x] **Per-project Teams webhook URL.**
      - Stored encrypted under LAIKA_SECRET, with a new `secrets.ts` purpose.
      - Set or cleared by **org owners and admins** in Space settings.
      - The URL is write-only: never echoed, shown by host plus last 4 characters only.
      - A "Send test post" button works even while the switch is off.
      - Every endpoint calls `can()`. Add a new §3.1 row/action if no fitting one exists.
- [x] **Org switch "Teams posting on"**, default **off**, in Organisation → Integrations, for
      owners and admins. While off nothing is posted, and each would-be post is recorded as
      suppressed with a reason.
- [x] **What is posted is ported from KSage's code** (find its Teams/Power Automate module, the
      digest_runs and stand-up logic):
      - the same triggers, schedule and **payload shape**, so the existing Power Automate flows
        accept Laika's posts unchanged;
      - the stand-up at the same UTC times, as a scheduler job in `jobs/scheduler.ts`;
      - the instant notices KSage sends.
      - Map KSage concepts to Laika's: tasks, statuses, sprints, assignees.
      - Write the mapping in the task file.
- [x] **Import KSage's existing flows.** Expose an owner/admin route that sets a project's webhook,
      so CHIEF can import the existing per-project URLs after release by reading KSage's DB with
      SELECT only. Do not put the URLs in code, tests or the repo.
- [x] **Outbound safety:** a bounded timeout, no retry storm, and the response body never echoed
      or logged. Tests use an injectable fetch (the `clan-client.ts` / `fake-clan.ts` pattern);
      no real Teams call ever happens in tests.
- [x] **D-154** at the end of `docs/DECISIONS.md`: Teams posting via operator-configured Power
      Automate webhooks, off by default, owner/admin managed, a new outbound destination amending
      §13.4. Plus the SPEC rows: §3.1, §4 tables, §6.4, §11.6 job, §13.4.
- [x] CI gate green on the PR: test, lint, format each exit 0.

## Notes / context

- Ksage 2.0 is https://ksage.kvelld.com (Coolify): Frontend nginx, Backend /api /mcp /webhooks.
  Release: CHIEF merges to master (deploys AWS), pushes to KvellDynamics/ksage-2.0 `laika`, and
  redeploys Ksage. The builder stops at a green PR.
- Reserved decision numbers: D-152 icons (laika-c4), D-153 email (laika-59), D-154 this,
  D-155 email-to-task.
- Avoid a new activity verb; a verb needs three owners (CLAUDE.md §4.4).

## Build notes (CHIEF's builder, Belka, 2026-11-18)

### What KSage sends, ported byte for byte

Read from `sgirikvelldcodesage/ksage` (`apps/api/src/notify.rs`, `routes/scheduled.rs`,
`routes/items.rs`, `routes/comments.rs`, `routes/projects_admin.rs`, `routes/delivery.rs`,
`migrations/0037_digest_runs.sql`):

- **One request per post**: `POST <the project's webhook>`, header
  `content-type: application/json; charset=utf-8`, body `{"text":"<html>"}` — the only field
  the flow reads (`triggerBody()?['text']`, *"Post message in a chat or channel"*). Built by
  hand with **every non-ASCII UTF-16 unit escaped `\uXXXX`** (the gateway refuses raw
  multi-byte characters `400`). Any `2xx` is sent (Power Automate answers `202`). Timeout 10 s.
- **The HTML** (`Notice::to_html`): `<b>title</b>`, `<b>label</b>`, `<b>Key:</b> value` fields,
  lines joined with `<br>` (an unindented line ending in `:` is bold; leading spaces become
  `&nbsp;`), tables as `<br><br><b>heading</b><br>note<table style="border-collapse:collapse;margin-top:6px" border="1" cellpadding="6">`
  with `<th align="left" style="background:#f2f5f8">` and `<td align="left">` (an empty
  section keeps heading and note, no grid), `<br><br><b>Actions / next steps</b><ul><li>…</li></ul>`,
  then `<br><br><a href="…">Open in Laika</a>` (KSage: *Open in KSage*). `&`, `<`, `>` escaped.
- **Stand-up** (`build_update`): title `{name} ({PREFIX}) — Daily Update`, label
  `11:00 AM IST Run Update` / `06:00 PM IST Run Update`; fields Run, Status
  (🔴 Blocked / 🟡 At Risk / 🟢 On Track / ⚪ Not Started), As of (`Wed 21 Oct 2026, 11:00 IST`),
  Owner; a counts strip; tables Key updates (since the previous run; Monday's reaches back to
  Friday 18:00), Blocked, Stale (KSage's On hold), Past their date, In flight (per person);
  actions; `Next update: …`. At 05:30 and 12:30 UTC, Monday to Friday (IST calendar).
- **Nightly digest** (`send_digest`, COL-007): title `{name} ({PREFIX}) — {YYYY-MM-DD}` for the
  SAST day before; `Blocked (n):`, `Waiting for review: n`, `Moved (n):` — sent only when
  something moved or is blocked. At 07:00 UTC daily.
- **Notices** (`item_notice`, comment notice), each ending `Space: {name}` and a task link:
  `{to} — {KEY} is yours` / `Handed over by {by}.`; `{assignee} — {KEY} came back from {from}` /
  `Now in {to}.`; `{KEY} is waiting for review`; `{KEY} is done — {by}`;
  `{KEY} is blocked — {assignee}` / `Waiting on: {KEY} {title}`; `{KEY} is unblocked — {assignee}`;
  `New comment on {KEY}` / title / `{author} · {role}` / body (cut at 1000 characters).
- **Test post** (`notify-test`): `Laika is connected to this channel — {name} ({PREFIX})`.

### KSage → Laika

| KSage | Laika |
| --- | --- |
| project, its code `RMB` | space, its key prefix `LAI` |
| work item `RMB-52` | task `LAI-52` |
| owner | assignee (`Unassigned` when none) |
| project lead, else an administrator | the space's `lead` membership, else `(no space lead set)` |
| blocked (a pause with a cause) | an open task with a `blocked_by` that is not done |
| on hold (our own choice) | stale: `in_progress` and flagged by §11.6 |
| in progress, unit testing, QA | `in_progress` |
| UAT, *with the client* | `review` |
| due date | `due_on` |
| signed off | `done` |
| the audit log's `item.*` rows | `activity`'s `task.*` rows |
| `Assigned` | `task.assigned` to somebody else (not a self-assignment, not offboarding) |
| `SentBack` | `task.status_changed` from `review` to `in_progress`, `todo` or `backlog` |
| `AwaitingSignOff` | `task.status_changed` into `review` |
| `SignedOff` | `task.status_changed` into `done` |
| `Blocked` | `task.dependency_added` while the blocker was not done |
| `Unblocked` | the last open blocker done, or removed — as the board stood at that moment |
| comment notice | `comment.added` by a person (never an agent) |
| `digest_runs (project, run_key, run_on)` | `teams_posts.slot`, partial unique index |
| `projects.teams_webhook_url` | `project_teams_channels.webhook_url_enc` (encrypted, write-only) |

**Not ported — follow-ups:** *Shipped* (Laika has no deployments), the agent pull-request
Adaptive Card (no approval tokens), and the per-person inbox delivered to email and Teams (no
inbox). Agents' comments are skipped on purpose.

### Routes and actions

- `GET`/`PUT /api/v1/org/teams` — the switch; `GET`/`PUT`/`DELETE /api/v1/projects/:slug/teams`
  — the channel; `POST /api/v1/projects/:slug/teams/test` — a test post (own rate-limit bucket,
  6 a minute). All `org.teams.configure`, session only.
- `system.teams.post` — the `teams.post` job, every minute.

### Importing KSage's two flows (CHIEF, after release)

Inside the backend container, a one-off node script: read the two webhook URLs from KSage's
database with `SELECT` only, then for each space call
`setProjectTeamsChannel(db, loadActor(db, ownerUserId)!, slug, { webhook_url }, process.env.LAIKA_SECRET)`
(`server/src/services/teams.ts`; `loadActor` from `server/src/auth/resolve-actor.ts`). It
checks the host (`*.powerplatform.com`, `*.logic.azure.com`, `*.webhook.office.com`), encrypts,
and returns the view with host and last four only — never print the URL. Then the space's
*Send test post* proves the flow, and the switch is turned on when the owner says.

### Review round 1 (review-1314, via CHIEF, 2026-11-18)

- **A blocker in another space is never named** — the *blocked* notice says
  `Waiting on: a task in another space`, and the stand-up and digest say the
  same (several: `N tasks in other spaces`) — never its key or title
  (`OTHER_SPACE_BLOCKER`, `waitingWords`).
- **The switch and the channel are read at each post** (`postAndRecord`),
  synchronously before the claim: off by then → `suppressed`, `posting_off`;
  channel removed → nothing posted, nothing recorded; replaced → the new
  address. The tick no longer carries either.
- `GET /org/teams` lists only the channels of spaces the caller can open.
- The stale list is capped at 25 with `… and N more`; `"` is escaped as
  `&quot;`; a long comment is cut by code point; `finished_at` is the clock
  when Teams answered (the job now hands the posting service the clock, not
  the tick's instant); the `dueSlots` comment says the digest goes every day.
- Tests: mid-tick off / removed / replaced, cross-space notice and stand-up and
  digest, the per-space filter with *Change organisation settings* without
  *Open every project*, the WAL checkpoint before the file read (with a
  positive control), allow-list cases (`evil-powerplatform.com`, a trailing
  dot, upper case, IDN labels), the stale cap, the code-point cut, the quote.
- Filed **LAI-1320** (backlog, discovered-from LAI-1314): the digest's *Moved*
  reads `tasks.updated_at`; read status changes from `activity` instead.

### Merged master `95cec12ee` (2026-11-18)

#358's icons took **0083** and #361's email outbox **0084** and SPEC **§4.93**,
so this branch's migration is now **`0085_teams_posting`** — regenerated from
master's 0084 snapshot, its SQL byte-identical to the old 0083 (three
`CREATE TABLE`s and their indexes), a second generate writing nothing — and
its tables are **§4.94 `org_teams_settings`, §4.95 `project_teams_channels`,
§4.96 `teams_posts`**. Earlier notes in this file that say 0083 or §4.93 –
§4.95 are as they were written.

### Review round 2 (review-1314, via CHIEF, 2026-11-18)

- The stand-up's *and N more* counts every blocker: `waitingWords` answers the
  true total beside the words (`waitingTotal`), and another space's entry now
  comes last, so a first entry that has company is always one key. One of the
  space's own blockers and three elsewhere reads `waiting on LAI-1 and 3 more`.
- A record's headline is cut by code point, as a comment is (`titleOf`).
- LAI-1320 is mirrored on the board as LAIKA-1089.

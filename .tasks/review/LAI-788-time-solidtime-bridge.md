---
id: LAI-788
title: 'Time, phase 2: Solidtime bridge — the developer''s CLI writes confirmed time to Solidtime and reads back what was logged there'
area: cli
assignee: owner-direct
priority: p1
depends-on: [LAI-787]
discovered-from:
status: review
started: 2026-10-20T04:29:37Z
finished: 2026-10-20T05:44:27Z
---

## Goal

Confirmed Laika time reaches Solidtime, Kvell's billing record, as
`KEY title` entries, and time people log directly in Solidtime (meetings,
calls) shows in Laika against the right card — with no outbound call from the
Laika server (D-088 item 10, §13.4).

## Acceptance criteria

- [x] `laika time` connect/push/pull/status in cli/; the person's own Solidtime
      URL and key stored on their machine only (0600), never sent to Laika.
- [x] Push: confirmed entries created in Solidtime with `KEY title`
      description, project mapped; no duplicates (local sent-log plus a check
      of existing entries); once pushed, Solidtime is the record and Laika
      never overwrites it.
- [x] Pull: re-reads a window of recent days (Solidtime has no webhooks and no
      updated-at), matches entries to cards by key with Laika's never-guess
      rule, sends them inbound to a new Laika import endpoint; edits and
      deletes caught; entries after a closed period flagged, not taken.
- [x] Mapping: Solidtime projects to Laika spaces (many-to-one), people by
      email confirmed by an admin; unmatched people's hours shown as "people
      not on Laika", not dropped.
- [x] Optional: start/stop a Solidtime timer for a card from the CLI, never
      automatically when an agent claims a card.
- [x] Tested against recorded Solidtime v0.22 API shapes (no live instance
      needed in CI). Gate: test, lint, format exit 0.

## Notes / context

Solidtime API and integration design: ~/Documents/laika-strategy/time-tracking/REPORT.md (from Solidtime's source
at v0.22.0). Solidtime's company URL is not yet known; build against the API
and leave the URL to `laika time connect`.

## Delivered (LAI-788, owner-direct, branch `LAI-788-solidtime-bridge`, not pushed)

- **Server** — migration `0042_time_solidtime` (additive: three `CREATE
  TABLE`, one `ALTER TABLE … ADD`): `solidtime_projects` (many Solidtime
  projects → one space, one `push` target), `solidtime_people` (admin-confirmed
  member ↔ person), `solidtime_entries` (what Laika last took from or wrote to
  each Solidtime entry — the twin of a person's entry, or a *people not on
  Laika* row), `org_time_settings.closed_through` (set by LAI-789's month
  close). `services/time-solidtime.ts`: the outbox, links, own and everyone's
  import, the map and the people; `time-entries.ts` gains `syncEntry` and
  `retireEntry` (each writes its revision). Routes on `/me/time/solidtime` and
  `/org/time/solidtime`. Three `SESSION_ONLY_ACTIONS` rows.
- **CLI** — `cli/src/solidtime.ts` (Solidtime v0.22's API: `{ data }`,
  `page` and `limit`/`offset` paging, `user_id` not `member_id`, UTC seconds)
  and `cli/src/time-solidtime.ts`: `laika time connect | status | push | pull
  [--all] | people | map | start | stop | disconnect`.
- **Tests** — server `test/services/time-solidtime.test.ts`,
  `test/http/routes/time-solidtime.test.ts`; CLI `test/time-solidtime.test.ts`
  against `test/support/fake-solidtime.ts` (v0.22's shapes, from the research)
  and `test/support/stub-sync-board.ts`.

### How the contract is met

- **Key on the machine only.** `~/.laika/solidtime.json`, `0600` in a `0700`
  `~/.laika`; asked for, never a flag; https, or http to loopback only. The
  board gets no Solidtime URL, key or description: asserted on every stub
  request, and on the real run by grepping the board's database and log with a
  positive control.
- **Signed in, never a token.** §3.1 serves a person's hours to no token, and
  pushing them means reading them; so the CLI asks for the Laika password per
  run, signs in, and signs out. The machine's token (the agents' token) can
  neither read nor send the hours.
- **No duplicates.** Local sent-log written before the board is told; a
  whole-window read of what Solidtime holds before each create (same start,
  end and key is the same entry, unless the board lists it as `taken`); the
  board's `solidtime_entries` keeps one row per Solidtime id, whoever's CLI
  reads it — an admin's pull reconciles a person's pushed entry rather than
  importing it again.
- **Solidtime is the record once there.** A Solidtime change Laika has not
  seen is taken over Laika's own (counted as a conflict, Laika's kept in the
  revisions); a Laika edit or delete is written only while Solidtime still
  holds what Laika last saw, compared before writing; Solidtime's project and
  description are changed only when Laika's card or space moved.
- **Closed period.** On or before `closed_through` the outbox offers nothing
  (`held`), and an import flags a new, edited or deleted entry and takes none
  of it.
- **Pull.** 35 days by default, to the end of the local day; whole-window or
  no deletes (`complete`); deletes only for members a batch covers; key: the
  one the description starts with, else the only one, Solidtime task name
  first; the board resolves it never guessing (`resolveKeys`).
- **Mapping and people.** `laika time map` (many to one, `--push`);
  `laika time people` matches by email on the machine, the admin confirms each,
  only `{ solidtime_member_id, user_id }` reaches the board. Unmatched
  members' hours are kept as *people not on Laika* and counted.
- **Agent minutes** never leave: the outbox reads `time_entries` of source
  `draft` and `manual` only; `agent_time_days` is not read.
- **Timers.** `start KEY [--switch]` / `stop`; refused under CI,
  `LAIKA_ACTIVITY_SKIP` and an Omnigent agent's session; a test reads every
  plugin file and finds nothing that starts one.

### For the reviewer

- **The orchestrator's brief and the task file differed** on Laika edits
  after a push ("edits and deletes in Laika update/remove the Solidtime entry"
  against "once pushed, Solidtime is the record and Laika never overwrites
  it"). Built as: a Laika edit goes out only while Solidtime is unchanged
  since they last agreed; any Solidtime change wins. Laika never overwrites a
  change made in Solidtime.
- **Session, not token, for the sync** — the alternative (a token reading
  its own person's hours) would reverse §3.1's sentence and wants a decision.
  The cost: a password per run, so no unattended schedule.
- **SPEC edits, each forced by a drift guard:** §3.1 (three rows and a
  paragraph), §4.45 (`closed_through`), §4.52–§4.54, §6.4 (routes and prose),
  §11.6 (retention), §13.4 (one paragraph). Not named in this task file.
- **Server tests' `UNPAIRED`** now names the four response types the CLI
  reads; no screen shows them.
- **Not done here:** the month close that sets `closed_through`, a stored
  list of flags, and locking Laika's own edits on a closed day — LAI-789's.
  No UI, so no screenshots.
- **Found by the real run, not the tests:** the pull's window ended at *now*
  and read nothing in the morning; `GET /tasks/:id` takes no key (the stub had
  pretended it did). The window fix has a test shown red on the old window;
  the card now comes from `/mcp`'s `get_task_context`, the stub answers as
  `/mcp` does, and the real run passes. LAI-797 filed for a REST lookup.
- **Gate:** the first root `pnpm test` exited 1 — the web endpoint-coverage
  guard (the seven routes are the CLI's; now named in `NO_BROWSER_CALLER`)
  and `cli/test/activity-sync.test.ts`'s 300 ms deadline test under load
  (43/43 alone; untouched here; LAI-798 filed). See the log for the final
  gate's exit codes.

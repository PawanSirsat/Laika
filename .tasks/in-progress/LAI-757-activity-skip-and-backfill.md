---
id: LAI-757
title: 'Local activity: automated sessions never count, and a one-time 12-month look-back of pushed commits (plugin/ + cli/ + server/ + docs/)'
area: cli
assignee: chief
priority: p1
depends-on: [LAI-751, LAI-752]
discovered-from:
started: 2026-10-15T23:58:27Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-16, through
the orchestrator), single-agent mode, on the temporary branch
`build-activity-backfill` cut from `master` `3813ead`. Board card LAIKA-563.
One branch changes `plugin/`, `cli/`, `server/` (not `server/web/`) and
`docs/` together. Not pushed, not merged: the orchestrator reviews and merges.

The owner turned local activity on (LAI-751, LAI-752, D-079) and found two
problems. Claude Code sessions that Omnigent launches on the same Mac, under
the owner's account, would count as the owner's prompts and sessions. And
pushed commits only count from the moment sharing was switched on, so the
GitHub row starts empty where the owner wants a GitHub-like twelve months.

## Acceptance criteria

**Part 1 — automated sessions do not count**

- [ ] `plugin/scripts/laika-activity-hook` is a complete no-op when any of
      `OMNIGENT=1`, a non-empty `CI` or a non-empty `LAIKA_ACTIVITY_SKIP` is
      set: nothing written under `~/.laika/activity`, nothing printed, exit 0,
      stdin still drained, no fork under zsh, decided before `state.json` is
      read. A skipped session start registers no repo and starts no sync.
- [ ] `laika activity status` and the output of `laika activity on` name the
      skip rules in one line.
- [ ] Tests: each marker → no event, no output, exit 0, no repo, no sync
      launched; none set → counted as before; the prompt path's timing test
      still holds.

**Part 2 — a one-time look-back of up to 365 days of pushed commits**

- [ ] `laika activity backfill [--days N] [--yes] [<repo path>…]` (N default
      365, at most 365) counts the developer's own pushed commits per day in
      the repos the collector knows plus any paths given, by the same rules as
      the pushed-commit count (author email, `laika activity emails` extras,
      `.mailmap` ignored, merges not counted), prints a summary (commits, days,
      per month), asks y/N unless `--yes`, and sends one-way keys per day
      through `PUT /api/v1/me/local-activity` — never commit ids, messages,
      paths, repo names or emails.
- [ ] It takes the single-sync lock, stays inside the 2-minute limit, and
      chunks: reports at most the server's per-request cap, a bounded number
      per run, the rest continued by later syncs.
- [ ] Automatic: a repo seen for the first time gets its 365-day look-back once,
      in the background sync after the snapshot — never on the prompt path —
      and is recorded so it never repeats.
- [ ] Idempotent: a second backfill changes nothing on the server, and a
      commit that was counted local and later pushed is not counted twice.
- [ ] Server: `PUT /me/local-activity` accepts pushed-commit keys for days back
      to the 400-day retention window in a look-back report, with a bounded
      payload; beyond retention is refused with the existing
      `day_out_of_range` shape; the report bucket is unchanged and a backfill
      does not trip it. No destructive DB change. Tests for old days accepted,
      beyond retention refused, the payload cap and idempotency.
- [ ] Measured: a 20,000-commit repo's look-back on the CLI side (target under
      ~2 s), and the server PUT for a full year against the existing ingest
      latency target.

**Docs and gate**

- [ ] D-080 appended to `docs/DECISIONS.md` (D-079 untouched); SPEC's local
      activity sections and the collector's commands match; `cli/README.md`
      and `plugin/README.md` updated. No comment claims more than its code or
      test proves.
- [ ] Each new test shown failing before its fix. `pnpm test`, `pnpm lint`,
      `pnpm format` each exit 0, run separately after the last edit.

## Notes / context

- No new dependencies.
- LAI-751 (server, SPEC, D-079) and LAI-752 (collector) are in `done/`.

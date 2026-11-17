---
id: LAI-1314
title: 'Teams posting: stand-ups and notices to each project''s Teams channel through Power Automate webhooks, KSage''s flows reused, switch ships off (D-154)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1310
status: in-progress
started: 2026-11-17T18:33:25Z
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

- [ ] **Per-project Teams webhook URL.**
      - Stored encrypted under LAIKA_SECRET, with a new `secrets.ts` purpose.
      - Set or cleared by **org owners and admins** in Space settings.
      - The URL is write-only: never echoed, shown by host plus last 4 characters only.
      - A "Send test post" button works even while the switch is off.
      - Every endpoint calls `can()`. Add a new §3.1 row/action if no fitting one exists.
- [ ] **Org switch "Teams posting on"**, default **off**, in Organisation → Integrations, for
      owners and admins. While off nothing is posted, and each would-be post is recorded as
      suppressed with a reason.
- [ ] **What is posted is ported from KSage's code** (find its Teams/Power Automate module, the
      digest_runs and stand-up logic):
      - the same triggers, schedule and **payload shape**, so the existing Power Automate flows
        accept Laika's posts unchanged;
      - the stand-up at the same UTC times, as a scheduler job in `jobs/scheduler.ts`;
      - the instant notices KSage sends.
      - Map KSage concepts to Laika's: tasks, statuses, sprints, assignees.
      - Write the mapping in the task file.
- [ ] **Import KSage's existing flows.** Expose an owner/admin route that sets a project's webhook,
      so CHIEF can import the existing per-project URLs after release by reading KSage's DB with
      SELECT only. Do not put the URLs in code, tests or the repo.
- [ ] **Outbound safety:** a bounded timeout, no retry storm, and the response body never echoed
      or logged. Tests use an injectable fetch (the `clan-client.ts` / `fake-clan.ts` pattern);
      no real Teams call ever happens in tests.
- [ ] **D-154** at the end of `docs/DECISIONS.md`: Teams posting via operator-configured Power
      Automate webhooks, off by default, owner/admin managed, a new outbound destination amending
      §13.4. Plus the SPEC rows: §3.1, §4 tables, §6.4, §11.6 job, §13.4.
- [ ] CI gate green on the PR: test, lint, format each exit 0.

## Notes / context

- Ksage 2.0 is https://ksage.kvelld.com (Coolify): Frontend nginx, Backend /api /mcp /webhooks.
  Release: CHIEF merges to master (deploys AWS), pushes to KvellDynamics/ksage-2.0 `laika`, and
  redeploys Ksage. The builder stops at a green PR.
- Reserved decision numbers: D-152 icons (laika-c4), D-153 email (laika-59), D-154 this,
  D-155 email-to-task.
- Avoid a new activity verb; a verb needs three owners (CLAUDE.md §4.4).

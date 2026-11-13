---
id: LAI-1180
title: 'D-149 and the SPEC for leave and holidays from the organisation''s HR system (Clan)'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
status: backlog
---

## Goal

Andrea asked for Clan (Kvell's HR / leave system, a Worksuite build with a
REST API at `https://<company>.clan.biz/api/v1`, docs at
`https://app.clan.biz/docs`) to feed company holidays and people's leave into
Laika (owner, 2026-11-13). Record the decision and the contract before code:
**D-149** and the SPEC sections the two PRs need.

## Acceptance criteria

- [ ] `docs/DECISIONS.md` **D-149 — Leave and holidays come from the
      organisation's HR system**, items 1–8 as in the plan: a fourth outbound
      category (GET-only + one login, off until connected, token encrypted,
      password never kept); what Laika keeps and never keeps; Clan is the
      record for leave, away periods unchanged (D-131 holds for them), LAI-1176's
      retention change dropped; people by email with an owner's override;
      visibility (holidays to everyone, "On leave" / "Leave requested" where
      availability is visible under D-137, the type to the person, owners,
      admins and *See everyone's analytics*); not due (holiday covering the
      person or approved full-day leave; approved half day owes half the
      threshold; pending never changes what is due); sync cadence, window,
      reconcile by absence with `removed_at`; manual holidays under
      `org.time.set`, a manual one winning over Clan's on the same day.
      Amends §13.4, D-131 item 1 (leave only), D-148 items 5 and 8.
- [ ] SPEC §13.4 names the HR source as the fourth outbound call.
- [ ] SPEC §3.1 row for `org.hr.configure`; §3.4 row for `system.hr.sync`;
      §4 entries for `org_hr_source`, `hr_people`, `org_holidays`,
      `leave_days`; §6.4 lines for every endpoint LAI-1181 adds; §11.6 the
      `hr.sync` job; §11.4.2 / §11.4.2.1 the Organisation screen's HR card
      and Holidays list.
- [ ] LAI-1176 is marked superseded in its own file by LAI-1180–1185 (moved
      to `done/` by CHIEF with a note, not built).
- [ ] The PR B half of the SPEC (the `off` facts on the reads, the grid's
      cells, the My day marks, the pill) lands with PR B as LAI-1183's named
      docs, not here.

## Notes

- Plan: `~/.claude/plans/now-you-have-very-validated-perlis.md` (2026-11-13).
- Owner decisions, 2026-11-13: server syncs and stores; type visible to self
  + owners/admins; half day owes half; all four UI places; holidays
  scope-aware; pending shown as "Leave requested"; connect by signing in once.

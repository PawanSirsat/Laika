---
id: LAI-788
title: 'Time, phase 2: Solidtime bridge — the developer''s CLI writes confirmed time to Solidtime and reads back what was logged there'
area: cli
assignee: owner-direct
priority: p1
depends-on: [LAI-787]
discovered-from:
status: in-progress
started: 2026-10-20T04:29:37Z
---

## Goal

Confirmed Laika time reaches Solidtime, Kvell's billing record, as
`KEY title` entries, and time people log directly in Solidtime (meetings,
calls) shows in Laika against the right card — with no outbound call from the
Laika server (D-088 item 10, §13.4).

## Acceptance criteria

- [ ] `laika time` connect/push/pull/status in cli/; the person's own Solidtime
      URL and key stored on their machine only (0600), never sent to Laika.
- [ ] Push: confirmed entries created in Solidtime with `KEY title`
      description, project mapped; no duplicates (local sent-log plus a check
      of existing entries); once pushed, Solidtime is the record and Laika
      never overwrites it.
- [ ] Pull: re-reads a window of recent days (Solidtime has no webhooks and no
      updated-at), matches entries to cards by key with Laika's never-guess
      rule, sends them inbound to a new Laika import endpoint; edits and
      deletes caught; entries after a closed period flagged, not taken.
- [ ] Mapping: Solidtime projects to Laika spaces (many-to-one), people by
      email confirmed by an admin; unmatched people's hours shown as "people
      not on Laika", not dropped.
- [ ] Optional: start/stop a Solidtime timer for a card from the CLI, never
      automatically when an agent claims a card.
- [ ] Tested against recorded Solidtime v0.22 API shapes (no live instance
      needed in CI). Gate: test, lint, format exit 0.

## Notes / context

Solidtime API and integration design: ~/Documents/laika-strategy/time-tracking/REPORT.md (from Solidtime's source
at v0.22.0). Solidtime's company URL is not yet known; build against the API
and leave the URL to `laika time connect`.

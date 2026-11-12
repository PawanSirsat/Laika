---
id: LAI-1210
title: 'A deeper UX pass on every Organisation tab'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1194]
status: in-progress
started: 2026-11-12T09:00:00Z
---

## Goal

The owner asked for better UX on every `/organisation?tab=…` tab. Stacked on
LAI-1194 (PR #316), this pass takes each tab — Overview, Work, People, Roles,
Integrations, Security, Activity — from "refined" to "leads somewhere": an
audit first (`.polly/specs/organisation-tabs-critique.md`), then fixes to
hierarchy, density, actions, feedback and state in `server/web/` only.
UI only, existing public API only, no new dependencies, no demo data,
permissions from the server (hide what the reader cannot do).

## Acceptance criteria

- [ ] A per-tab critique with before-screenshots (dark/light, 1440/390) is
      written before implementation.
- [ ] Overview: the figures lead somewhere (people → People, pending invites →
      People filtered to pending, spaces → the spaces list, tokens → Security
      for a reader who may list them); settings grouped in clear cards.
- [ ] People: search and role/status filters live in the URL and survive a
      reload; row actions sit in one consistent ⋯ menu reachable by keyboard;
      pending invites are clearly separated; honest empty and filtered states.
- [ ] Roles: the matrix reads as role columns × grouped actions with a find
      box and a "what can this role do" explanation; no wall of chips.
- [ ] Work: hierarchy, density, toolbar and empty states polished; LAI-1170's
      behaviour unchanged.
- [ ] Integrations: each integration is a card with status, what it does and
      its primary action; the model prices table reads at 390.
- [ ] Security: tokens summarised by owner with last used, scope and expiry
      from real fields; never-used and stale tokens marked only from those
      fields; revoke confirms and reports the result.
- [ ] Activity: filters (actor, type, date) in the URL, grouped by day, rows
      link to their subject.
- [ ] All tabs: consistent header and section spacing, icon-only controls
      named, loading skeletons, error + Retry keeping last data, both themes,
      390/768/1440 without page-level horizontal scroll, keyboard + SR,
      reduced motion. The shared tab component and `theme.css` are not edited.
- [ ] Playwright cases for the new behaviours, each key behaviour mutated once
      and shown red; after-screenshots.
- [ ] `pnpm lint`, `pnpm format`, web typecheck, the web test script (4
      shards) and the server tooling guards exit 0.

## Notes / context

- Skills consulted as advice (repo rules win): `impeccable` (critique →
  polish), `emil-design-eng`, `break-ui` (hundreds of people, long names and
  emails, many tokens, an empty organisation).
- Overlaps not on this base, to adopt after merge rather than duplicate:
  #288 toast (PeopleTab), #318 shared Tabs + Tooltip, #331 Button/Field/Icon,
  #330 Chip/Avatar, #328 state kit.
- No new packages.

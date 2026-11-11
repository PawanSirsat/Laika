---
id: LAI-1207
title: 'Polish the shared empty, loading and error state components'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T10:00:00Z
---

## Goal

One polished, shared kit for empty, loading and error states in `server/web/`:
empty states that never look like errors, skeletons that match the layout they
replace and do not flash, and error states that say what happened, why, and
offer Retry — including a "stale data" banner that keeps the last good data.
Show every variant on `/design/states` in both themes, and move a bounded set
of screens that no open PR touches onto it.

## Acceptance criteria

- [ ] Empty: neutral tone (never error colours, never `role="alert"`), title +
      one-line why + one primary next action (+ optional secondary); variants
      first-use, filtered-no-match (offers Clear filters), no-permission,
      all-caught-up; optional small icon from the in-house icon set.
- [ ] Loading: skeleton primitives (text line, avatar, card, table row) sized
      like the real layout; appearance delayed (~300ms) so fast loads never
      flash; `aria-busy` + one polite screen-reader announcement; an inline busy
      indicator for small regions; no motion under reduced motion.
- [ ] Error: what happened + why (server message when safe) + Retry + optional
      secondary help; a stale-data banner variant that keeps the last good data,
      shows its age and offers Retry. Naming/API converges with LAI-1128's
      `StaleNotice` and LAI-1197's developer `StaleNotice` so both can adopt it;
      no file those PRs own is edited.
- [ ] `/design/states` shows every new variant, in both themes.
- [ ] A bounded set of screens no open PR touches migrated (census in the log);
      follow-ups listed.
- [ ] Unit + Playwright tests: empty never error-styled / never `role=alert`,
      filtered-empty Clear works, skeleton delay, error Retry, stale banner
      keeps data, reduced motion. One mutation per key behaviour.
- [ ] Both themes, 390/768/1440, reduced motion, keyboard + screen reader.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck and the web test script
      (4 shards) each exit 0.

## Notes

Design skills applied as advice (repo rules win — strict CSP, tokens only, no
new dependencies, no remote assets): `impeccable` (polish pass),
`emil-design-eng` (restraint, invisible details), `animate` (skeleton motion
only where it carries meaning; none under reduced motion) and
`remove-animations` (cut motion that does not help). Not used: oil-ui,
stageshow, taste-skill.

Files owned by open PRs are not edited: `EmptyState.tsx`, `states.css`,
`StaleNotice.tsx` (#280), developer `StaleNotice.tsx` (#320),
`PermissionDenied.tsx` (#287). The new kit lives in new files so those PRs
merge cleanly and can adopt it afterwards.

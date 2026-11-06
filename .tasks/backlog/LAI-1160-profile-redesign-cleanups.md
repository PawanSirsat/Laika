---
id: LAI-1160
title: 'Profile redesign cleanups: unused embedded My day and profile CSS, flaky My day tests'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1155
status: backlog
---

## Goal

Small follow-ups the independent reviews of the profile programme (LAI-1148)
found, none blocking.

## Acceptance criteria

- [ ] `MyDayScreen`'s `embedded` prop and the `.myday-embedded` CSS
      (`server/web/src/routes/screens/my-day/my-day.css`) have no caller since
      LAI-1155 replaced the profile's embedded My day — remove them and the
      branches gated on `embedded`, or record why they stay.
- [ ] Two My day browser tests flaked on PR #301's CI and passed on re-run:
      *the header (LAI-502) — a phone walks the days … the header holds at 1440*
      and *the Timeline card as TimelineV2 draws it (LAI-512) — an edge within
      9px of the end resizes it*. Reproduce under load and fix the wait, so a
      green gate does not need a re-run.
- [ ] About 20 selectors in `server/web/src/routes/screens/profile/profile.css`
      lost their last user when LAI-1153 replaced the Overview cards
      (`.prof-columns`, `.prof-column`, `.prof-pbar*`, `.prof-project*`,
      `.prof-work-*`, `.prof-seg-face`, `.prof-show-all`, `.prof-group-title`,
      `.prof-agents>li`, `.prof-token-names`, `.prof-tokens-toggle`,
      `.prof-unmeasured`, `.prof-load`, `.prof-scroll`, `.prof-sub*`,
      `.prof-error`, `.prof-hours-*`) — grep `server/web/src` for each and
      delete the ones with no caller (from #300's review).

## Notes / context

From the reviews of PR #299 (dead code) and PR #301's CI run 42174113662
(flakes). The two test-message nits from #297's review and #301's `<= 1`
assertion are being fixed inside LAI-1154 and LAI-1153.

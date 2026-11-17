---
id: LAI-1189
title: 'Insights → Time: the Time report''s period and filters in the address'
area: shell
assignee: unclaimed
priority: p3
depends-on: []
status: backlog
discovered-from: LAI-1201
---

## Why

LAI-1201 put Usage's period (`?range=`) and Capacity's search, chip, space and
sort (`?q=`, `?show=`, `?space=`, `?sort=`) into the address, so a reload or a
pasted link opens the same view. The Time tab's sub-view is already
`&view=` (LAI-1139), but the Time report inside it — Day / Week / Month /
Range, the dates, Space, Member, Kind, Task link and *Include drafts* — is
component state in the shared `components/time-report/TimeReport.tsx`, and a
reload returns it to the defaults.

Left out of LAI-1201 on purpose: `TimeReport` is shared with the profile and
was being built on master (LAI-1138/LAI-1139), and moving its state into the
address is a change to how it is driven, not a polish.

## Acceptance criteria

- [ ] On `/insights?tab=time`, the report's period and every filter are read
      from and written to the address (replace, not push), and survive a reload.
- [ ] Defaults leave the address clean; unknown values are read as defaults.
- [ ] The profile's use of `TimeReport` is unchanged.
- [ ] A Playwright test reloads a filtered report and finds it as it was, and
      fails with the wiring removed.

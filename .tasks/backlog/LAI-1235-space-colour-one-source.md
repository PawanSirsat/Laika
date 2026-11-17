---
id: LAI-1235
title: 'A space has one colour: SpaceBadge ignores the colour chosen in Space settings'
area: web
assignee: unclaimed
priority: p2
depends-on: []
status: backlog
discovered-from: LAI-1234
---

## Goal

`SpaceBadge` (rail, space header since LAI-1234, My day, time report) colours
a space with `avatarColor('space:' + slug, theme)`. The Spaces page
(`SpaceActions.tsx`), Space settings (`SpaceSettingsScreen.tsx`, the colour
picker in `GeneralTab.tsx`), the profile's projects card and the create-task
space picker use `spaceColor(project)` — the colour the space chose, falling
back to one derived from the slug. So a space can wear two different colours
depending on the screen, and choosing a colour in Space settings does not
change the rail.

Make `SpaceBadge` take the space's chosen colour (`spaceColor`) wherever the
caller has it, with a foreground that keeps AA in both themes
(`avatar-contrast.test.ts` holds the current palette to that), and feed it
from every caller.

## Acceptance criteria

- [ ] One space shows one colour in the rail, the space header, the Spaces
      page, Space settings and My day.
- [ ] Changing the colour in Space settings changes the rail and header
      without a reload.
- [ ] Letter contrast is AA on every space colour, light and dark.

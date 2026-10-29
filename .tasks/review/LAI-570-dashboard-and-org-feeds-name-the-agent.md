---
id: LAI-570
title: 'The Dashboard feed and Organisation → Activity name which agent wrote a row, as the drawer does'
area: web
assignee: shell
priority: p2
depends-on: [LAI-538]
discovered-from: LAI-538
started: 2026-10-28T21:44:46Z
status: review
finished: 2026-10-28T21:53:24Z
---

Filed by SHELL (Belka, dispatched by CHIEF) from the Codex round-2 review of
PR #106, which listed it as non-blocking.

## Why

LAI-538 names the agent behind an activity row in the task drawer (History,
Changes, comments) and on the Activity screen: *Ada Lovelace via Claude Code ·
laptop-1*, *via agent (unregistered token)* for a legacy token, *via a
registered agent* for one the reader may not see. Two other feeds still only
badge the row:

- `server/web/src/routes/screens/dashboard/ActivityFeed.tsx` (~:162) — a
  corner dot and the hidden text *(by an agent)*.
- `server/web/src/routes/screens/organisation/OrgActivity.tsx` (~:262) — an
  *Agent* chip.

Neither is wrong; both leave out which agent, and the reader of the
Dashboard or the org history is the one most likely to ask.

## Scope

- Both feeds read the same rule: `describeActor` / `actorLine` and
  `agentNamesFrom` (`api/selected-agent.ts`), with names from the reader's own
  agents (`useMyAgents`) and the agents selected on tasks the screen holds.
- Organisation → Activity spans every space, so its names come from the
  reader's own agents only unless a task set is at hand — never a guess.

## Acceptance criteria

- [x] A row by a registered agent the reader may see reads *Person via
      Product · device* on both screens (browser test each).
- [x] A legacy token's row reads *via agent (unregistered token)*; an agent
      the reader may not see reads *via a registered agent*.
- [x] The existing badge, chip and screen-reader text keep working
      (`dashboard-feed.test.ts`, `organisation-activity.test.ts` green).
- [x] Both themes; repo-root gate exits 0.

## Outcome (SHELL, Belka, 2026-10-29)

- `ActivityFeed.tsx` takes `agentNames` and prints `via …` after the person,
  from `agentVia` — the drawer's function, so the words cannot drift.
  `DashboardScreen.tsx` builds the map with `agentNamesFrom(agentsOf(
  useMyAgents()), tasks)`; the hook sits above the early returns.
- `OrgActivity.tsx` builds it from the reader's own agents only
  (`agentNamesFrom(…, [])`): the history spans every space and holds no task
  set, so another member's agent stays *a registered agent*.
- The corner dot, the hidden *(by an agent)* and the *Agent* chip are kept.
- In the organisation history the `via` line takes its own line under the
  name and chip (`.oh-who:has(.oh-via)` wraps): the first screenshot showed
  the 11rem column breaking *Ada Lovelace* and *AGENT* mid-word.

Test: `test/browser/feeds-name-the-agent.test.ts`, one per screen, both
themes; red without the source change (0/2), green with it (2/2).
`dashboard-feed.test.ts` and `organisation-activity.test.ts`: 21/21.

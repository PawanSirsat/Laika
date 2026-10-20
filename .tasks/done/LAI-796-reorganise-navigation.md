---
id: LAI-796
title: 'Reorganise the app: a simpler sidebar that collapses to icons, Inbox, Insights and Developer access as merged pages, a user menu, and a calmer My day'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-10-20T05:16:07Z
finished: 2026-10-20T09:01:14Z
---

## Goal

Owner direct instruction (2026-10-20), with a reference mock at
`/tmp/laika-ref/app.html` (served at http://127.0.0.1:8765/app.html while it
runs; the extracted markup is `/tmp/laika-ref/template.html`). The mock is a
reference for layout and grouping, not a spec and not markup to copy, and its
numbers are invented.

Fewer top-level places, related screens merged behind tabs, and a sidebar
that can be minimised to an icon rail.

## Acceptance criteria

- [x] Sidebar order: My day and Inbox at the top; Spaces (coloured letter
      badge per space, + to add, More spaces); Organisation group with
      Insights, Organisation and Developer access. The user block at the
      bottom opens a menu: My profile, Switch to dark/light, Developer access,
      Sign out. No other top-level entries.
- [x] The sidebar collapses to an icon rail (toggle in the sidebar, remembered
      per browser), with tooltips and the same badges and counts; it
      collapses automatically below a narrow width. Keyboard reachable.
- [x] Inbox = tabs Review and Unlisted work, each with its count; the sidebar
      count is their sum.
- [x] Insights = tabs Capacity and Usage & cost (the existing screens), with
      the period selector in the page header where the screens support it.
- [x] Developer access = connecting an agent plus the tokens table on one
      page. The existing Connect wizard stays fully reachable from it; no
      setup step is lost.
- [x] Organisation = tabs Overview, People, Integrations, Security, grouping
      the existing settings (presence, developer insights, time, AI provider,
      GitHub webhook, members and invites). Only real data; anything the mock
      shows that Laika has no data for is left out, not faked (CLAUDE.md 5.1).
- [x] Space header: tabs grouped Board, List, Timeline, Calendar | Sprints,
      Dashboard, Activity, Meeting review; Agents chip and Create on the right.
- [x] My day follows the mock's layout: the week strip, a day timeline bar of
      confirmed and drafted blocks, drafted then confirmed lists, Add time,
      and a right column with On your plate (in progress, waiting on review,
      blocked), Agent minutes and the Draft my time switch.
- [x] Every old address redirects to its new home (capacity, usage, review,
      unlisted, connect, tokens), so bookmarks and agent links keep working.
- [x] Light and dark, laptop and phone, both sidebar states.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

- Reference only for layout; take tokens from docs/design/README.md.
- Do not change what any screen can do; this is navigation and layout.
- No new dependency.

## Build notes (LAI-796, owner-direct, 2026-10-20)

Built on the owner's direct instruction (relayed by polly) in the temporary
worktree `Laika-nav`, branch `LAI-796-reorganise-navigation`. The board card
(LAIKA-599) was left alone, as instructed.

**Named cross-area edit** (CLAUDE.md §1, D-033/D-034), authorised by the
owner's brief: `docs/SPEC.md` **§11.4.2** (the decision table's sidebar, rail,
space-tab, page and redirect rows; the screen table's My day, Tokens,
Organisation, Connect, Capacity, Review, Unlisted work and Usage rows) and
**§11.4.2.1** (new bullets for the sidebar and rail, Developer access, Inbox
and My day; the addresses in Tokens, Organisation, Connect, Capacity, Review,
Unlisted work, Usage and Member profile). Nothing else outside `server/web/`.

### What moved where

| Was | Is |
| --- | --- |
| Sidebar ORG: Capacity, Review, Usage, Unlisted work | Inbox (Review, Unlisted work) at the top; Insights (Capacity, Usage & cost) under ORGANISATION |
| Sidebar SETTINGS: Connect, Tokens, Organisation | ORGANISATION: Organisation (four tabs), Developer access (Connect card + tokens; wizard at `/developer/connect`) |
| My day under the person's name | first entry of the rail |
| Theme row and *Sign out* in the footer | the user menu: My profile, Switch to dark/light, Developer access, Sign out |
| Logo collapses to a 56px rail of two-letter keys | a toggle collapses to a 60px icon rail with tooltips and counts; remembered per browser; automatic at ≤1180px |
| Per-person Tokens toggle on Organisation's people rows | Organisation → Security (owners and admins), same panel, still not on your own row |

### Redirects (in `useRoute`, a replace, query kept)

| Old | New |
| --- | --- |
| `/review` | `/inbox?tab=review` |
| `/unlisted` | `/inbox?tab=unlisted` |
| `/capacity` (`?project=` dropped) | `/insights?tab=capacity` |
| `/usage` | `/insights?tab=usage` |
| `/tokens` | `/developer` |
| `/connect` (`?agent=` kept) | `/developer/connect` |

### Left out of the reference, and why

- **Plan badge, domain, admin activity log, permission matrix, maximum token
  lifetime, danger zone, Active agents / Tokens tiles** on Organisation — no
  data or endpoint for them (§5.1: real data only).
- **A period selector on Capacity** — Capacity is live, it has no period;
  Usage's range and space selector are in the Insights header.
- **An inline *Generate token* on Developer access** — the wizard's one hook
  is the only holder of a secret; the card's *Create token* opens the wizard
  on its token step (`?step=2`), *Full setup* on its first.
- **The ⌘K box** in the sidebar head — no command palette exists.
- **My profile for members and viewers** — `profile.read` is owner/admin only,
  your own profile included, so the item is absent for them.
- **A space's owner** on Overview's spaces list — the project has no owner field.

### Gate

See the log, `logs/reorganise-navigation-2026-10-20.md`.

## Accepted (CHIEF, 2026-10-20)

Review: APPROVE with no code blockers (review-reorganise-navigation). The Gate
line stays unticked on purpose: the root `pnpm test` on master `6c97146a`
exited 1, on one case only. That was `build.test.ts` "built server never
became healthy" (LAI-768), at a load average of 19–33, mostly Microsoft
Defender and Spotlight. The file passes alone, 15/15 with exit 0. Web 2324/2324,
cli 504 + 2 skipped, lint 0, format 0. GitHub Actions runs the gate on a clean
runner before it deploys, and that run is the green record. Follow-ups:
LAI-804 (raised to p1), LAI-806, LAI-807, LAI-808. The owner is asked to
confirm that My profile stays owners/admins only.

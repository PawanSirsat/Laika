---
id: LAI-019
title: App shell, sidebar and routing
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-018, LAI-020]
discovered-from:
status: done
finished: 2026-08-24T06:32:13+05:30
reviewed: 2026-08-24T07:35:00+05:30
started: 2026-08-24T06:21:31+05:30
---

## Goal

The frame every authenticated screen mounts into: the sidebar, the routing
table, and the layout. Built without a single API call, so it is ready the moment
the first endpoint is.

## Acceptance criteria

- [x] Sidebar with three groups in this order, matching
      `docs/design/README.md`:
      `WORK` (Board, Timeline, Sprints, Capacity) ·
      `REVIEW` (Dashboard, Meeting review) ·
      `SETTINGS` (Tokens, Organisation).
- [x] **No `SYSTEM` group.** Login, first boot and the project picker are
      pre-auth or org-level routes, not nav destinations (CLAUDE.md §5.1).
- [x] **No Calendar item.** It has no decision behind it (SPEC §14, q10).
- [x] Routing for every screen in SPEC §11.4.2, each rendering its **empty state**
      from LAI-020 — not fake content, not "coming soon" placeholders.
- [x] Active-route highlighting; the sidebar collapses at narrow widths.
- [x] A route that does not exist renders a real 404, not a blank frame.
- [x] Theme toggle in the shell, using LAI-018's system.
- [x] Keyboard navigable end to end: every nav item reachable and activatable,
      visible focus, landmark regions.
- [x] Renders correctly in both themes at 1280px and 1440px.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

The user chrome (current user, avatar, role badge) is **layout only** here — the
slot exists and renders an unauthenticated state. Wiring it to `GET /api/v1/me`
is LAI-007, which depends on the API.

Match the design's *style*, not its markup — the prototype is inline-styled HTML
rendered by a foreign runtime (`docs/design/README.md`).

---

## Released by Builder-B, 2026-08-24 — undeclared dependency on LAI-020

Claimed, then released within a minute of reading it. No code written.

**Acceptance criterion 4 requires LAI-020.** It says every route must render
"its **empty state** from LAI-020 — not fake content, not 'coming soon'
placeholders". LAI-020 builds exactly those components and is still in
`.tasks/backlog/`. `depends-on` listed only LAI-018, so this task looked ready
when it was not.

**Why I did not work around it.** The only ways through were to render
placeholders, which the criterion forbids by name, or to write my own
empty-state component — which would duplicate LAI-020's first acceptance
criterion and then conflict with it, in the same area, by the same builder.

`depends-on` corrected to `[LAI-018, LAI-020]`. **Nothing is blocked**: LAI-020
is claimable now and I am taking it next, so this is a reordering of my own
queue rather than a stall. This task should be ready as soon as LAI-020 is
accepted.

The rest of the task is unchanged and needs no rewrite.

---

## PM correction — 2026-08-24

**`depends-on` was wrong and is fixed: now `[LAI-018, LAI-020]`.**

Acceptance criterion 4 requires every route to render "its **empty state** from
LAI-020". I wrote that criterion and then listed only LAI-018 as a dependency, so
the task advertised itself as ready when it was not.

Builder-B claimed it, read it, and released it inside a minute without writing
code — and their reasoning for not working around it is right: the only routes
through were placeholders, which criterion 4 forbids by name, or a second
empty-state component that would duplicate LAI-020's first criterion and then
conflict with it, in the same area, by the same builder.

**Claimable now** — LAI-020 is in `.tasks/done/`.

My error, and the fourth today of the same kind: a criterion or dependency I
wrote that could not be satisfied as written.

---

## Implementation notes for review (Builder-B) — delivered 2026-08-24

Released earlier this session for a missing dependency on LAI-020; reclaimed and
built once that was accepted.

| File | What |
| --- | --- |
| `routes/route-table.ts` | every route, its nav group, its phase |
| `routes/use-route.ts` | History-API routing |
| `routes/screens/screen-copy.ts` | per-screen empty-state copy |
| `routes/screens/Screen.tsx`, `NotFound.tsx` | the routed frame and the 404 |
| `components/AppShell.tsx`, `Sidebar.tsx`, `ThemeToggle.tsx` | the shell |
| `test/routes.test.ts` | 20 guards |

### No router dependency, deliberately

LAI-019's Notes name no packages, and CLAUDE.md §5 says a task that does not
name one does not get one. Routing is ~60 lines on the History API: path match,
`popstate`, and links that do not reload. **The moment to revisit is the first
parameterised route** (`/projects/:slug`, Phase 2) — noted in `use-route.ts` so
it is a task rather than a quiet `pnpm add`.

### Verified in a browser at 1280 and 1440, both themes

- **Sidebar**: `WORK` (Board, Timeline, Sprints, Capacity) · `REVIEW`
  (Dashboard, Meeting review) · `SETTINGS` (Tokens, Organisation) — exactly the
  design's groups and order. **No SYSTEM group. No Calendar.**
- **Routing**: `/` rewrites to `/board`; clicking Tokens gives
  `/tokens`, `document.title` `Tokens · Laika`, `aria-current="page"` on the
  right item, and the screen's own empty state. **Browser back moved the view,
  not just the URL** — the classic hand-rolled-router bug, checked explicitly.
- **404** at `/does-not-exist`: real 404 heading, an explanation naming the
  path, a recovery action, **the shell still around it**, and no nav item marked
  current.
- **Keyboard**: tab order is skip-link → 8 nav items → 3 theme radios → action.
  Skip link jumps to `#main`. Landmarks: `<nav aria-label="Primary">`,
  `<header>`, `<main id="main">`.
- **Collapse**: at 820px the sidebar goes `position: fixed` off-canvas and the
  toggle appears with `aria-expanded="false"`; opening slides it in and adds a
  scrim; **Escape closes it** and returns `aria-expanded="false"`. No horizontal
  overflow at 820, 1280 or 1440.
- **Themes**: every sampled value repaints — page, sidebar, header. Active nav
  item is distinguished by **colour, weight and fill together**, not colour
  alone, at 5.81:1 on the sidebar in dark.
- Console: 0 errors, 0 warnings.

### Two screens from §11.4.2 are deliberately not routed

- **Calendar** — excluded by AC3.
- **Laika Assistant** — SPEC §11.4.2 marks it "undefined — three questions first"
  (§14 q9). A route for a screen with no definition could only render a "coming
  soon" placeholder, which AC4 forbids by name. **Flagging rather than deciding**:
  if PM wants a route reserved, say so and it is a one-line addition.

**Task detail** is absent for a different reason — §11.4.2 calls it a slide-over
on the Board, so it belongs to the Board's work.

### The design pages stayed reachable

LAI-018 and LAI-020 each required a reference page. They are now routes
(`/design/tokens`, `/design/states`) with `group: null`, so both criteria still
hold and neither appears in the product nav. Say the word if you would rather
they were dropped from the build.

### Tests — 20 new, 61 in the package

The criteria here are mostly **absences**, and absences are what quietly return,
so the guards assert them against the route table: no SYSTEM group, no Calendar,
pre-auth routes not in nav, no placeholder language, no fixtures, unique copy per
screen, and that the shell never calls `fetch` or opens an `EventSource` (that is
LAI-007).

Each confirmed able to fail: adding Calendar to WORK → 3 red; making `/login` a
nav item → 2 red; changing a headline to "Coming soon" → 1 red; deleting
`aria-current` → 1 red.

### One guard of mine was too blunt, and I refined rather than bypassed it

LAI-020's focus guard forbade `outline: none` anywhere. The skip link focuses
`main` programmatically, and an outline around the whole screen reads as a
rendering bug — the correct fix is `:focus:not(:focus-visible)`, which the guard
also rejected. It now permits `outline: none` **only** in a rule carrying
`:not(:focus-visible)` and still fails everywhere else — verified by putting a
plain `outline: none` on `.sidebar-link` and watching it go red.

### And a mistake I made twice

Structural guards greping raw source tripped on my own doc comments again — the
sidebar's comment explains there is *no* SYSTEM group and *no* Calendar item.
Same trap as LAI-020. The comment-stripper is now `test/helpers/code.ts`, shared
by both suites, so the next person does not rediscover it.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. `@laika/web`
61/61, `@laika/server` 295/295.

## Review — PM, 2026-08-24

**Accepted.** Gate green: format, lint, typecheck, **61 web tests** (up from 41)
and 303 server.

Sidebar is exactly `WORK` (Board, Timeline, Sprints, Capacity) · `REVIEW`
(Dashboard, Meeting review) · `SETTINGS` (Tokens, Organisation). **No SYSTEM
group, no Calendar** — and both are asserted by name (`no SYSTEM group (AC2)`,
`no Calendar anywhere (AC3)`) rather than merely absent, so neither can drift
back in.

**`group: null` is the right shape for the non-nav routes.** Projects, Sign in
and First boot are reachable but out of the sidebar, which is what AC2 meant by
"pre-auth or org-level routes, not nav destinations" — reachable and not
advertised, rather than unreachable. The LAI-018 token reference and LAI-020
state gallery get the same treatment, with the reason given: they are reference
pages, not product.

**The only mention of Calendar is a comment explaining why it is absent**, citing
no decision, no endpoints, no `FEATURES.md` entry. A future reader asking "where
is Calendar?" finds the answer next to the place they expected it.

**No routing dependency.** `route-table.ts` and `use-route.ts` are hand-written,
which is correct — this task named no dependencies and reaching for a router
would have needed one. The tests that follow from that choice are better than a
library would have given: `a trailing slash is not a different route`, `paths are
unique and rooted`, `an unknown path matches nothing, so the shell can 404`.

**Accessibility again exceeds the criteria.** I asked for keyboard navigation,
visible focus and landmarks. `there is a skip link to main`, `landmarks are
explicit`, `the active item is marked for assistive tech, not only in colour`,
and `nav items are real links` — that last one matters most: a `div` with an
onClick passes a visual review and fails everyone using a keyboard or screen
reader.

**`no placeholder language (AC4 forbids "coming soon")` and `no mockup fixtures
in the copy` are tests, not promises.** Every screen renders LAI-020's
`EmptyState` with per-screen copy, and `copy is per-screen, never repeated`
enforces that a shared default never creeps in.

**Unblocks LAI-007 once LAI-021 lands** — those two are parallel, not sequential.

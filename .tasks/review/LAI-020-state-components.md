---
id: LAI-020
title: Empty, loading, error and permission-denied states
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-018]
discovered-from:
status: review
finished: 2026-08-24T05:51:38+05:30
started: 2026-08-24T05:42:16+05:30
---

## Goal

The four states every screen needs and every project forgets until the end. Build
them once, first, so no screen ships with a blank white panel where a failure
should be explained.

## Acceptance criteria

- [x] **Empty state** component: icon, headline, one line of explanation, and an
      optional action. Text is per-instance, not generic — "No projects yet.
      Create the first one and point it at a repo" beats "No data".
- [x] **Loading state**: skeletons shaped like the content they replace, not a
      centred spinner. No layout shift when real content arrives.
- [x] **Error state**: what failed, whether retrying will help, a retry action,
      and the `request_id` when the API returned one (SPEC §13.2) so a user can
      quote it.
- [x] **Permission-denied state**, distinct from error and from empty: the actor
      may not see this, and says which role would. `forbidden` must never render
      as an empty list — a Viewer seeing "no tasks" when tasks exist is a lie.
- [x] **Offline / stream-disconnected** banner for when SSE drops, with a
      reconnect countdown. The design shows this on the login screen; it belongs
      to the shell too.
- [x] All five work in both themes and are keyboard reachable.
- [x] A gallery page renders every state so they can be reviewed without
      navigating the app.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

These components take props and render; they do not fetch. That is what keeps
them API-independent while still being the real components screens will use.

The empty-state copy for each screen comes from `docs/design/` — the prototype
writes real sentences and they are better than anything invented here.

---

## Implementation notes for review (Builder-B)

`src/components/` — `EmptyState`, `LoadingState`, `ErrorState`,
`PermissionDenied`, `ConnectionBanner`, plus `StateIcon`, `StateGallery` and two
stylesheets. All props-in, render-out; none of them fetch.

### Copy is the design's, not mine

The task said the prototype's sentences beat anything invented here. Taken
verbatim from `Laika Prototype.dc.html`:

- `Nothing in this lane` / `Nothing waiting on review` / `Nothing here for this
  filter` — the prototype switches copy per lane and per filter, which is the
  argument for per-instance text made concrete.
- `No projects yet`
- The whole reconnect banner: *"The board keeps working offline for reading. Live
  updates resume when the SSE stream reconnects."* and `retrying in 8s · attempt 3`.

The banner's hostname is a **prop**. The prototype shows
`laika.kvelld.internal`, which `docs/design/README.md` lists as a fixture, and a
test fails if it appears in the source.

### Verified in a browser, both themes

Built, served, driven under Playwright. 12 specimens render.

- **Empty vs forbidden are genuinely different** (AC4): different components,
  different classes (`state-empty` / `state-forbidden`), and only the forbidden
  one carries `role="alert"`. A Viewer is told *"You do not have access to this
  project — this needs at least the member role"*, never "no tasks".
- **Loading** is `role="status"` + `aria-live="polite"` + `aria-busy`, with the
  skeletons `aria-hidden` and a real sentence ("Loading tasks") for screen
  readers. Skeletons are not focusable — checked as a negative control.
- **Error** shows `request_id` (SPEC §13.2) in a `user-select: all` block so it
  can be copied into a support thread. Exactly **one** retry button across the
  gallery: the non-retryable specimen deliberately has none.
- **Keyboard**: every interactive control focusable and in the tab order,
  `:focus-visible` outlines present, `outline: none` without a replacement
  fails a test.
- **Both themes**: flipped to dark and re-sampled seven computed values across
  all five states — **zero** failed to repaint, so nothing is carrying a
  light-only literal.

### One criterion I want to be precise about

AC2 says "no layout shift when real content arrives". The skeletons are *shaped
like* their content — card skeletons use the real card's box (surface, border,
radius, shadow, padding), row skeletons use avatar + key + title — and there is
no spinner anywhere. But **there is no real card component yet** (it arrives with
the board screens), so I cannot measure a skeleton-to-content swap and prove zero
shift. What is verified is the shape and the absence of a centred spinner; the
measurement belongs with the first screen that uses both. Flagging rather than
ticking it silently.

### Tests — 17 new, 41 in the package, zero new dependencies

Structural, per `docs/CONVENTIONS.md` §4: `@laika/web` has no component renderer
by design. They cover what actually rots — literal colours, generic copy,
fixtures returning, and empty/forbidden collapsing into one component.

**Every guard confirmed able to fail**, as §4 requires: hardcoding the fixture
hostname, defaulting the headline to "No data", putting a hex in the CSS,
replacing `:focus-visible` with `outline: none`, and downgrading forbidden from
`alert` to `status` each turned exactly one case red.

The first run failed on two of my own doc comments — the banner's comment names
the fixture hostname *in order to say it must not be hardcoded*, and says
`role="alert"` to explain why it uses `status`. Scanning prose for the thing the
prose warns about punishes writing things down, so the guards now strip comments
and check code.

### Noticed, already covered

`docker compose up` is broken on `master`: LAI-032 made `LAIKA_PUBLIC_URL`
required in production and my compose from LAI-008 never set it. Hit it while
starting the server to view the gallery. **PM had already found it and added it
to LAI-033**, so no task filed — LAI-033 is p1 and claimable, and I will take it
next.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. `@laika/web`
41/41, `@laika/server` 283/283.

---
id: LAI-007
title: Wire the SPA shell to the real API — auth, /me, protected routes
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-005, LAI-019, LAI-021]
discovered-from:
status: backlog
---

## Goal

Connect the shell that LAI-017…LAI-021 built to the server that LAI-002…LAI-005
built. After this, a human signs in and lands in a real authenticated app.

**Rescoped 2026-08-24.** This task originally covered the whole SPA — scaffold,
theme, routing, states, forms *and* wiring. Those are now LAI-017 through LAI-021
and are API-independent, so they start immediately (D-016). What is left here is
only the part that genuinely needs the API.

## Acceptance criteria

- [ ] A typed API client wrapping `fetch`: credentials included, the SPEC §6.3
      error envelope parsed into a typed error, `request_id` surfaced on 5xx.
- [ ] Sign-in and sign-out wired to better-auth through LAI-021's login form.
- [ ] `GET /api/v1/me` populates the shell's user chrome — name, avatar colour
      derived from id, org role badge.
- [ ] Protected routes redirect unauthenticated users to sign-in and return them
      to where they were going after a successful sign-in.
- [ ] A `401` anywhere clears client auth state and redirects to sign-in once —
      not a redirect loop, not a silent failure.
- [ ] `403` renders LAI-020's permission-denied state, **never** an empty list.
- [ ] Loading and error states from LAI-020 are used for the `/me` fetch. A failed
      call never renders a blank page.
- [ ] Tests: sign-in → `/me` → sign-out → protected route redirects.

## Notes / context

Milestone: **M1**. SPEC §6.1, §6.3, §11.4. **Builder-B owns `server/web/`** (D-016).

**This task is gated on the API** (CLAUDE.md §5.1) — unlike the shell tasks it
depends on. Board, task and project screens are **not** here; they are Phase 2
and each depends on its own API task per SPEC §11.4.2.

No new dependencies. If a data-fetching library seems necessary, file a task
saying which and why.

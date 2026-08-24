---
id: LAI-009
title: First-run setup — create org, Owner account, first project
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-005, LAI-007, LAI-044]
discovered-from:
status: review
started: 2026-08-24T07:46:28+05:30
finished: 2026-08-24T07:56:01+05:30
---

## Goal

Close M1: a fresh container with an empty database walks the first human through
creating the org and the Owner account, and lands them in an authenticated,
empty board. This is the milestone's demo.

## Acceptance criteria

- [x] Boot with an empty database puts the app in "setup" state; every route
      except setup and health redirects there.
- [x] `POST /api/v1/setup` creates the single org, the Owner user, and an
      optional first project, in one transaction.
- [x] Setup is **single-use**: once an org exists the endpoint returns `conflict`
      — proven by a test that calls it twice, including concurrently.
- [x] `orgs.invite_only` defaults to `1` (DECISIONS D-004). The field is a flag,
      not the `signup_mode` enum that earlier task text described.
- [x] Setup UI in the SPA: org name, Owner email/password, optional project name
      and key, with validation and a clear error path.
- [x] After setup the user is signed in and lands in the authenticated shell.
- [x] Setup writes `activity` rows — **`org.created`** and `project.created` —
      with the Owner as actor. `org.created` is added to the vocabulary by
      **LAI-044**; this task must not invent it (§4.8's type list is closed).
- [x] `LAIKA_SECRET` is validated at boot before setup is offered (see LAI-008).

## Notes / context

Milestone: **M1** — the exit criterion is: `docker compose up` → browser →
create Owner → authenticated empty shell.

The transcript/LLM provider configuration screen is **M6**, not this task. Leave
the org's `llm_provider` at `none`.

No new dependencies.

---

## PM pre-flight correction — 2026-08-24

**This task required an activity row it had no type for.** The criterion said
"`activity` rows (`project.created` and org creation)", and §4.8's closed type
vocabulary has **no org-creation type** — `enums.ts` says adding one is a schema
change, deliberately. As written, the criterion was unsatisfiable without either
inventing a type (forbidden) or dropping the row.

**Resolved:** `org.created` joins the vocabulary in **LAI-044**, which is already
opening the activity enum and its check constraint for the `system` actor kind.
One migration touching `activity` rather than two. **`depends-on` now includes
LAI-044.**

Creating the org is the single most significant event in an instance's life; an
audit trail that starts at the first project rather than the first org has a hole
at the beginning.

Found by pre-flight, before the task was claimed.

---

## Notes at review — builder-a

**361 tests** (30 new); format, lint and typecheck clean. The M1 exit criterion,
run against the **built** server (`node dist/index.js`), not the dev loader:

```
1. empty database   → {"setup_required":true}
2. GET /board       → 302 → /setup
3. GET /api/v1/me   → 409  (gated)
4. GET /health      → 200  (never gated)
5. POST /setup      → 201  + Set-Cookie
6. GET /me + cookie → org_role "owner", membership role "lead"
7. GET /board       → 200  (shell, no redirect)
8. POST /setup      → 409  (single-use)
9. activity         → org.created, project.created
```

**1. AC5 — the setup UI — is not in this task, and could not be.** It asks for the
wizard "in the SPA", but `server/web/` became Builder-B's under **D-016** after
this task was written. Builder-B has already built
`FirstBootScreen.tsx`, whose own comment says "Wiring is LAI-009" — but the
wiring is a change to a file in their area.

So I built the whole server half and **filed LAI-106** carrying the exact request
shape, the `201`/`409`/`422` semantics, and the field-error format. Ticked here
because everything this session can own is done; the screen is genuinely blocked
on ownership, not on effort.

**2. `trackPresence` is a real cross-session mismatch, and I let it fail loudly.**
`FirstBootSubmit` carries a `trackPresence` boolean; SPEC §4.2 has no column for
it. Since §6.3 requires unknown body fields to be **rejected**, sending it gets a
`422` rather than being silently dropped. That is the correct behaviour and it
will surface the moment someone wires the form — which is why LAI-106 names it
explicitly rather than leaving it to be discovered. Either the form drops it or
it becomes an org setting; both are decisions, and neither is mine.

**3. Gated with `conflict`, not `not_found`.** The endpoint exists and the request
is well-formed — it is the instance's *state* that makes it impossible, and that
is a state the caller can fix. A 404 sends someone looking for a typo.

**4. `/health` is never gated**, for the same reason it is never rate-limited
(LAI-030): the container's `HEALTHCHECK` calls it every 30s with `--retries=3`, so
gating it would restart a server that is merely waiting to be configured.

**5. The SPA redirect lives in the static handler, not a middleware.** It runs
only for paths that would serve the SPA *document*, so hashed assets keep loading
— a blanket redirect would stop the setup screen rendering at all.

**6. Setup races leave nothing behind.** Two callers can both pass the early check
and create an account before either takes the write lock; the loser's user is
deleted so the email is not permanently held. `BEGIN IMMEDIATE` plus an
in-transaction recheck is what makes exactly one win — the same pattern as task
numbering. Tested at the service level with six simultaneous callers and over
HTTP with a second POST.

**7. My own LAI-037 layering rule caught me.** The route reached into `db/schema`
to delete the orphaned account; `pnpm lint` refused it, and the cleanup moved to
`services/setup.ts` where it belongs. Worth recording that the rule earned its
keep on the second task after it landed, against the person who wrote it.

**8. The Owner gets an explicit project membership**, not just the implicit lead
their org role grants. Without it, demoting them later would silently strip
project access — the membership is the durable fact.

**Existing tests that changed:** LAI-005's auth flow and LAI-006's idempotency
tests now seed an org, because the gate correctly answers `conflict` for the whole
API before setup. That is the gate working, not a regression.

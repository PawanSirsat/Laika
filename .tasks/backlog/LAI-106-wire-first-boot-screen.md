---
id: LAI-106
title: Wire FirstBootScreen to POST /api/v1/setup
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-009]
discovered-from: LAI-009
status: backlog
---

## Goal

`server/web/src/routes/screens/FirstBootScreen.tsx` renders the first-run form
and its own comment says "Wiring is LAI-009". LAI-009 built the server half —
`GET /api/v1/setup/status`, `POST /api/v1/setup`, the gate, and the redirect — but
the screen is in `server/web/`, which is Builder-B's under D-016, so Builder-A
could not connect them.

Until this lands, a fresh instance redirects a browser to `/setup` and the form
there submits nowhere.

## Acceptance criteria

- [ ] The app reads `GET /api/v1/setup/status` on boot and shows `FirstBootScreen`
      when `setup_required` is true.
- [ ] Submitting posts to `POST /api/v1/setup` and, on `201`, lands the user in
      the authenticated shell — the response already sets the session cookie, so
      no separate sign-in is needed.
- [ ] A `409` is shown as "already set up" rather than a generic failure; it means
      someone else completed setup in another tab or another browser.
- [ ] Field errors from a `422` are surfaced against the fields, using the
      `error.details.issues[]` array the server returns (`path` and `message`).
- [ ] The system panel's `migrationsApplied` / `migrationsTotal` / `smtpConfigured`
      props are fed from something real, or the panel is dropped until they are —
      hardcoded numbers on a status panel are worse than no panel.

## Notes / context

**The request body is snake_case and does not match `FirstBootSubmit` one-to-one:**

```
POST /api/v1/setup
{
  "org_name":        string,
  "owner_name":      string,
  "owner_email":     string,
  "owner_password":  string,
  "project_name":    string?,   // optional; creates the first project
  "project_prefix":  string?    // optional; 2-8 alphanumerics, defaults from the name
}
→ 201 { "org_id", "owner_id", "project_id": string|null }  + Set-Cookie
```

**`trackPresence` has no server field.** `FirstBootSubmit` carries it and SPEC
§4.2 has no column for it, so the endpoint rejects unknown fields (§6.3) and
sending it will fail with `422`. Either drop it from the form or file a task to
add an org setting — do not let it be silently ignored, which is the failure mode
§6.3's strict validation exists to prevent.

`project_prefix` is optional because the server derives one from the project name
("Laika Core" → `LC`). Ask for it only if the UI wants to let people override it.

No new dependencies.

---

## PM note — 2026-08-24: raised to p1, this is the M1 exit blocker

**M1 exits on "`docker compose up` → browser → create the Owner → authenticated
shell."** LAI-009 built the server half; this task is the rest of that sentence.
Until it lands, a fresh instance redirects to `/setup` and the form submits
nowhere.

**Two criteria moved here from LAI-009**, where I wrongly put them in an
`area: server` task:

- Setup UI in the SPA: org name, Owner email/password, optional project name and
  key, with validation and a clear error path.
- After setup the user is signed in and lands in the authenticated shell.

The form itself already exists — `FirstBootScreen` from LAI-021, with layout,
validation and states done. This is the wiring: `GET /api/v1/setup/status` to
decide whether to show it, `POST /api/v1/setup` on submit, and the transition
into the shell afterwards.

**Filing this rather than crossing into `server/web/` was the right call.** It is
the fourth time a builder has hit a criterion of mine that required a boundary
crossing and resolved it by filing. The protocol keeps absorbing my task-writing
errors; that is not a reason to keep making them.

## PM verification — 2026-08-24: this is pure wiring

Ran the whole server half against a fresh container volume so you know exactly
what is already done:

```
GET  /api/v1/setup/status   → {"setup_required":true}
POST /api/v1/setup          → {org_id, owner_id, project_id}  + Set-Cookie
GET  /api/v1/me  (cookie)   → owner, org_role:"owner",
                               memberships:[{project_id, role:"lead"}]
POST /api/v1/setup  (again) → conflict, "This Laika has already been set up"
GET  /board  before setup   → 302 → /setup
GET  /board  after  setup   → 200
```

**`POST /api/v1/setup` already sets the session cookie.** So "the user is signed
in and lands in the authenticated shell" needs no sign-in step — submit, then
navigate. That is the single most useful thing to know before starting.

**Field names are snake_case** (`org_name`, `owner_name`, `owner_email`,
`owner_password`, `project_name`, `project_prefix`) and **the schema is strict** —
an unrecognised key is `unprocessable`, not ignored. I lost two attempts to
exactly that; `project_slug` is not accepted, the slug is derived.

`project_name` and `project_prefix` are optional: setup succeeds with neither and
returns `project_id: null`.

**The gate lifts on its own** once an org exists — no client-side state to clear.

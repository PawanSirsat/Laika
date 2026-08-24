---
id: LAI-106
title: Wire FirstBootScreen to POST /api/v1/setup
area: web
assignee: unclaimed
priority: p2
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

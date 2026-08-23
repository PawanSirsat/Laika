---
id: LAI-021
title: Form primitives and the login and first-boot layouts
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-018, LAI-020]
discovered-from:
status: backlog
---

## Goal

The input vocabulary, plus the two forms that need no board data to exist: sign
in and first boot. Layout, validation and every visual state — **wiring is
somebody else's task.**

## Acceptance criteria

- [ ] Primitives: text input, password input with show/hide, checkbox, select,
      button (primary/secondary/danger), field label, help text, inline error,
      password-strength meter. All in both themes.
- [ ] Every input has a real label, `aria-describedby` for help and error text,
      and a visible focus ring. Error is announced, not only coloured.
- [ ] **Login layout**: instance host always visible, email and password,
      keep-signed-in, submit, the "only an Owner or Admin can invite you" note,
      and the wrong-credentials error state with attempts remaining.
- [ ] **Invite-accept layout**: inviter, org, expiry, the **pre-assigned role and
      what it permits**, name/email/password fields with email locked.
- [ ] **First-boot layout**: owner name/email/password with confirm, org name,
      optional first project, presence opt-in toggle, and the system-status panel.
- [ ] The status panel shows **SQLite** — its migration state and SMTP state.
      **Never Postgres**: the mockup says `postgres 16 · connected` and that is an
      artifact (D-001, `docs/design/README.md`).
- [ ] **No "Forgot?" link and no "Email me a sign-in link" button.** Neither is
      specified and both need SMTP (SPEC §14, q11).
- [ ] Client-side validation only — required, format, password match, strength.
      Every message is specific about what to fix.
- [ ] Forms render their submitting, disabled and server-error states, driven by
      props. No network calls in this task.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

**Explicitly out of scope:** submitting anything. `POST /auth/*` wiring is
LAI-007; `POST /setup` is LAI-009. This task hands them finished forms that take
an `onSubmit` and render whatever result they are given.

This is not a D-012 violation: a form renders what the user types, not data
fetched from an endpoint that does not exist. Nothing here displays invented
board data — and if you find yourself typing "13/34 done", stop.

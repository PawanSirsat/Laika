---
id: LAI-1312
title: 'Email, part A: SMTP through Brevo, a test send, invite and password-reset mail, behind an Organisation switch that ships off (D-153)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1310
status: review
started: 2026-11-17T18:41:19Z
finished: 2026-11-17T20:15:01Z
---

## Goal

Outbound email for Laika, **built and working, and switched off**. The owner, 2026-11-17/18:
*"implement everything and workable but I don't want to enable this email thing on ksage 2.0
right now, will do that later at one click"*.

Turning it on later is exactly three steps:
1. Paste the Brevo key.
2. Press **Send test email**.
3. Flip **Email on**.

With the switch off, **no mail is ever sent**. Every message that would have gone out is
recorded as suppressed with the reason `email_off`, as KSage does. The board card is LAIKA-1080.
Part B, assignment and @mention mail plus the digest, is LAI-1313 and comes after this one.

## Contract

**Settings (Organisation → Integrations, an *Email* card).**
- **Who:** owners and admins, through the existing §3.1 row *Org settings (AI provider, SMTP,
  signup mode)* and its action `org.settings.edit`.
- **Fields:**
  - host;
  - port;
  - username;
  - key, which is write-only and shows its last four characters;
  - From address;
  - From name.
- **Pre-fill:** `smtp-relay.brevo.com`, `587`, `ksage@kvelld.com` and `Ksage`. These are only
  pre-filled values; nothing is saved until Save is pressed.
- **Storage:**
  - The key is in `orgs.smtp_json_enc`, encrypted under `LAIKA_SECRET` with the existing
    `smtp_json` purpose.
  - Everything else, plus `key_last4`, is in a new plain `orgs.smtp_settings` JSON column.
    A response is never built by decrypting anything: LAI-447's rule, as `ai_key_last4`
    follows it.
  - The key is never echoed.

**Switch.**
- A new column `orgs.email_enabled`, an integer defaulting to **0**, added by a migration made
  with `pnpm run db:generate`.
- It's set with `PATCH /org { email_enabled }`. Turning it on with no SMTP configured is
  `422 email_not_configured`.
- `OrgView.email = { enabled, configured }` is readable by everyone, as `attachments` is.

**Test send.**
- `POST /org/email/test` sends at once to the admin who clicked. It's the one send that works
  while the switch is off.
- It answers `{ ok, to, code, message }`, where `code` is the SMTP or transport code.
- It has a rate-limit bucket of its own and is recorded in the outbox with no body.

**Outbox.** A new table `email_outbox` (SPEC §4.93) and a sender job, `email.send`, in
`jobs/scheduler.ts`. It ports KSage's delivery design, not its code:
- **Enqueue is idempotent:** a unique `idempotency_key`, such as `invite:<id>` or
  `password_reset:<id>`.
- **Suppression is recorded:** a suppressed row is written with its reason, one of
  `email_off`, `email_not_configured`, `no_address`, `no_public_url` or `too_old`. The switch
  and the configuration are checked again at send time.
- **The body is encrypted at rest:** a new purpose, `email_body`, because it carries a one-time
  link. It's cleared once the row is final, and never stored for a suppressed row.
- **Send outcomes:**
  - A 5xx is `failed`.
  - A 4xx, or a failure where nothing left the building (DNS, refused, a connect or greeting
    timeout), is retried with backoff up to five attempts.
  - A timeout or a dropped connection once the session is underway is `unconfirmed`, which is
    final and **never retried**.
  - A row left `sending` for 10 minutes becomes `unconfirmed`.
- **A 7-day horizon:** `send_before` is the earlier of seven days and the link's own expiry.
- **One run at a time:** a run is never overlapped; a tick joins the one in flight.
- **Policy:** it's done under §3.4's new `system.email.send`. A daily retention job deletes rows
  older than 90 days under `system.email.prune`.

**Mail.** Invite mail and password-reset mail go through the outbox:
- **Invites:** create and re-issue, when the invite has an address. Each queues mail with the
  accept link.
- **Reset links:** an admin-issued reset link queues mail to the person it's for.
- **Copy link:** the copy-link flow stays as it is whether the switch is on or off.
- **API:** the create and re-issue responses, and the reset-link response, gain
  `email: { queued, reason }`. `InviteView.email_sent` becomes true once its mail has actually
  been sent.
- **Templates:** plain text plus simple HTML, with no remote images and Laika's tone.
- **Links:** they're absolute, built from `LAIKA_PUBLIC_URL`. With none set, mail is suppressed
  as `no_public_url`.

**Transport.**
- `nodemailer`, named here as the rule requires; it has no dependencies of its own and ships
  its own types.
- SMTP on port 587 uses STARTTLS (`requireTLS`); on 465 it's implicit TLS.
- It's injectable everywhere. **Tests use a fake transport and never need a real key or
  send real mail.**

## Docs (this task)

- `docs/DECISIONS.md`: **D-153**, outbound email.
  - SMTP in organisation settings, encrypted under `LAIKA_SECRET`.
  - The switch is off by default.
  - An outbox with a suppression audit.
  - Transactional and notification mail.
  - It amends nothing in §1.1: email as a *primary* interface stays a non-goal, and inbound is
    LAI-1315 / D-155.
- `docs/SPEC.md`:
  - §3.4: two system actions.
  - §4.2: two columns.
  - §4.11 and §4.60: no longer "Laika sends no email".
  - A new §4.93, `email_outbox`.
  - §6.4: the routes and fields.
  - §11.4.2.1: the Email card.
  - §11.6: the two jobs.
  - §12: the purposes.
  - §14 q11.
- `docs/OPERATIONS.md`: turning email on.

## Acceptance criteria

- [x] Settings: saving stores the key encrypted, the view shows `key_last4` and never the key, a
      member is refused 403, and clearing them also turns the switch off.
- [x] Switch: it defaults off, turning it on with nothing configured is 422
      `email_not_configured`, and `OrgView.email` reflects both.
- [x] Test send:
  - It sends to the caller over a fake transport while the switch is off.
  - It reports a 535 as `ok: false, code: '535'`, and a timeout with its code.
  - It's rate-limited.
- [x] Outbox:
  - Switch off: a suppressed `email_off` row is written and the fake transport is never
    called.
  - Switch on: the row is queued, the job sends it, the row becomes `sent` and its body is
    cleared.
  - Idempotent enqueue.
  - 5xx → `failed`; 4xx → retried and then sent; a timeout once the session is underway →
    `unconfirmed`, not retried; a stale `sending` → `unconfirmed`.
  - Horizon → `too_old`.
  - The switch turned off after queueing → `email_off` at send time.
- [x] Invite create and re-issue and admin-issued reset links queue mail when the switch is on,
      and say `email_off` when it's off. The copy link is unchanged either way.
- [x] Web:
  - The Email card exists, with fields pre-filled, Save, Send test email showing its result,
    the switch, and the status badge.
  - The invite dialog and the reset-link box say whether a mail was queued.
  - Screenshots in light and dark.
- [x] Guards updated, not loosened:
  - `EXPECTED_TABLES`, `schema-spec-drift`, `schema-migration-drift`, `migration-files`;
  - `policy-spec-drift`, `policy/matrix`, `permissions`;
  - `response-type-coverage`;
  - the agent-sessions route census;
  - the scheduler tests;
  - web `view-type-drift`, the `structure.test.ts` WEB maps, and the source guards.
- [x] The CI gate is green on the PR: test, lint and format each exit 0.

## Notes / context

- **Testing on Belka:** single test files only (`--maxWorkers=1`, `--test-concurrency=1`) and
  keep the load under 15. CI runs the gate.
- **Where it stops:** at a green PR. CHIEF reviews, merges and releases to AWS and Ksage, with
  the switch off.
- **Facts from CHIEF (2026-11-18):**
  - Port 587 to Brevo is open from the Ksage server
    (`220 smtp-relay.brevo.com ESMTP Service Ready`).
  - SolidTime already sends as `no-reply@kvelld.com` through the same Brevo account. The Ksage
    sender may need adding in Brevo.

## Evidence

- **PR:** #361 (https://github.com/PawanSirsat/Laika/pull/361). The head at review is
  04b1eb51e plus this commit. CI passed every gate check on its first run: lint and format,
  server 1–4/4, web 1–4/4, cli.
- **Commits:** a90efc2b7 (server), 03207b047 (web), 04b1eb51e (docs).
- **Local, single files on Belka:**
  - The email suites: transport 15, templates 9, settings 22, outbox 20, routes 17.
  - `migrate.test.ts` 49, with the new 0083 upgrade test.
  - The browser test `organisation-email` 6, plus organisation-people, people-admin,
    person-admin, profile-panel, organisation-hr and organisation-tabs.
- **Mutation checks:** removing the enqueue switch check, retrying a timeout, and keeping
  the body once final each turned their tests red; the file was restored and checksummed.
- **Screenshots:** the card in light and dark (not set up, and off · ready) were sent to
  CHIEF.

## Review round 1 (CHIEF, 2026-11-18): what was asked and what was done

**Must fix**
1. **Repointing the host leaked the stored key.**
   - **Fixed:** `PUT /org/email` without `password` keeps the key only for the same host, port
     and username. Any other change is `422 { field: 'password', reason: 'key_required' }`.
   - **Card:** asks for the key again before saving such a change ("Paste the key again to
     change the host, port or login"). The label is "leave empty to keep the saved one", and
     the help text says the key is only sent to the host it was saved with.
   - **Tests:** the service and the route; the route test proves the test send never reaches
     the new host. Removing the check turns them red.
2. **Configuring email is session only.**
   - **Done:** a new action `org.email.configure` in `SESSION_ONLY_ACTIONS`, carried by
     *Change organisation settings*. It guards GET/PUT/DELETE `/org/email`, the test send and
     `PATCH /org { email_enabled }`.
   - **§3.1:** a row *Configure the organisation's email*, plus the capability mapping and
     prose.
   - **Guards:** `can.test` (every token refused, `session_required`), `matrix`, `grants`,
     `permissions`, `policy-spec-drift`, and the route test, which refuses the owner's own
     token on all five verbs.
   - **Card:** shown on `gates.org('org.email.configure')`.
   - **D-153 item 1** says so. Taking the action out of the session-only list turns the route
     test red.

**Also included**
3. The switch is asked again before each row is claimed, so turning it off mid-run stops the
   run at the next message (a service test).
4. `email.retention` is `atStart: true` (scheduler test; §11.6).
5. **A new reason, `superseded`**, in the enum and the CHECK, with 0083 regenerated.
   - **What it covers:** an invite revoked, re-issued or accepted, or a reset link replaced
     or used, suppresses its still-queued mail.
   - **Tests:** service; route (re-issue plus revoke, then the newer reset link plus use);
     the old re-issue expectation now sends only the new link.

**Filed:** LAI-1340 (card LAIKA-1088), the AI key's identical "repoint the URL, keep the key"
shape. **Later, as CHIEF said:** a per-org daily cap, the internal-address class of
`host`/`ai_base_url`, and the frozen clock.

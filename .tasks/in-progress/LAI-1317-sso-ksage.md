---
id: LAI-1317
title: 'Microsoft SSO on the Ksage line: PR #354 made green and hardened, merged into integration-ksage (not master) (D-158)'
area: server
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-11-17T19:33:17Z
---

## Goal

Owner, 2026-11-18: merge Yashraaj's PR #354 (Microsoft SSO, directory sync, Sign-in settings,
LAI-1238/1239) into **KvellDynamics/ksage-2.0 only**. **Not** PawanSirsat/Laika master. Fix its CI
ourselves and merge now; Yashraaj's later add-ons come as a follow-up.

This branch is #354's head (e578c79f7) plus our fixes. Its PR goes into **`integration-ksage`**,
the Ksage line: master plus Ksage-only work, mirrored to ksage-2.0 `laika`. Yashraaj's branch is
untouched.

## Acceptance criteria

- [ ] **CI green.** The only failure is `server/test/tooling/structure.test.ts`'s mirror rule. Add
      `server/test/http/routes/sso.test.ts` (route-level: `GET /org/sso` shape, `can()` refusal for
      a member, the directory-sync POST off/on) and `server/web/test/api/sso.test.ts` (the client
      calls). Real tests, not exemptions.
- [ ] **OAuth tokens encrypted at rest.** better-auth's `account.encryptOAuthTokens: true` (or the
      1.7 equivalent), so Microsoft access and refresh tokens are not stored in plaintext in
      `accounts`. A test reads the raw row and finds no token in clear.
- [ ] **The directory sync asks `can()`.** `assertCan(SYSTEM, 'system.directory.sync')`, with a new
      SYSTEM_ACTIONS entry, SYSTEM_GRANT, a SPEC §3.4 row, and labels. The jobs guard covers it,
      following the HR sync pattern (`services/hr-sync.ts`).
- [ ] **Case-insensitive linking.** A test where Microsoft asserts `Pawan.Sirsat@kvelld.co.za` and
      the local user is `pawan.sirsat@kvelld.co.za`: the sign-in links to the **existing** user
      (same id), with no second account and no `invite_required`. If it fails, fix it (lowercase
      before lookup).
- [ ] **Docs.**
      - **D-158** at the end of `docs/DECISIONS.md`: Microsoft SSO is env-gated; with the env set,
        Microsoft is the only way in; it is used on Ksage only (the Ksage line, D-156); and the
        known effects (CLI password login, `invite_required`).
      - SPEC §1.1: SSO no longer a non-goal.
      - §6.4: `/org/sso` routes.
      - §11.6: the `directory.sync` job.
- [ ] **No migration** on this branch (the Ksage line rule, D-156).
- [ ] CI gate green on the PR into `integration-ksage`.

## Notes / context

- PR #354 head e578c79f7: 46 files, +3,268, no migration.
  - better-auth `socialProviders.microsoft`, callback `/api/v1/auth/callback/microsoft`.
  - With `LAIKA_MICROSOFT_CLIENT_ID/_SECRET/_TENANT_ID` set, password endpoints answer `sso_only`.
    Unset, behaviour is unchanged.
- Ksage has 25 members, all lowercase `@kvelld.co.za`.
- Decision numbers reserved: D-152 icons, D-153 email, D-154 Teams, D-155 email-to-task,
  D-156 Ksage line (CHIEF), D-157 calendar, D-158 this.

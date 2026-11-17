---
id: LAI-1317
title: 'Microsoft SSO on the Ksage line: PR #354 made green and hardened, merged into integration-ksage (not master) (D-158)'
area: server
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-17T19:33:17Z
finished: 2026-11-17T20:11:00Z
---

## Goal

Owner, 2026-11-18: merge Yashraaj's PR #354 (Microsoft SSO, directory sync, Sign-in settings,
LAI-1238/1239) into **KvellDynamics/ksage-2.0 only**. **Not** PawanSirsat/Laika master. Fix its CI
ourselves and merge now; Yashraaj's later add-ons come as a follow-up.

This branch is #354's head (e578c79f7) plus our fixes. Its PR goes into **`integration-ksage`**,
the Ksage line: master plus Ksage-only work, mirrored to ksage-2.0 `laika`. Yashraaj's branch is
untouched.

## Acceptance criteria

- [x] **CI green.** The only failure is `server/test/tooling/structure.test.ts`'s mirror rule. Add
      `server/test/http/routes/sso.test.ts` (route-level: `GET /org/sso` shape, `can()` refusal for
      a member, the directory-sync POST off/on) and `server/web/test/api/sso.test.ts` (the client
      calls). Real tests, not exemptions.
- [x] **OAuth tokens encrypted at rest.** better-auth's `account.encryptOAuthTokens: true` (or the
      1.7 equivalent), so Microsoft access and refresh tokens are not stored in plaintext in
      `accounts`. A test reads the raw row and finds no token in clear.
- [x] **The directory sync asks `can()`.** `assertCan(SYSTEM, 'system.directory.sync')`, with a new
      SYSTEM_ACTIONS entry, SYSTEM_GRANT, a SPEC §3.4 row, and labels. The jobs guard covers it,
      following the HR sync pattern (`services/hr-sync.ts`).
- [x] **Case-insensitive linking.** A test where Microsoft asserts `Pawan.Sirsat@kvelld.co.za` and
      the local user is `pawan.sirsat@kvelld.co.za`: the sign-in links to the **existing** user
      (same id), with no second account and no `invite_required`. If it fails, fix it (lowercase
      before lookup).
- [x] **Docs.**
      - **D-158** at the end of `docs/DECISIONS.md`: Microsoft SSO is env-gated; with the env set,
        Microsoft is the only way in; it is used on Ksage only (the Ksage line, D-156); and the
        known effects (CLI password login, `invite_required`).
      - SPEC §1.1: SSO no longer a non-goal.
      - §6.4: `/org/sso` routes.
      - §11.6: the `directory.sync` job.
- [x] **No migration** on this branch (the Ksage line rule, D-156).
- [x] CI gate green on the PR into `integration-ksage`.

## Notes / context

- PR #354 head e578c79f7: 46 files, +3,268, no migration.
  - better-auth `socialProviders.microsoft`, callback `/api/v1/auth/callback/microsoft`.
  - With `LAIKA_MICROSOFT_CLIENT_ID/_SECRET/_TENANT_ID` set, password endpoints answer `sso_only`.
    Unset, behaviour is unchanged.
- Ksage has 25 members, all lowercase `@kvelld.co.za`.
- Decision numbers reserved: D-152 icons, D-153 email, D-154 Teams, D-155 email-to-task,
  D-156 Ksage line (CHIEF), D-157 calendar, D-158 this.

## Build notes (LAI-1317, PR #359)

- **CI.** `server/test/http/routes/sso.test.ts` (8 tests, on a password board and an SSO board,
  people signed in through the real Microsoft callback) and `server/web/test/api/sso.test.ts`
  (6). No exemption. PR #359 into `integration-ksage`, head `ae52dc87f`: every Gate job green.
- **Tokens.** `account.encryptOAuthTokens: true` in `auth/auth.ts`.
  `test/auth/microsoft-callback.test.ts` reads the raw row (hex ciphertext, no `fixture-ms-`
  fragment) and `get-access-token` hands the issued token back. Red before the option, green
  after. `id_token` is not covered by better-auth's option and stays in clear (D-158 says so).
- **can().** `system.directory.sync` in `SYSTEM_ACTIONS`, `SYSTEM_GRANT`, `matrix.test.ts` and a
  §3.4 row. `assertCan(SYSTEM, …)` at the top of `runDirectorySync` and of the exported
  `addDirectoryMembers`. A source guard in `microsoft-directory.test.ts` asserts both, before
  Graph and before the first row read. `services/permissions.ts` labels only §3.1/§3.2 actions,
  so it needs no entry.
- **Case.** Passes with no fix: better-auth's `findUserByEmail` lowercases, and every Laika
  write to `users.email` is lowercased. Mutation `requireLocalEmailVerified: true` reddens it.
- **Docs.** D-158; SPEC §1.1, §3.4, §6.4, §11.6, and §13.4, which lists every outbound call and
  would otherwise reject the feature at review.
- **Outside the criteria.** `web/src/api/sso.ts`: `token_unreachable` told the admin to check
  the client secret; it now says Microsoft could not be reached.

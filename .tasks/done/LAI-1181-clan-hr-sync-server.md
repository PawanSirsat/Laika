---
id: LAI-1181
title: 'Clan HR sync (server): connect once, pull holidays and leave every 30 minutes, people by email, manual holidays (D-149)'
area: server
assignee: chief
priority: p1
depends-on: [LAI-1180]
status: done
finished: 2026-11-13T17:00:50Z
accepted: 2026-11-13T17:35:00Z
started: 2026-11-13T12:01:12Z
---

## Goal

The server half of D-149's connection: an owner or admin connects Clan once
(Laika logs in, keeps only the encrypted token), a scheduled job pulls
employees, holidays and leave every 30 minutes into Laika's own tables, and
owners can see how the last sync went, run one now, and fix the people map.
Nothing is drawn from these tables yet — LAI-1183 adds the reads. Manual
holidays (LAI-1176 item 1) land here too.

**Clan API facts this is built on** (`https://app.clan.biz/docs`, swagger at
`/docs/swagger.yaml`, Postman at `/docs/Clan-API.postman_collection.json`):
- Base URL is the company's own: `https://<company>.clan.biz/api/v1`
  (`app.clan.biz` answers 403 innererror 2026 "enter correct subdomain").
- `POST /auth/login {email,password}` → `data.token` (`"{id}|{plain}"`),
  `data.expires` (ISO, ~1 year), `data.two_factor_auth.enabled` and
  `.methods`. When enabled, `POST /auth/two-factor {method, code}` with the
  same token completes it. **Never call `/auth/refresh`** (it returns a ~1 h
  token and revokes the old one).
- Headers: `Authorization: Bearer <token>`, `Accept: application/json`.
- Lists: `{data:[…], meta:{paging:{total}}}`, `limit` ≤ 1000, `offset`,
  `fields=`, `filters=` (`leave_date ge "2025-01-01" and leave_date le
  "2027-12-31"`).
- `GET /leave?fields=id,unique_id,leave_date,duration,half_day_type,status,user_id,type{id,type_name}`
  — one row per day; `status` pending/approved/rejected/cancelled; half day =
  `duration: "half day"` + `half_day_type` first_half/second_half. Visible
  rows follow the token user's role (`view_leave = all` sees everyone).
- `GET /holiday` — shape undocumented; Worksuite's is `id, date, occassion`
  (sic). Parse defensively: label from `occassion ?? occasion ?? name ??
  title`, day = first 10 chars of `date`, scope from any
  `department_id(s)` / `designation_id(s)` present (none → everyone).
- `GET /employee?fields=id,name,email,employee_detail` — department /
  designation under `employee_detail`.
- Errors: `{error:{code, innererror:{code}}}`; 401 = token rejected.

## Acceptance criteria

- [x] Migration `0081_hr_source` + `schema.ts` + SPEC §4 entries (LAI-1180):
  - `org_hr_source` (`org_id` PK → orgs, `provider` CHECK 'clan', `status`
    CHECK 'pending_2fa'|'connected', `base_url`, `account_email`,
    `token_enc`, `token_last4`, `token_expires_at`, `pending_expires_at`,
    `connected_by` → users, `connected_at`, `last_attempt_at`,
    `last_success_at`, `last_error_code`, `last_error`, `last_result_json`,
    `updated_at`). No row = off.
  - `hr_people` (`external_id` PK, `user_id` unique nullable → users ON
    DELETE SET NULL, `name`, `department_ref`, `designation_ref`,
    `matched_by` CHECK 'email'|'owner'|'none', `seen_at`, `updated_at`).
    **No email column.**
  - `org_holidays` (`id`, `day`, `label` 1–120, `source` CHECK
    'manual'|'clan', `source_ref`, `scope_json` (null = everyone,
    else `{"departments":[…],"designations":[…]}`), `created_by` → users
    (null for clan), `created_at`, `updated_at`, `removed_at`); unique
    `(source, source_ref)` where `source_ref` not null; index `(day)`.
  - `leave_days` (`id`, `user_id` → users ON DELETE CASCADE, `person_ref`
    → the Clan person, `day`, `part` CHECK 'full'|'first_half'|'second_half',
    `type_name` ≤ 80, `status` CHECK 'approved'|'pending', `source_ref`
    unique (Clan's day id), `application_ref`, `hash`, `synced_at`,
    `removed_at`); index `(user_id, day)`.
- [x] `secrets.ts` `SecretPurpose` gains `'clan_api_token'`; the token is
      encrypted with it, decrypted per run, never logged, never returned, never
      in `activity`; `token_last4` for display. The password is used for the
      one login call and **never stored or logged** (a test greps the DB file
      and the captured log for it).
- [x] `services/clan-client.ts`: the `services/provider.ts` shape —
      injectable `fetchImpl`, `AbortController` timeout 20 s cleared in
      `finally`, no SDK, Clan's error body never echoed,
      `ClanUnavailableError { reached }` and `ClanAuthError` (401); one bounded
      retry on 429/503 honouring `Retry-After` ≤ 30 s (the
      `scripts/backfill-external-ref.ts` pattern, injected `sleep`); paging by
      `offset` until `paging.total`; `login`, `twoFactor`, `employees`,
      `holidays(from,to)`, `leave(from,to)`. `base_url` must be `https:`,
      normalised to `…/api/v1` without a trailing slash. **No test makes a real
      call.**
- [x] `services/hr-sync.ts` `syncHr(db, serverSecret, deps)`: fetch employees,
      holidays and leave for the window **1 Jan last year → 31 Dec next year**
      outside any transaction; then one `BEGIN IMMEDIATE` reconcile, **only
      when every page was read** (else record the error, change nothing):
  - people: upsert `hr_people` by `external_id`; a row not mapped by an owner
    is matched by exact lowercased email to an active `users.email`
    (`matched_by: 'email'`), else `'none'`; an owner's mapping
    (`matched_by: 'owner'`, including "not on Laika" = `user_id` null) is never
    overwritten by the email match.
  - holidays: upsert `source='clan'` by `source_ref`; label, day, scope;
    absent from a complete read → `removed_at` set (never a hard delete);
    reappearing → `removed_at` cleared.
  - leave: rows with `status` approved or pending only, for people with a
    `user_id`; `part` from duration/half_day_type; upsert by `source_ref`,
    `hash` equal = unchanged; absent, now rejected/cancelled, or the person
    unmapped → `removed_at`.
  - result `{ people, matched, unmatched, holidays, leave_days, created,
    updated, removed, unchanged }` written to `last_result_json`,
    `last_success_at` set, `last_error*` cleared. A 401 → `last_error_code:
    'token_rejected'`; unreachable → `'unreachable'`; a bad answer →
    `'bad_answer'`. `last_attempt_at` always set.
- [x] Job `hr.sync` in `jobs/scheduler.ts` `buildJobs`: every 30 min,
      `atStart`, does nothing without a connected row; **an in-flight guard**
      so a slow run is never overlapped (the first async job — the scheduler
      has none), shared with `POST /org/hr/sync`, which joins a run already
      in flight instead of starting another. `serverSecret` threaded through
      `SchedulerDeps` from `index.ts`. `system.hr.sync` in `SYSTEM_ACTIONS`
      and the §3.4 row; `scheduler.test.ts` registry.
- [x] Policy: `org.hr.configure` in `ORG_ACTIONS` and `SESSION_ONLY_ACTIONS`,
      owners and admins through `change_org_settings` in `grants.ts`; `can.ts`
      case with the §3.1 row as its comment; `permissions.ts` label; the
      censuses (`policy-spec-drift`, `matrix`, `permissions`, `can.test.ts`).
- [x] Routes `http/routes/hr.ts` (session only, `org.hr.configure` unless
      said):
  - `GET /org/hr` → `HrSourceView { status: 'off'|'pending_2fa'|'connected',
    provider, base_url, account_email, token_last4, token_expires_at,
    expiring_soon (≤ 30 days), sync_every_minutes: 30, last_attempt_at,
    last_success_at, last_error: {code, message}|null, last_result,
    people: [{external_id, name, user: {id,name}|null, matched_by}] (A–Z,
    ≤ 500) }`.
  - `POST /org/hr/connect {base_url, email, password}` → logs in; 2FA off →
    `connected`, first sync started in the background, `HrSourceView`;
    2FA on → the token kept encrypted as pending for 10 min, `status:
    'pending_2fa'` with `two_factor: {methods}`. Wrong credentials →
    422 `clan_login_failed` (Clan's message not echoed); unreachable → 502
    `clan_unreachable`; non-https → 422.
  - `POST /org/hr/connect/verify {method, code}` → completes 2FA →
    `connected`; expired pending → 409 `two_factor_expired`.
  - `DELETE /org/hr` → 204; the token goes; synced holidays and leave stay as
    last known (D-149).
  - `POST /org/hr/sync` → runs (or joins) a sync, answers `HrSourceView`; not
    connected → 409 `hr_not_connected`.
  - `PUT /org/hr/people {people: [{external_id, user_id|null}]}` →
    `HrSourceView`; unknown ids → 422.
  - `GET /org/holidays?from=&to=` (≤ 731 days) for **any member**
    (`org.read`) → `{ holidays: [{id, day, label, source, everyone}] }`,
    removed rows excluded, A→Z by day.
  - `POST /org/holidays {day, label}` (`org.time.set`) → 201 the holiday;
    a live manual holiday on that day → 409 `holiday_exists`.
  - `DELETE /org/holidays/:id` (`org.time.set`) → 204; a Clan row → 409
    `holiday_from_clan`.
  - Own rate-limit bucket `hr:<who>` (6/min) for `/connect*` and `/sync`.
- [x] Mounted in `app.ts`; `response-type-coverage`, `endpoint-coverage`,
      `structure` mirrors, `schema-spec-drift`, `schema-migration-drift`,
      `env-contract` (no new env var) green.
- [x] Tests against a **fake Clan** (an injected `fetchImpl`): login with and
      without 2FA; wrong password; 401 later → `token_rejected`; paging past
      1000 rows; a half day each way; pending → approved; approved → cancelled
      removes; a person with no Laika match counted, never stored; an owner's
      "not on Laika" survives the next email match; holiday with and without
      scope; holiday removed and back; 429 then 200 retried once; timeout →
      `unreachable`; an incomplete read changes nothing; two overlapping runs
      run once; the password never persisted; the token never in a response or
      log. **Mutations to run:** drop the in-flight guard; reconcile on an
      incomplete read; hard delete instead of `removed_at`; email match
      overwriting an owner's mapping; token in `GET /org/hr`.

## Notes

- Precedents: `services/provider.ts` (client), `services/time-solidtime.ts`
  `reconcile` and `solidtime_people` (reconcile, people map),
  `services/orgs.ts` `nextAiSettings` (write-only secret), `jobs/scheduler.ts`.
- §13.4 forbids this outbound call until LAI-1180's D-149 lands — same PR.
- Live verification waits for Kvell's Clan subdomain and an integration
  account (`view_leave = all`) from Andrea / Abhinav.

## Build notes (2026-11-13, the builder CHIEF dispatched)

Built to SPEC as of LAI-1180's `1f8c7f0f` (D-149 "both ways"), which moved
under this task twice while it was built; where SPEC and the criteria above
differ, SPEC was followed, as CHIEF's log of 13:10 and 13:40 directs.

- **Connect takes either body**: `{ base_url, email, password }` (sign in once,
  `pending_2fa` + `/connect/verify` when Clan asks for a code) or
  `{ base_url, token, expires_on? }` (a pasted token). Either way the token
  is checked (`/auth/me`, a page of `/leave`, a page of `/employee`) before
  it is kept. A refused paste is `422 clan_token_refused`.
- **`org_hr_source` per §4.88**: adds `account_name`, `sees_everyone`,
  `sees_departments`; `account_email` nullable; `connected_by` nullable, set
  null. `hr_people` adds `employment_type` (§4.89); holiday scope reads
  `*_json` fields and carries `employment_types` (§4.90).
- **Paging is until a short page, never `paging.total`** — a live Clan
  answered `total: 2` for 25 rows (LAI-1180's log). An incomplete read is a
  page that fails; it changes nothing.
- **Unreachable is `503 unavailable` reason `clan_unreachable`**, not 502:
  §6.3's codes are closed (CHIEF's answer, LAI-1180 log 12:45).
- **Every criterion holds on this branch alone** since LAI-1180's
  `bd605ea5` (§3's grants row, merged as `1f7e71c7`) and LAI-1182's
  `3e810901` (the web half's callers and view pairs, merged as `77326bf8`):
  `policy-spec-drift`, `response-type-coverage` and the web
  `endpoint-coverage` are green, and no HR view is left in `UNPAIRED`.
- **Measured on a live Clan and built in:** two-factor `methods` arrive as
  `{ email: false, google_authenticator: true }`; a sign-in's pre-code token
  answers every read `403 TWO_FACTOR_REQUIRED`, which is the token refused
  (`clan_token_refused`), never "this role may not read it"

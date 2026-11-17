---
id: LAI-1300
title: 'Attachments (server + docs): presigned uploads to an S3-compatible store, linked from markdown, off unless configured (D-150)'
area: server
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-11-17T09:37:55Z
---

## Goal

The server half of D-150. A deployment that sets the five `LAIKA_S3_*` variables lets people
upload any file up to `LAIKA_ATTACHMENT_MAX_BYTES` (default 25 MiB) to a project and task,
straight from the browser to the store through a presigned `PUT`, and read it back through a
302 to a presigned `GET`. Text that embeds an attachment's URL links it to its task and
comment on save. A deployment that sets none of them (the AWS board) behaves as today, and
says so with `503 unavailable` / `attachments_off` and `OrgView.attachments: null`.

This task also carries the docs: D-150/D-151 are written (CHIEF); the SPEC amendments below
are part of this task.

## Contract

**Env (§11.7, `server/src/env.ts`).** `LAIKA_S3_ENDPOINT` (http(s) origin, no path; `https`
required unless the host is loopback), `LAIKA_S3_REGION`, `LAIKA_S3_BUCKET`,
`LAIKA_S3_ACCESS_KEY_ID`, `LAIKA_S3_SECRET_ACCESS_KEY`, `LAIKA_ATTACHMENT_MAX_BYTES` (integer
bytes, default 26214400, 1 – 5368709120). All five `LAIKA_S3_*` set → on; none → off; some
→ `EnvError` naming the missing ones. The parse function must read all six before validating
any (env-contract discovers reads through a Proxy). The secret is never logged.

**Table `attachments` (new SPEC §4.92, migration 0082 via `pnpm run db:generate`).**
`id` ULID · `project_id` → projects (cascade) · `task_id` → tasks, nullable · `comment_id` →
comments, nullable · `uploaded_by` → users · `filename` (1–255, no `/ \` or control chars;
display only) · `content_type` (lower-case, ≤ 127) · `size_bytes` (1 – max) · `storage_key`
unique, `p/<project_id>/<id>` (never the filename) · `state` `pending|ready` (CHECK) ·
`inline` boolean (set at complete) · `created_at` · `ready_at` · `deleted_at` · `deleted_by`
· `purged_at`. Indexes: `task_id`, `comment_id`, `(state, created_at)`, `project_id`.

**Routes.**
- `POST /api/v1/projects/:slug/attachments` `{filename, content_type, size_bytes, task_id?}`
  → `201 {attachment: AttachmentView, upload: {url, method: 'PUT', headers: {'content-type',
  'content-disposition'}, expires_at}}`. `can(attachment.create)`; `task_id` must be a task of
  that project (404 otherwise); over the max → `413 payload_too_large` with
  `details.max_bytes`; off → `503 unavailable`, `details.reason: 'attachments_off'`. Not in
  `CACHEABLE_ROUTES`; `markOneTimeSecret` (the response holds a credential).
- `POST /api/v1/attachments/:id/complete` → `200 AttachmentView`. Only the uploader
  (`409 conflict` otherwise, or when not `pending`). `HEAD` the object: missing or a different
  size → `409 conflict`, row stays `pending` for the sweep. Range-`GET` bytes 0–15 and set
  `inline` only for a magic-byte-verified png, jpeg, gif, webp or pdf whose declared type
  agrees. Marks `ready`. Writes `attachment.added` when `task_id` is set.
- `GET /api/v1/attachments/:id/content` → `302` to a presigned `GET` (5 min) with
  `response-content-type` (the declared type when `inline`, else `application/octet-stream`)
  and `response-content-disposition` (`inline` when `inline`, else `attachment`, with an
  RFC 6266 `filename*`). `Cache-Control: private, max-age=60`. `project.read`; pending,
  deleted or invisible → 404.
- `DELETE /api/v1/attachments/:id` → `204`. `can(attachment.delete)` with `ownerId =
  uploaded_by`. Sets `deleted_at`/`deleted_by`, deletes the object (best effort; the sweep
  retries until `purged_at`), writes `attachment.removed` when `task_id` is set.
- `GET /api/v1/tasks/:id/attachments` → `{data: AttachmentView[]}`, ready and not deleted,
  oldest first. `project.read`.

`AttachmentView`: `{id, project_id, task_id, comment_id, filename, content_type, size_bytes,
inline, uploaded_by, created_at, ready_at, url}` where `url` is
`/api/v1/attachments/<id>/content`. `OrgView.attachments: {max_bytes} | null`.

**Signing (`server/src/services/s3-client.ts`).** Hand-written AWS SigV4 on `node:crypto`,
path-style, injectable `fetchImpl` and clock, no SDK, never echoes the store's response body.
Presigned `PUT` signs `host;content-disposition;content-length;content-type`, payload
`UNSIGNED-PAYLOAD`, 10 min. Presigned `GET` 5 min. Header-signed `HEAD`, ranged `GET`,
`DELETE`. The upload's `content-disposition` is `attachment` with the RFC 6266 filename.

**Linking.** `linkAttachmentRefs(db, {projectId, taskId, commentId?}, md, now)` in
`services/attachments.ts`, called from `createTask`, `updateTask` (description and
acceptance), `addComment` and `editComment` — the shape of `syncMentions`. Matches only
`/api/v1/attachments/<ULID>/content` (relative or with the instance origin), same project,
`ready`, not deleted; fills a null `task_id` (writing `attachment.added`) and a null
`comment_id`; never relinks. `deleteComment` soft-deletes the attachments whose
`comment_id` is that comment.

**Policy.** `PROJECT_ACTIONS` gains `attachment.create` (member and up, like `comment.create`;
agents/tokens like comments; not a `READ_ACTIONS` member) and `attachment.delete` (lead any,
member own — the existing `own + any` / `own` qualifiers). `SYSTEM_ACTIONS` gains
`system.attachment.prune`. Labels in `services/permissions.ts`.

**Sweep.** Job `attachment.prune` in `jobs/scheduler.ts`, hourly, async, not `atStart`,
`SchedulerDeps.attachments`, `assertCan(SYSTEM, 'system.attachment.prune')`: pending rows
older than 24 h → delete object, delete row; ready rows never linked to a task after 24 h →
soft-delete; `deleted_at` set and `purged_at` null → delete object, set `purged_at`. No
activity. Returns `{changed}`.

**CSP.** `buildContentSecurityPolicy(hashes, {storageOrigin})` adds the store's origin to
`img-src` and `connect-src` only when configured.

**Activity.** `attachment.added` and `attachment.removed`, payload `{attachment_id, filename,
content_type, size_bytes}`. Three owners (CLAUDE.md §4.4): SPEC §4.8, `enums.ts` + CHECK
rebuild in 0082, and the web mirror (`api/stream-types.ts`, wording in `api/activity.ts`,
`dashboard-derive.ts`) — the web mirror ships in this PR so CI is green.

## SPEC amendments (this task)

§1.1 (drop *file uploads*; a *Changed 2026-11-17 (D-150)* note), the D-066 sentence, §3.2
(rows *Attach a file* ✓ ✓ — and *Remove an attachment* own + any | own | —), §3.4
(`system.attachment.prune`), new §4.92 `attachments` (a `field | notes` table — it is a
schema declaration for `schema-spec-drift`), §4.5/§4.7 cross-references, §4.8 (two verbs),
§6.4 (the five routes, `OrgView.attachments`), §11.4.2.1 (task panel Attachments section and
editor attach — the web task builds it), §11.6 (the sweep), §11.7 (six variables), §13.1
(CSP and serving rules), §13.4 (the object store), §14 q5 (resolved). `docs/OPERATIONS.md`:
running Garage beside Laika (bucket, key, `PutBucketCors`, the env).

## Acceptance criteria

- [ ] Env: on / off / partial behave as above; `env-contract` green with the §11.7 rows.
- [ ] `s3-client.ts` reproduces AWS's published SigV4 examples byte for byte: the presigned
      GET example (`AKIAIOSFODNN7EXAMPLE`, `examplebucket`, `test.txt`, `20130524T000000Z`,
      86400 s → `aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404`, virtual-
      host style, so host and path are inputs) and the header-signed GET Object example.
- [ ] Route tests over a fake store (`test/helpers/fake-s3.ts`, the `fake-clan.ts` shape):
      ask → PUT → complete → content 302 → list → delete; 413 at max + 1; 409 on a size
      mismatch and on another person's complete; 503 `attachments_off` when off; 403 for a
      viewer and a read-only token; member deletes own, not another's; lead deletes any.
- [ ] Magic-byte sniff: a `.png` that is really HTML is not `inline`.
- [ ] Linking: same project links, another project does not, an already linked file is not
      relinked, `attachment.added` written once; comment delete removes its files.
- [ ] Sweep: the three cases, and it never touches a ready, linked, live file.
- [ ] CSP: unchanged when off; the store origin in `img-src` and `connect-src` when on.
- [ ] Guards updated, not loosened: `schema.test.ts` `EXPECTED_TABLES`, `schema-spec-drift`,
      `schema-migration-drift`, `migration-files`, `policy-spec-drift` (+ `PROJECT_ROWS`),
      `policy/matrix.test.ts`, `permissions.test.ts`, `activity-payload-names`,
      `response-type-coverage`, `jobs`/`scheduler` tests, `security-headers.test.ts`,
      `orgs`/`comments`/`tasks` service tests, web `view-type-drift`, `use-events`,
      `activity-labels`, `dashboard-derive`.
- [ ] CI gate green on the PR: test, lint and format each exit 0.

## Notes / context

- Belka rule: run single test files only (`--maxWorkers=1`), never the repo-root suite; CI
  runs the gate.
- No new dependency. The store was checked live on 2026-11-17 (Garage v2.5.0 behind Traefik):
  a presigned PUT with a different `content-length` or `content-type` is refused `403 Invalid
  signature`; `PutBucketCors` works and a preflight from another origin is refused;
  `response-content-*` overrides are honoured; a ranged GET answers 206; DELETE 204 then HEAD
  404. Garage sends no `x-content-type-options`, so the `response-content-type` override is
  what keeps active content from rendering.
- Migration 0082 rebuilds `activity` (the CHECK) — the same shape as 0074; read the generated
  `INSERT … SELECT` (memory: the Drizzle migrator and foreign keys).

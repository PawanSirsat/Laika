---
id: LAI-1311
title: 'Project icons: an uploaded image or an emoji, else the first letter on the project''s colour, shown everywhere the project appears (D-152)'
area: server
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-17T18:13:27Z
finished: 2026-11-17T20:06:00Z
---

## Goal

The owner, 2026-11-17: *"add the project icons, show that everywhere of that project as
highlight; if no logo show the first letter … in space settings … implement this and push
in both repos"*. Board card LAIKA-1079. Dispatched by CHIEF to builder session laika-c4,
which files from CHIEF's block (D-151) and writes the docs half (D-152, SPEC rows) as this
task names them.

A space carries an icon: an **image** kept in the operator's attachment store (D-150), or an
**emoji**, and otherwise its **first letter on its colour** (D-103 item 4). Only org owners
and admins change it. Every place the board shows a space draws it through one shared
`ProjectMark`. A deployment with no store (the AWS board) offers emoji and letter only.

## Contract

**Data (§4.3, migration 0083 via `pnpm run db:generate`).** `projects` gains
`icon_emoji` (nullable; one grapheme, checked with `Intl.Segmenter`), `icon_key`
(nullable; the store key `p/<project_id>/icon/<ulid>`), `icon_type` (nullable; the image's
verified type) and `icon_updated_at` (nullable). An image wins over an emoji, an emoji over
the letter. `ProjectView.icon` is `{ emoji } | { url, updated_at } | null`, where `url` is
`/api/v1/projects/<slug>/icon?v=<updated_at>`.

**Routes (§6.4; every one calls `can()`).**
- The emoji: `PATCH /api/v1/projects/:slug` with `icon_emoji` (a string sets it, `null`
  clears it). Needs `project.icon.write` besides the patch's own `project.settings.edit`.
- The image, three steps, reusing `services/s3-client.ts` (no second store client):
  ask (`POST /projects/:slug/icon`: a presigned `PUT`, `image/png`, `image/jpeg` or
  `image/webp` only, **no SVG**, ≤ 1 MiB), complete (`POST /projects/:slug/icon/complete`:
  `HEAD` for the size, the first bytes verified as attachments verify them), remove
  (`DELETE /projects/:slug/icon`). Replacing or removing an image deletes the old object.
- Read: `GET /api/v1/projects/:slug/icon?v=<updated_at>` returns the image's bytes,
  proxied through the backend so `img-src 'self'` covers it, with
  `Cache-Control: private, max-age=31536000, immutable`. `project.read`.
- With no store configured, the image routes answer `503 unavailable` with
  `details.reason: 'attachments_off'`; emoji and letter still work.

**Rights.** A new org action `project.icon.write`, SPEC §3.1 row *Change a space's icon*
(owner ✓, admin ✓, member —, viewer —). Reading is `project.read`. Updated together:
`policy/actions.ts`, `can.ts`, the labels in `services/permissions.ts`, and the guards
(`policy-spec-drift`, `helpers/policy-matrix.ts`, `policy/matrix.test.ts`,
`permissions.test.ts`). **No new activity verb**: the existing `project.updated` is
written.

**UI.**
- Space settings → General: an Icon section, shown only to owners and admins, with a
  preview, Upload (hidden when `org.attachments` is null), an emoji picker and Remove.
- The emoji picker adds **no npm dependency**: a curated grid of about 48 plus "type or
  paste an emoji", validated as a single grapheme.
- `ProjectMark`, one shared component: the image, else the emoji, else the first letter
  on the space's colour. Used **everywhere a space appears**, found by a full census
  (never truncated) that the PR body lists. Expected places: sidebar spaces, the space
  header and toolbar, the Spaces card and table, the create-task space picker, the
  command palette, task drawer breadcrumbs, My day and Time logging project labels,
  Insights, inbox and notifications, the dashboard, and anything else the census finds.
- Both themes, phone width, aria labels, design tokens only, no icon package.

**Docs.** D-152 at the end of `docs/DECISIONS.md` (amends D-103 item 4). SPEC: §3.1 row,
§4.3 columns, §6.4 routes and `ProjectView.icon`, §11.4.2.1 space settings and marks.

## Acceptance criteria

- [x] Migration 0083 adds the four columns; the generated SQL is read; every
      `migrationsFolder` test and `schema` guard is green.
- [x] Emoji: set, replace and clear through `PATCH`; anything that is not exactly one
      emoji grapheme is `422`; a lead who is not an org owner or admin is `403`.
- [x] Image over a fake store: ask, then `PUT`, then complete, then read the bytes; a
      different size is `409`; SVG, another type and over 1 MiB are refused; a file
      whose first bytes do not match its declared type is refused; replacing and
      removing delete the old object; store off is `503 attachments_off`; a member, a
      viewer and a read-only token are `403`.
- [x] Read: bytes and `Cache-Control: private, max-age=31536000, immutable`; a project
      the caller cannot read, or one with no image, is `404`.
- [x] `project.icon.write`: §3.1 row, `can()`, labels, and the policy guards updated,
      not loosened.
- [x] `ProjectMark` is used at every place the census found; the PR body lists them.
- [x] Space settings → General Icon section: owners and admins only; Upload hidden with
      no store; both themes and phone width.
- [x] D-152 and the SPEC rows written.
- [x] CI gate green on the PR: test, lint and format each exit 0.

## Notes / context

- Belka rules: single test files only (`--maxWorkers=1`, `--test-concurrency=1`), load
  below 15, CI runs the full gate.
- Release: the builder stops at a green PR, this file in review and its log; CHIEF
  reviews, merges and pushes to KvellDynamics/ksage-2.0 (CHIEF, 2026-11-17).

## Build notes (LAI-1311, CHIEF builder laika-c4, Belka)

PR #358, branch `LAI-1311-project-icons`, CI green at `a9e9de1ec` (every check). Every
criterion above holds. Deviations and choices, each also in the PR body and the log:

- **One icon at a time.** Setting an emoji drops an image (its object deleted after the
  write); completing an image clears the emoji; `DELETE` clears both. Otherwise removing an
  image would resurface a forgotten emoji.
- **Stateless ask/complete.** The upload id is a ULID in the key; nothing is stored between
  the two steps. An image put and never completed stays in the store (≤ 1 MiB, owner/admin
  only) — the known limit D-152 records.
- **`immutable` only when `v` is the current version**; any other `v` is `private, no-cache`.
- **The complete body carries `upload_id`, `content_type` and `size_bytes`** (the contract
  named only HEAD + sniff): `size_bytes` is what the `409 size_mismatch` criterion is checked
  against, and `content_type` what the first bytes must agree with (`422 type_mismatch`).
- **The look store** (`api/project-looks.ts`) means ~60 sites whose endpoints send only
  `{slug, name}` draw the right mark with no view growing a field.
- **The glyph is drawn from `data-glyph`, not written as text**, so no row reads
  `AAcme Billing`; four browser tests that read the letter as text now read the attribute.
- **Chart series colours** still hash the slug — a follow-up for CHIEF to file (log).

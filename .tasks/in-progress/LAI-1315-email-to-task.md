---
id: LAI-1315
title: 'Email-to-task: a space''s inbound address turns a mail into a task, and a reply into a comment; the switch ships off (D-155)'
area: server
assignee: chief
priority: p2
depends-on: [LAI-1312]
discovered-from: LAI-1310
status: in-progress
started: 2026-11-18T09:58:00Z
---

## Goal

Board card LAIKA-1083, dispatched by CHIEF to builder session laika-c4 (Belka). It reverses
SPEC §1.1's "email as a primary interface" non-goal **for inbound task creation only**
(D-155). KSage specified it (its §7.2) and never built it (LAI-1310).

The plan was approved by CHIEF on 2026-11-18. It ships as **two PRs** on this task:
**A** (everything but attachments) and **B** (attachments to the store).

## Contract

**Endpoint.**
- `POST /webhooks/email` (§10.3) receives Brevo inbound parsing: `{ items: [...] }`.
- **Authentication:** `Authorization: Bearer <token>`. Laika generates the token and stores
  it encrypted. Both sides are hashed to a fixed length before `timingSafeEqual`, so a length
  mismatch neither throws nor leaks. A wrong or missing token is `401` with a log line.
- **Retries:** each item is idempotent on its `MessageId`. Every item processed or dropped
  answers `200`, so Brevo never retries a mail Laika chose to drop.
- **Limits:** its own rate-limit bucket, and a 4 MiB body limit on this route only.

**Addresses.**
- Each space has `<slug>-<token>@<inbound domain>`, matched on the token alone, so a rename
  does not break it.
- Stored in `project_inbound_addresses` and created lazily.
- **Rotating** needs `project.settings.edit`; the old address stops at once.
- **Seeing** it is for anyone who may `task.create` in the space.

**Sender, authority, drops.**
- The webhook resolves the address and the sender as a new §3.4 system action,
  `system.email.receive`, then **writes as the matched user** (`loadActor`):
  - `createTask` and `addComment` run their own `can()`;
  - membership and `task_create_min_role` apply unchanged.
- **D-155 states this impersonation rule plainly.** It names:
  - the forged-From threat;
  - the default-on DMARC-aligned authentication it rests on;
  - why the switch-off default and the require-authenticated default make it safe;
  - how each drop reason answers the threat.
- **Dropped and logged, never answered,** for each of these reasons:
  - `switch_off`
  - `unknown_address`
  - `unknown_sender`
  - `not_allowed`
  - `unauthenticated`: the `Authentication-Results` header does not show dmarc=pass, or an
    aligned dkim or spf pass, while the org's require-authenticated setting (default on) is
    set
  - `spam`: Brevo's spam score is 5 or more
  - `auto_reply`: `Auto-Submitted` other than `no`, or `Precedence` of
    bulk, junk or list
  - `own_sender`: the From is the board's own SMTP From address, as a loop guard
  - `duplicate`
  - `empty`

**Mail to task, reply to comment.**
- **New mail:** the subject becomes the title (`(no subject)` if empty), capped to the title
  limit. The description is Brevo's `ExtractedMarkdownMessage`, else `RawTextBody`, capped.
  **HTML is never used.**
- **Reply:** if `InReplyTo` or `References` names a stored inbound `MessageId` of the same
  space, or the subject carries `[KEY-N]` for a task in the space, the mail becomes a
  **comment** on that task.
- **`created_via: 'webhook'`** on tasks and comments. `addComment` gains an optional `via`.
  There is **no** rebuild of `tasks`, `comments` or `activity`.
- **Provenance:** the `email_inbound` row (message id, sender, project, outcome or reason,
  task id, comment id), pruned at 90 days by `system.email.prune`.
- **No mail text** reaches HTML unescaped. The log keeps **no subject or body**, only ids and
  reasons.

**Switch.**
- `org_email_inbound` is a singleton table; `orgs` is not altered. It holds:
  - `enabled`, default **off**;
  - the domain;
  - the bearer token and the Brevo API key, encrypted, with their last 4;
  - require-authenticated, default **on**.
- Set under `org.email.configure`, session only. It cannot be switched on without a domain
  and a token.
- `OrgView.email_inbound = { enabled, domain }` is readable by everyone.
- **It is switched on only at the owner's word,** after Hemanth's MX records and the Brevo
  webhook exist.

**UI.**
- **Organisation › Integrations, *Email to tasks* card:**
  - the switch;
  - the domain, with the placeholder `tasks.kvelld.com`;
  - the API key;
  - the token: generate or rotate, shown once;
  - the webhook URL;
  - require-authenticated;
  - the last 20 inbound rows (outcome, reason, time, links; no mail text).
- **Space settings:** the space's address, with *Copy* and *New address*.

**Attachments (PR B).**
- StoreClient gains a signed `PUT` with a payload hash.
- A job (`system.email.attachments`) fetches each `DownloadToken` from the Brevo API (capped
  at the board's attachment limit), PUTs it, and records a ready `attachments` row with
  `uploaded_by` set to the sender. The row is linked to the task or comment, with
  `attachment.added`.
- A failure is noted on the log row and never blocks the task.
- §13.4 gains the two outbound calls.

**Migration.** New tables only. It is numbered at merge time: `master` has `0086` (email B)
and `0087` (calendar) first.

**Docs.**
- **D-155.**
- **SPEC:**
  - §1.1 amended;
  - §3.4;
  - the new §4 tables;
  - §6.4;
  - §10.3;
  - §11.6;
  - §13.4.
- **OPERATIONS:** *Email to tasks: turning it on*, covering the MX records, the Brevo inbound
  webhook with bearer auth, the API key, and a test mail. The domain example is
  `tasks.kvelld.com`.

**Deferred** (filed as a follow-up once B lands): acknowledgement and bounce mail, and a
Reply-To on notification mail. Each needs Message-ID support in the transport and a new
outbox kind.

## Acceptance criteria

- [x] `POST /webhooks/email`: bearer token, fixed-length hashed compare; `401` on a bad
      token; idempotent on `MessageId`; `200` for every item processed or dropped; its own
      rate-limit bucket and 4 MiB body limit
- [x] A space address is lazy, matched on its token, rotatable under `project.settings.edit`,
      and visible to those who may `task.create`
- [x] A mail from an authenticated, allowed member creates a task as that member
      (`created_via: 'webhook'`); a reply in the thread, or one carrying `[KEY-N]`, adds a
      comment
- [x] Every drop reason is tested, including a forged From address, own-sender and
      auto-reply loops; the log carries no mail text
- [x] The switch defaults off; turning it on needs a domain and a token; require-authenticated
      defaults on; `org.email.configure` is session only
- [x] The *Email to tasks* card and the Space settings address work in both themes, at 1440
      and 390
- [x] D-155; SPEC §1.1, §3.4, §4, §6.4, §10.3, §11.6, §13.4; OPERATIONS
- [ ] (PR B) attachments are fetched from Brevo and PUT to the store as ready rows linked to
      the task or comment; a failure never blocks the task
- [ ] CI green on each PR

## Progress (2026-11-18)

- **PR A** — branch `LAI-1315-email-to-task`: the webhook, addresses, sender matching, the
  record, the switch, the card and the space address, D-155, the SPEC and OPERATIONS. Opened
  for CHIEF's review; criteria 1–7 above are its own.
- **PR B** — branch `LAI-1315-email-attachments`, cut from PR A at `fdc54dd60` and pushed
  (`2b62ccca2`): the store's header-signed `PUT`, Brevo's attachment fetch, and the
  `system.email.attachments` job. Its PR opens once PR A is merged, so that it shows only its
  own diff.
- **Outside the plan, and flagged:** `/webhooks/*` resolves no Laika credential
  (`http/middleware/auth.ts`). Brevo's `Authorization: Bearer` was refused as an invalid Laika
  token before the route could check it. GitHub and the transcript route send no Authorization
  header, so nothing changes for them.

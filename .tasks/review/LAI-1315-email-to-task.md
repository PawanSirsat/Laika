---
id: LAI-1315
title: 'Email-to-task: a space''s inbound address turns a mail into a task, and a reply into a comment; the switch ships off (D-155)'
area: server
assignee: chief
priority: p2
depends-on: [LAI-1312]
discovered-from: LAI-1310
status: review
started: 2026-11-18T09:58:00Z
finished: 2026-11-18T13:05:00Z
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
- [x] (PR B) attachments are fetched from Brevo and PUT to the store as ready rows linked to
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

## Review round 1 (CHIEF / review-1315, 2026-11-18) — response

review-1315 found the `/webhooks/*` auth change safe, and the token, address token, threading,
content and migration sound. Every finding below is made, with its test. Each must-fix and F2–F5
was checked by putting the bug back: each went red.

- **M1, the believed header.**
  - There is no "topmost" fallback: with no `authserv_id` nothing is believed. While
    authentication is required the switch cannot turn on (422 `authserv_required`, plus a DB
    CHECK).
  - With an id named, only the first header carrying it counts; later ones with the same id
    or another are ignored.
  - Two keys for the header (case variants), or a value that is not text, fails closed.
  - Each mail records the servers its headers named (`email_inbound.authserv_ids`), and the
    card lists them under *Seen in recent mail*.
  - OPERATIONS says to name the server from a real delivery while the switch is off, never
    from an example; the invented example is gone.
  - The route test's header is labelled a fixture.
  - Tests:
    - a forged header with the named id below the real one;
    - a forged header above it with another id;
    - duplicate keys;
    - no id named;
    - enabling refused with no id.
- **M2, what the check proves.**
  - D-155 item 4 says DMARC, DKIM and SPF authenticate a domain, not a mailbox. Anyone who can
    send as any address at that domain can be written as any member there: a colleague, a
    Send-As grant, or any service in its SPF or holding its DKIM key.
  - **Turning the switch on, and turning authentication off, are an owner's alone:**
    403 `owner_only`, a check after `can()`. CHIEF confirmed both. An admin may turn it off and
    change the rest.
  - The card disables both controls for an admin, with the reason "Only an owner can turn this
    on."
  - D-155 item 7 and SPEC §4.103 and §6.4 say so.
- **F1, payload shapes.** `SpamScore` at top level as well as `Spam.Score`, and plain-address
  lists. The envelope `Recipients` decides the address (a Bcc'd space is found); To and Cc are
  used only without an envelope.
- **F2, rate limiting.** The webhook counts itself after the token: verified deliveries in
  `inbound-email`, refused tokens in `inbound-email:refused` (30). The middleware leaves the
  path alone. Junk cannot 429 Brevo.
- **F3, one mail's fault.** Each mail is isolated: a fault records nothing of it, the rest are
  still received, and the answer is 503 so Brevo redelivers (landed mails are duplicates). A
  `refused` is logged at warn, and a fault at error with its name and frame, never mail text.
- **F4, angle brackets.** `header.from=<user@domain>` is read as its domain.
- **F5, strict alignment.** The domain authenticated must equal the From domain. SPF's
  `smtp.helo` no longer counts.
- **F6, the 4 MiB test.** It now also asserts that another route keeps 1 MiB.
- **F7, the comment** in schema-spec-drift is fixed.
- **Also:**
  - `EmailInboundRowView.project` is named, `InboundProjectView` and `InboundProject`, and
    paired in the drift test.
  - `can_store_secrets` disables the API key field, with the reason, before Save.
- The migration `0088_email_inbound` was regenerated with the CHECK and the column; it is still
  new tables only.

## Review round 2 (CHIEF / review-1315, 2026-11-18) — response

review-1315 confirmed M1, F1 and F4–F7 at dbb8e9104. These are the rest, each with its test, and
each checked by putting the bug back: each went red.

- **M2, every write but turning it off is an owner's.**
  - That covers token rotation, any receiving-server, domain or key change, and
    `require_authenticated` either way.
  - It is enforced with 403 `owner_only`, naming the field, as a check after `can()`.
  - An admin may send `{ enabled: false }` and nothing else. The view's `can_change` replaces
    round 1's two flags, and the card disables every other control with *Only an owner changes
    these settings*.
  - D-155 item 7 lists the paths, so item 4's "a receiving server an owner named" and "a bearer
    token only Brevo holds" are true.
- **F2, a regression.** The token and its bucket are now checked by `inboundEmailGate`, mounted
  on `/webhooks/email` before the body limit: Hono's limit reads a body sent without a length.
  A refused request reads no body. The test uses a `highWaterMark: 0` stream that throws if
  pulled. The route re-checks the token.
- **F3 and the poison mail.**
  - An empty (`<>`) or spaced `Message-ID` is no id, and the mail is keyed by its digest.
  - A fault is recorded `failed` with `attempts`. Each redelivery tries again, and the third
    fault is `dropped` `failed_repeatedly` and answered 200, so Brevo stops.
  - The card shows both in words.
  - The migration (0088, regenerated) gains `email_inbound.attempts`.
- **Follow-ups.**
  - OPERATIONS step 4 says to confirm the named id is Brevo's own receiving host, seen on mail
    from two different providers, and never the sender's provider's (Microsoft 365 stamps its
    outbound mail).
  - The three stale "null reads the topmost" comments are fixed.

## Review round 3 (CHIEF, 2026-11-18) — response

review-1315 confirmed every round-2 fix at a62dedde7. CHIEF raised two more before merging; both
are done, and each was checked by putting the bug back, which turned its test red.

- **Non-POST methods.**
  - The gate answers `405` with `Allow: POST` to every other method before anything else,
    counted in the anonymous bucket every uncredentialed request spends.
  - The 4 MiB body limit and the limiter's exemption are now POST-only.
  - Test: a chunked PUT with a stream that throws if pulled gets 405 and is never read, its
    `X-RateLimit-Remaining` falls by one per request, and GET, DELETE and PATCH get 405.
- **Pre-claim.**
  - The sender is part of a mail's key: unique `(message_id, address_token, from_address)`.
    `from_address` is now `''` rather than null when there is none, and the view maps `''` back
    to null.
  - A forged mail with a predicted id is a row of its own. The real one is received, then a
    duplicate.
  - Another sender's mail with a failed record's id does not touch it.
  - Migration 0088 is regenerated.
- **Nit.** `ensureRow` now runs after the owner check, so a refused change writes nothing.

## PR B (2026-11-18)

PR A (#375) is merged at 3c728e889. PR B, `LAI-1315-email-attachments`, merges it and brings
the attachments up to date with A's three review rounds: §4.106 and §4.103's key, and its tests
name the receiving server. It needs no migration; the queue table was in A's 0088.

- **The store's `put`.** A header-signed `PUT` whose `x-amz-content-sha256` is the body's
  SHA-256, so the store refuses a body changed in flight. The fake store re-verifies both the
  signature and the digest.
- **`fetchInboundAttachment`.**
  - It calls Brevo's one origin only, with the token path-encoded and `redirect: 'error'`.
  - It reads at most the board's limit, plus the one byte that proves `too_large`, and never
    reads Brevo's error bodies.
- **`storeServerAttachment`.** It follows a browser upload's lifecycle: a `pending` row, the
  `PUT`, then `ready` and `attachment.added` as the sender. A failed `PUT` leaves a pending row
  for §11.6's sweep.
- **The `system.email.attachments` job.**
  - It runs every 30 seconds, and only when `index.ts` passes `inboundEmail`, so no test can
    reach Brevo by leaving it out.
  - It skips `store_off`, `no_api_key`, `too_large` and `not_needed` at once.
  - It tries `fetch_failed` and `store_failed` three times.
  - It joins a tick still running, and never blocks the task.

The criterion "CI green on each PR" is ticked by CHIEF after PR B's CI and review.

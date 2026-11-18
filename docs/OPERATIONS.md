# Operating Laika

**For the person running a Laika instance**, not for the people building one.
Everything here is either executed by a test or measured against a running
instance, and each section says which.

> **Nothing in this file is a plan.** If a procedure is written here, something in
> `server/test/` performs it. Where a written step and the test disagree, **the
> test is right** — and that disagreement is a bug worth filing.

---

## Restoring from a backup

Laika writes a snapshot of its database every night and keeps the newest
fourteen (SPEC §11.6). This is how you use one.

**The executable version of this procedure is
`server/test/jobs/restore-drill.test.ts`.** Every step below is asserted there,
including the two that are easy to get wrong.

### 0. Confirm `LAIKA_SECRET` matches the snapshot

**This is the step with no error message.**

§12's encrypted columns — SMTP settings, the GitHub and transcript webhook
secrets, the org's AI key — are encrypted with a key derived from `LAIKA_SECRET`.
**Restore under a different secret and everything appears to work**: the database
opens, the server boots, `/health` answers, people sign in. Only the encrypted
columns are unreadable.

Laika refuses them loudly rather than reporting them absent, and the reason is
worth knowing: **"no provider configured" is a legitimate state.** An operator
told that would go and configure one — the single action that cannot help, and
which overwrites the data that was recoverable.

> **Back up `LAIKA_SECRET` separately from the database, and not beside it.** A
> backup containing both is a backup where losing one file loses everything.

### 1. Stop the server

```bash
docker compose stop laika        # or: systemctl stop laika
```

A snapshot restored under a running process races it.

### 2. Take the newest snapshot

```bash
ls -1 /var/lib/laika/backups/laika-*.sqlite | tail -1
```

The filenames are ISO timestamps, so they sort chronologically. **`tail -1` is
the newest** — no `stat`, and no dependence on mtimes that a copy or an `rsync`
would have rewritten.

### 3. Copy **one file** over the database

```bash
cp /var/lib/laika/backups/laika-<timestamp>.sqlite /var/lib/laika/laika.db
```

**One file, and only that file.** Laika runs SQLite in WAL mode, so a live
database is three files — but a snapshot is not. `Database.backup()` is SQLite's
online backup and writes **a single consistent file**; the drill asserts the
snapshot has no `-wal` or `-shm` of its own, which is what makes copying one file
both sufficient and correct.

### 4. Delete any stale `-wal` and `-shm`

```bash
rm -f /var/lib/laika/laika.db-wal /var/lib/laika/laika.db-shm
```

**These belong to the database you just replaced**, at a moment that no longer
exists. Leaving them beside a restored file is the same torn read as copying all
three, with a delay on it.

### 5. Start, and check

```bash
docker compose start laika
curl -s localhost:3000/api/v1/health
```

**Read `uptime_ms` and confirm it is seconds.** A health check answering does not
prove *your* server answered — if something else already holds the port, you are
reading its uptime, and it will look exactly like success.

---

## Why there is no `laika restore` command

Restoring is five commands, three of which are `stop`, `start` and `curl`. **A
command that restored an unbootable snapshot would be worse than no command**, so
proving the artefact came first (LAI-466) and a verb, if one is ever added, comes
after.

**The two steps a command would encapsulate are steps 3 and 4** — and those are
exactly the two an operator should understand rather than delegate, because
getting them wrong produces a database that opens and is quietly wrong.

---

## Attachments: running Garage beside Laika

Attachments are **off** until the operator names a store (D-150, SPEC §11.7).
Laika never holds the bytes: the browser uploads to the store and reads from it
through URLs Laika signs, so the store must be reachable **at one address by
both the browsers and the Laika server**. Any S3-compatible store that speaks
path-style SigV4 works; these steps are for [Garage](https://garagehq.deuxfleurs.fr),
which the Ksage deployment runs (`v2.5.0`, single node).

**What backs each step.** Steps 1 and 2 are Garage's own quick start, and the
behaviour they rely on was measured against the Ksage store on 2026-11-17
(LAI-1300's task file): a presigned `PUT` of another size or type refused `403`,
`PutBucketCors` accepted and a preflight from another origin refused. Step 3's
rules are executed by `server/test/env.test.ts`,
`server/test/http/routes/attachments.test.ts` and
`server/test/http/security-headers.test.ts`, over a fake store; no test calls a
real one.

### 1. Run Garage and make a bucket and a key for Laika

Single node, with its data and metadata on a persistent volume (Garage's quick
start shows `garage.toml`; `s3_region = "garage"` is the region below). Then:

```bash
garage bucket create laika-attachments
garage key create laika
garage bucket allow --read --write --owner laika-attachments --key laika
```

`garage key create` prints the key id (`GK…`) and its secret **once** — they are
`LAIKA_S3_ACCESS_KEY_ID` and `LAIKA_S3_SECRET_ACCESS_KEY`. The key needs nothing
but this bucket. `--owner` lets the same key set the bucket's CORS in step 2.

**Keep the bucket private: no public read, and no website mode.** An object
keeps the type its uploader declared, so an HTML file stored as `text/html`
would render on the store's origin if it could be fetched directly; only the
presigned `GET` Laika issues forces a download type, and that is the only way
in it should have.

Put the S3 API (port 3900) behind your TLS proxy at its own name, for example
`https://files.example.com`. **Let the proxy pass bodies as large as
`LAIKA_ATTACHMENT_MAX_BYTES`** — the upload goes through it, not through Laika.
**The one exception is a mailed file** (*Email to tasks*, D-155): Brevo hands
its bytes to the server, which holds each one in memory on its way to the store.
That path takes at most the smaller of `LAIKA_ATTACHMENT_MAX_BYTES` and
**40 MiB** a file, one file at a time; anything bigger is recorded
`too_large` and never fetched.

### 2. Let the board's origin upload: `PutBucketCors`

A browser `PUT`s to the store from the board's page, which is another origin, so
the bucket must allow that origin — and only that one. With the AWS CLI, using
the key from step 1:

```bash
cat > cors.json <<'JSON'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://board.example.com"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["content-type", "content-disposition"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
JSON
AWS_ACCESS_KEY_ID=GK… AWS_SECRET_ACCESS_KEY=… AWS_REGION=garage \
  aws s3api put-bucket-cors --endpoint-url https://files.example.com \
  --bucket laika-attachments --cors-configuration file://cors.json
```

`AllowedOrigins` is the origin the SPA is served from — the Netlify site on
Ksage, `LAIKA_PUBLIC_URL` on a one-host install. A preflight from any other
origin is refused, which is what was measured on 2026-11-17. Showing an image
needs no CORS: an `<img>` follows Laika's `302` like any link.

### 3. Tell Laika, and restart

```bash
LAIKA_S3_ENDPOINT=https://files.example.com
LAIKA_S3_REGION=garage
LAIKA_S3_BUCKET=laika-attachments
LAIKA_S3_ACCESS_KEY_ID=GK…
LAIKA_S3_SECRET_ACCESS_KEY=…
# optional: the largest file, in bytes; 25 MiB by default
LAIKA_ATTACHMENT_MAX_BYTES=26214400
```

**All five `LAIKA_S3_*` or none**: some but not all is a startup failure that
names the missing ones. `http://` is refused unless the store is on a loopback
host. After the restart `GET /api/v1/org` answers `attachments: { max_bytes }`
— `null` means the board is still off — and the CSP names the store in
`img-src` and `connect-src`.

### 4. Back the store up yourself

The nightly snapshot (SPEC §11.6) holds the `attachments` rows and **not the
files**. Back Garage's data and metadata directories up on your own schedule.
A restored database whose store was not restored lists files whose links answer
the store's `404`; a restored store with an older database keeps objects nothing
names, which nothing sweeps.

### Turning it off

Unset all five and restart. Every attachment route then answers `503` with
`reason: attachments_off`, the SPA shows no attach control, and the rows and
objects stay where they are, unread, until the variables come back.

---

## Email: turning it on

Email ships **off** (D-153, SPEC §4.93). Until an owner or admin turns it on,
Laika mails nothing; every invite or reset link that would have been mailed is
recorded in the outbox as `suppressed` / `email_off`, and the copy-link flow
works exactly as before. Turning it on is three steps on **Organisation ›
Integrations › Email**, with no restart and no environment change.

**Before you start**, check two things outside Laika:

- **The sender is verified in Brevo.** The card is pre-filled with
  `ksage@kvelld.com`. Brevo refuses a From address it has not verified, and
  the test send then fails with `550`/`553`. Add it under *Senders, domains &
  dedicated IPs* if it is not there. `kvelld.com` is already authenticated for
  SolidTime's `no-reply@kvelld.com`.
- **`LAIKA_PUBLIC_URL` is set.** A link in an email must be absolute. Without
  it, invites and reset links stay copy-only and the card says so.

### 1. Paste a dedicated key and save

In Brevo, open *SMTP & API › SMTP* and **generate a new SMTP key for Laika
alone**, so that it can be revoked without touching SolidTime. Paste it into
*SMTP key*, put the SMTP login Brevo shows into *Login*, and press *Save*.

- **Kept encrypted.** The key is stored under `LAIKA_SECRET` (§12, purpose
  `smtp_json`), and the card shows only its last four characters.
- **Rotating `LAIKA_SECRET`** makes it unreadable. The card then says so, and
  you paste the key again.
- **Changing the host, port or login needs the key pasted again.** The stored
  key is only ever sent to the server it was saved for.
- **This page needs a signed-in owner or admin.** No API token can change
  these settings or turn email on.

### 2. Send a test email

*Send test email* sends one message, right away, to your own address. It is
the only send that works while the switch is off.

- **When it works,** the card says where the message went.
- **When it fails,** the card gives the server's code: `535` means a wrong
  login or key; `550`/`553` an unverified sender; `ETIMEDOUT` or
  `ECONNREFUSED` that port 587 is not reachable from the server.

### 3. Flip *Email on*

From then on, an invite with an address and an admin-issued reset link are
also mailed. So is each person's own notification mail (LAI-1313): a message
when they are assigned a task or @mentioned, and one digest a morning, around
07:00 in their own time zone, for everything else on the tasks they watch. Each
person can turn either off in the *Email* section of their own profile. Nothing
from before the switch went on is ever mailed. The sender job runs every 30 seconds, and each message is recorded
in the outbox:

- **A refusal** (5xx) is final.
- **A temporary failure** is retried for about an hour and a half.
- **A timeout once the server had the message** is `unconfirmed` and never
  sent twice.

### Turning it off

Flip *Email on* off. Anything still queued is recorded `email_off` at the next
tick and never sent. *Clear* forgets the key and the settings and turns the
switch off with them.

## Email to tasks: turning it on

*Email to tasks* ships **off** (D-155, SPEC §10.3). Until an owner turns it on,
every mail Brevo delivers is recorded as dropped `switch_off`, and nothing is
written. When it is on, a member's mail to a space's address becomes a task,
written as that member, and a reply in its thread becomes a comment. **Turn it
on only on the owner's word**, after the DNS and Brevo steps below exist.

It writes **as the person the mail says it is from**, so it accepts a mail only
when the receiving server you name proved the sender's domain sent it: a DMARC,
DKIM or SPF pass for exactly that domain. Leave *Require authenticated senders*
on.

### 1. The receiving subdomain (DNS — Hemanth)

Pick a subdomain that is not the one Laika sends from, for example
`tasks.kvelld.com`, and point its mail at Brevo:

| Record | Type | Priority | Value |
| --- | --- | --- | --- |
| `tasks.kvelld.com` | MX | 10 | `inbound1.sendinblue.com.` |
| `tasks.kvelld.com` | MX | 20 | `inbound2.sendinblue.com.` |

The domain must also be verified in Brevo. DNS can take hours to propagate,
so do this first.

### 2. The card

On **Organisation › Integrations › Email to tasks**, signed in as an owner or
admin:

1. Enter the **receiving domain** and save.
2. Press **Make token**. The token is shown **once**: copy it now. Making
   another later replaces it, and Brevo must then be given the new one.
3. Copy the **webhook URL** the card shows, `LAIKA_PUBLIC_URL/webhooks/email`.
   It needs `LAIKA_PUBLIC_URL` to be set.
4. Optional, for attachments: paste a **Brevo API key** made for Laika alone.
   It is stored encrypted; the card shows its last four characters.

### 3. Brevo's inbound webhook

Create the webhook with Brevo's API, using a Brevo API key. **The owner runs
this. Never paste a key into a chat or a ticket.**

```
POST https://api.brevo.com/v3/webhooks
api-key: <a Brevo API key>
{
  "type": "inbound",
  "events": ["inboundEmailProcessed"],
  "domain": "tasks.kvelld.com",
  "url": "https://<LAIKA_PUBLIC_URL host>/webhooks/email",
  "description": "Laika email to tasks",
  "auth": { "type": "bearer", "token": "<the token from step 2>" }
}
```

### 4. A real delivery, the receiving server, then the switch

Laika believes only the `Authentication-Results` header of the receiving server
you name, so name it from **a real delivery**, never from an example or a guess
(D-155 item 4). Until one is named, the switch cannot go on.

1. With the switch still off, send a mail from your own address to a space's
   address. Space settings shows each space's address, with *Copy*.
2. The card's list shows it **dropped `switch_off`** — proof that Brevo reaches
   Laika with the right token — and, beside it, **the servers its
   `Authentication-Results` headers named**, topmost first. The *Receiving
   server* field lists the same under *Seen in recent mail*.
3. **Confirm it is Brevo's own receiving host** before you name it.
   - Send a second mail from **a different provider** (one from Microsoft 365,
     one from Gmail, say). Brevo's receiving server is the one name both
     mails show, topmost.
   - **Never name your own sending provider's server.** Microsoft 365 and
     others stamp `Authentication-Results` on the mail they send, and a server
     a sender's provider wrote is evidence of nothing here.
   - Put the confirmed name into **Receiving server**. Only an owner can.
   - If the mails named no common server, Brevo is not stamping its own
     header. Stop, and do not turn authentication off to get round it; raise
     it with CHIEF.
4. **An owner** flips **Email to tasks on** (an admin cannot), sends the mail
   again, and sees the task.

What turning it on accepts: authentication proves the sender's **domain**, not
the person. Anyone who can send as an address at a member's domain can be
written as any member there (D-155 item 4). *Require authenticated senders*
stays on; only an owner can turn it off.

If the list shows nothing at all, Brevo is not reaching Laika. Check the
webhook URL and the token. A `401` in the server log as
`webhook.received … verified: false` means a wrong token.

### What is dropped, and why

| reason | means |
| --- | --- |
| `unknown_address` | No space has that address. It was mistyped, or replaced with *New address* |
| `unauthenticated` | The receiving server did not vouch for the sender's domain. This is what a forged From looks like |
| `unknown_sender` | Nobody active on the board has that address |
| `not_allowed` | The person cannot create tasks in that space |
| `own_sender`, `auto_reply`, `spam` | The board's own mail, a machine's reply, or spam. Never written, so mail cannot loop |

A dropped mail is never answered. The list keeps the sender's address, never
the subject or the text.

### Turning it off

Flip *Email to tasks on* off: every mail from then on is recorded
`switch_off`. Clearing the domain also turns it off. To cut Brevo off
entirely, press **Make token** and do not give Brevo the new one.

---

## Microsoft 365 people: turning it on

*Photos and profile* and *Leavers* (D-161, SPEC §11.6) ship **off**, on the
Microsoft 365 card under Organisation → Integrations. They read Microsoft
through the calendar's connection, so the app's tenant, client id and secret
are saved there first. Nothing here needs a migration step or an environment
variable, and a board with no file store (`LAIKA_S3_*`) still reads titles and
managers; it only keeps no photos.

1. **Grant `User.Read.All`** (an application permission) to the Entra app,
   with admin consent. *Test connection* on the card lists it among the
   token's permissions once it is granted; without it each run fails
   `not_granted` and reads nobody.
2. **Turn on *Photos and profile*.** It starts a run at once, then every
   hour. Check the counts under *People*: everyone found who should be, and the
   photos fetched. A second run fetches no photo whose Microsoft tag is
   unchanged.
3. **Read the dry run before *Leavers*.** While *Leavers* is off, every run
   lists who it *would* deactivate, and why — an account turned off in
   Microsoft, or one Microsoft no longer has, seen on two runs an hour apart.
   Only someone matched before counts, and they are then followed by their
   Entra id, so a rename is not a leaver; someone whose address now belongs
   to another account is listed to **check by hand** instead. An owner and
   the last admin are never taken.
4. **Turn on *Leavers* last**, after at least one run whose list is right and
   whose breaker did not trip. Turning it on needs *Deactivate people* as well
   as the connection's own grant. More than 3 of the sync's deactivations, or
   more than a tenth of the members, within 24 hours holds the rest and lists
   them as *held* — on a board of fewer than ten members that is every leaver,
   by design. Saving another tenant or app on the card, or disconnecting it,
   switches *Leavers* off again and forgets every Entra id.

Each deactivation is the one People does by hand: tokens revoked, sessions
ended, spaces left, open tasks unassigned, written in the history by the
system with `via: microsoft_directory`; their synced photo and title are
deleted with it. Viewers, and read-only tokens, see people's photos but not
their titles, departments or managers. Reactivating someone is done by hand on
People, as ever — **but while Microsoft still says they have left, the next run
deactivates them again.** Fix the account in Microsoft first, or turn *Leavers*
off for as long as they should stay.

## The frontend as its own resource, on one domain

The default image serves the API and the SPA together. To run the frontend as
a separate resource — the Ksage split on Coolify, 2026-11-17 — build the same
`docker/Dockerfile` twice from **the same commit**:

| Resource | Build target | Port | Routed to it |
| --- | --- | --- | --- |
| the server | default (`runtime`) | 3000 | `/api`, `/mcp`, `/webhooks`, and everything under them |
| the frontend | `web-serve` | 8080 | everything else |

1. **Route by path on one domain, strip-prefix off.** The server reads the full
   path (`/api/v1/…`), so the proxy must pass it unchanged. Keeping one origin
   is what lets sign-in, the session cookie and the CSP's `'self'` work as
   before; `LAIKA_PUBLIC_URL` stays that domain, and so does the store's CORS
   `AllowedOrigins` (Attachments, step 2).
2. **Set `LAIKA_STORAGE_ORIGIN` on the frontend** when attachments are on: the
   origin of the server's `LAIKA_S3_ENDPOINT`. The page's CSP now comes from the
   frontend, so without it the browser refuses uploads to the store and images
   from it. Unset or empty is the attachments-off policy. It is read by nginx,
   not by the server, which is why SPEC §11.7 does not list it.
3. **Check both.** `GET /healthz` on the frontend answers `ok`, and
   `GET /api/v1/health` through the domain answers the server's JSON. An nginx
   404 page there means `/api` was routed to the frontend.

**What backs this.** `server/test/tooling/web-serve.test.ts` renders the
frontend's nginx config as the image does and checks its headers and CSP (with
and without a store), its cache rules and its 404 paths against the server's
own code. The image was built and measured locally on 2026-11-17 (LAI-1308's
log): the SPA document on `/` and `/my-day`, a year's cache on `/assets/`, 404
on `/api/v1/health`, and both CSPs equal to the server's. No test runs the
proxy's path routing; step 3 is how you check it.

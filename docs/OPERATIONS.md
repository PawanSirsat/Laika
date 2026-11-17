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

Put the S3 API (port 3900) behind your TLS proxy at its own name, for example
`https://files.example.com`. **Let the proxy pass bodies as large as
`LAIKA_ATTACHMENT_MAX_BYTES`** — the upload goes through it, not through Laika.

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

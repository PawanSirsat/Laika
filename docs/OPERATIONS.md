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

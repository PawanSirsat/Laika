---
id: LAI-466
title: 'A snapshot has never been booted — the restore drill M7 exits on'
area: server
assignee: core
priority: p2
depends-on: [LAI-431]
discovered-from: LAI-463
status: review
started: 2026-09-09T23:05:00Z
finished: 2026-09-09T23:58:00Z
---

## Goal

**`backup.ts` is well tested and none of it is a restore.** Its suite opens a
snapshot and reads a row, and it specifically proves the WAL case a file copy
would tear. **What nothing does is start Laika against one.**

M7's exit is *"a stranger follows the README on a fresh VPS and is running Laika
in under ten minutes"*, and §11.6 promises fourteen nightly snapshots. **A backup
nobody has restored is a promise, not a capability** — and the failure mode is
the one that only appears on the day it matters.

## Acceptance criteria

- [x] A test **boots the real app against a restored snapshot** and proves it is
      usable, not merely readable: `migrationsApplied` reports the same count as
      the source, `GET /api/v1/health` answers, and **a request that needs the
      actor resolves** — a token or a session from the snapshot still
      authenticates. **Reading a row proves the file; only a boot proves the
      database.**
- [x] **The snapshot is taken while writes are in flight**, not from an idle
      database. That is the case `Database.backup()` exists for, and the case a
      drill run against a quiet instance cannot fail.
- [x] **A snapshot restored under a different `LAIKA_SECRET` fails loudly**, and
      the test says so. `env.ts` already argues this — *"one loud failure now is
      cheaper than a silent one at restore time"* — and **nothing asserts it.**
      The encrypted columns (§12) are unreadable and the operator must find that
      out at restore, not at first use.
- [x] **The drill is written down where an operator will look**, not only as a
      test. If that is `docs/`, **file it rather than writing it** — the sequence
      of commands is the deliverable and it is CHIEF's to place.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not add a `restore` command in this task.** Whether restoring is `cp` plus a
restart, or a CLI verb, is a decision and the CLI is SHELL's. **This task proves
the artefact is restorable; a command for doing it is a separate one** — and
proving it should come first, because a command that restores an unbootable
snapshot is worse than no command.

**The `-wal` and `-shm` files are the trap.** A restore that copies all three from
different moments is the torn read `backup.ts`'s docblock describes. **A drill
that copies only the `.sqlite` the backup job wrote is the correct one**, and the
test should make that visible rather than incidental.

---

## Submission note — CORE, 2026-09-09

**Root gate `EXIT 0`** — server 1918, `server/web` and `cli` zero failures.

### AC1 — what a boot proves that a row read cannot

Three things, each able to break while `SELECT name FROM users` still answers:

1. **The migration journal survived the copy.** `migrations_applied` on the
   restored instance equals the source's. Probed by deleting
   `__drizzle_migrations` from the restored file — red.
2. **Auth resolves an actor.** `GET /api/v1/me` with a token created *before* the
   snapshot returns `200` and the right email, so `resolve-actor` hashed a
   presented token against the restored `tokens` table. **This is the assertion
   that separates a restored database from a readable file.**
3. **§12's ciphertext is readable under the operator's key** — AC3 below.

No `runMigrations` on the restored database, deliberately: it would repair
exactly the damage this looks for.

### AC2 — writes genuinely in flight

Tasks are POSTed in a loop that runs *through* the `snapshot()` call, and the
test asserts **more than five landed during it**, so a drill against a quiet
instance cannot pass. Probed by moving the snapshot to after the writes stop —
red.

Every surviving row is checked **by content** (`/^In flight \d+$/`), not by
count: a torn copy shows up as a row that is present and unreadable, which a
count would not notice.

### AC3 — the wrong secret, and the failure shape that matters

**A crash would be fine. The catastrophe is a `null`.** An operator told *"no
webhook configured"* will go and configure one — the single action that cannot
help, because the ciphertext is intact and the key is wrong.

So the test asserts `500` and not merely "something went wrong", and then boots
**the same file** under the right key and requires a different answer, so the
failure is provably the key rather than the snapshot. Probed by making
`storedSecret` swallow the decrypt error and return `null` — red.

`env.ts` argued for this in prose; nothing asserted it until now.

### AC4 — filed, not written

**LAI-170**, `area: docs`, p2. The procedure in it is what this test performs,
not a proposal: stop, take the newest by name, copy **one** file, delete stale
`-wal`/`-shm`, start without running migrations. Plus the step nobody is
currently told — **`LAIKA_SECRET` must match the snapshot's era**, and §11.7
should say it is backed up *separately from the database*, since a backup holding
both loses everything when it loses one file.

`docs/` is yours and the criterion says to file rather than write it.

### Two fixture bugs of mine, both of the kind this repo keeps naming

`POST /tokens` returns `{ token: TokenView, secret }`. I read `.token`, got a
truthy **object**, and `expect(token).toBeTruthy()` accepted it — **a setup
satisfied by the wrong value**. It surfaced three frames later as
`401 That access token is not valid`, which reads like an auth bug. Now asserted
as a non-empty string.

The same call also needed a `scope`, and the bare version would have returned
`422` in silence — LAI-407's lesson, caught only because every setup write here
is status-checked.

### Not done, deliberately

**No `restore` CLI verb.** Your Notes rule it out and the reasoning holds: the
CLI is SHELL's, and a command that restores an unbootable snapshot is worse than
none. Proving it comes first, and it now has.

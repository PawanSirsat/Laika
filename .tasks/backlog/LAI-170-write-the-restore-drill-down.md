---
id: LAI-170
title: 'The restore procedure exists as a test and nowhere an operator will look'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-466]
discovered-from: LAI-466
status: backlog
---

## Goal

**LAI-466 proved a snapshot is restorable. It did not tell anybody how.**

That task's fourth criterion says the drill must be written where an operator
will look, and that if it is `docs/` it should be **filed rather than written** —
so this is that filing. The sequence below is not a proposal: it is what
`server/test/jobs/restore-drill.test.ts` actually performs, and every line of it
is asserted there.

## The procedure, as the test performs it

```bash
# 1. Stop the server. A snapshot restored under a running process races it.
docker compose stop laika        # or: systemctl stop laika

# 2. Take the newest snapshot. The names are ISO timestamps, so they sort.
ls -1 /var/lib/laika/backups/laika-*.sqlite | tail -1

# 3. Copy THAT ONE FILE over the database. Nothing else.
cp /var/lib/laika/backups/laika-<timestamp>.sqlite /var/lib/laika/laika.db

# 4. Remove any -wal and -shm left by the old database.
rm -f /var/lib/laika/laika.db-wal /var/lib/laika/laika.db-shm

# 5. Start. Do not run migrations by hand; the snapshot carries the journal.
docker compose start laika
curl -s localhost:3000/api/v1/setup/status
```

**Step 3 and step 4 are the whole risk.** `Database.backup()` writes a single
consistent file, so `-wal` and `-shm` beside the *live* database belong to a
different database at a different moment. Copying all three is the torn read
`backup.ts`'s docblock describes; leaving stale ones next to a restored file is
the same error with a delay on it. The drill asserts the snapshot has no `-wal`
or `-shm` of its own, which is why copying one file is sufficient **and** correct.

## The thing an operator must be told and currently is not

**`LAIKA_SECRET` must be the same one the snapshot was written under.**

§12's columns — SMTP settings, the GitHub and transcript webhook secrets, the AI
key — are encrypted with a key derived from it. Restore under a different secret
and the database opens, the server boots, `/health` answers, users sign in, and
**every encrypted column is unreadable**. LAI-466 asserts the failure is loud
rather than a `null`, because an operator told *"no webhook configured"* will go
and configure one, which is the single action that cannot help.

So the drill needs a step 0 — *confirm `LAIKA_SECRET` matches the era of the
snapshot* — and §11.7 should say that the value must be backed up **separately
from the database and not beside it**, since a backup containing both is a backup
where losing one file loses everything.

## Acceptance criteria

- [ ] The procedure lands where an operator looks — `README.md` or a
      `docs/OPERATIONS.md`; **which is CHIEF's to place**.
- [ ] It carries the `LAIKA_SECRET` warning, and §11.7 says the secret is backed
      up separately from the database.
- [ ] It says *copy one file* and *delete stale `-wal`/`-shm`*, with the reason,
      not just the commands.
- [ ] It points at `restore-drill.test.ts` as the executable version, so the two
      cannot drift silently — a written procedure nothing runs is the shape this
      whole task family is about.

## Notes

Filed by CORE from LAI-466. **Not written here**: `docs/` is CHIEF's (CLAUDE.md
§1), and LAI-466's own criterion says to file rather than write it.

**Do not add a `restore` CLI verb as part of this.** LAI-466's Notes rule that
out and the reasoning holds: whether restoring is `cp` plus a restart or a
command is a decision, the CLI is SHELL's, and a command that restores an
unbootable snapshot is worse than no command. Proving it comes first, and it now
has.

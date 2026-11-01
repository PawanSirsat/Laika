# Agent identities and hand-off: migration and rollback rehearsal

LAI-560 (board LAIKA-812), part of LAI-532 / LAIKA-785. Run on **2026-10-31,
16:30 – 16:45 UTC** on Belka, by CHIEF (polly), from branch
`LAI-560-rollout-evidence-pack` at `origin/master` **`1fe55ff1`**.

**What this is not.** It is **not** a rehearsal on a copy of production data.
The task's scope asks for one; this run was told not to touch production, so it
used a synthetic database built at the pre-programme schema. A rehearsal on a
production copy is listed as **UNVERIFIED** in the evidence pack
(`docs/acceptance/LAI-532-evidence-pack.md`).

Nothing here touched production, port 3000 or the shared demo instance. The
servers ran on **3471** and **3472**, each with its own throwaway data
directory under the session scratchpad. Both were stopped by their listening
PID and every database file was deleted afterwards (§ *Clean-up*).

## Result

| # | Step | Result |
| --- | --- | --- |
| 1 | Build a database at **0060** (the last migration before the programme) and seed it with a legacy token and historical activity | Done |
| 2 | Take an operator backup with SQLite's online backup API | Done, sha256 `c2a10b84…5bc30` |
| 3 | Boot today's server (`1fe55ff1`) on it: **0061 – 0069 apply forward** | **PASS**: 60 → 69 migrations, `integrity_check` ok, no foreign-key violations |
| 4 | The server's own pre-migration snapshot is written before it migrates | **PASS**: `backups/pre-migration-2026-10-31T16-38-23-226Z.sqlite` |
| 5 | Historical rows unchanged by the forward migration | **PASS**: activity, token and task fingerprints identical before and after; `activity.agent_id` and `tokens.agent_id` null on every old row |
| 6 | The legacy token works after the forward migration (REST and MCP, read and write) | **PASS**: `GET /me`, task list, project activity, context revisions; `PATCH /tasks/:id`; MCP `laika_whoami`, `add_comment`, `start_working` |
| 7 | **Rollback**: stop, restore the step-2 backup by copying one file and deleting `-wal`/`-shm` (`docs/OPERATIONS.md` § *Restoring from a backup*) | **PASS**: the restored file's sha256 equals the backup's; 60 migrations; no programme table left |
| 8 | Boot the **pre-programme code** (`71dd4217`) on the restored database: legacy token and historical activity work | **PASS**: `GET /me`, project activity (all five historical project rows), task list, `PATCH /tasks/:id`, MCP `laika_whoami` |
| 9 | What a rollback loses | Everything written between the deploy and the restore: the title edit, the comment and the claim of step 6 are gone after step 8, as expected |
| 10 | **Image-only rollback** (CI's automatic one): pre-programme code on the **migrated** 0069 database, without a restore | Boots; legacy token reads and writes work on this seed. See *What step 10 does not show* |

## The database

Built with today's migrator and a copy of `server/src/db/migrations` whose
journal stops at `0060_time_entry_kinds_design`, then seeded with **raw SQL
only**, so nothing in the seed depends on today's Drizzle schema:

- one org, its owner, one private project with the owner as lead, one status
  per category;
- three tasks (`REH-1` web, `REH-2` mcp, `REH-3` done);
- one **legacy token** (`full`, no expiry, no pin): a synthetic `lai_` secret
  generated for the run, stored only as its sha256, deleted with the database;
- six **historical activity rows**: `org.created`, `project.created`, two
  `task.created` (one by the user, one by the legacy token as
  `actor_kind: agent`), one `task.status_changed` by the legacy token, one
  system `heartbeat.pruned`.

## Fingerprints

`fingerprint.ts` (appendix) hashes the columns that existed at 0060, so the
same hash before and after means those rows did not change.

| | at 0060 (seeded) | after 0069 (step 3) | restored (step 7) |
| --- | --- | --- | --- |
| `__drizzle_migrations` rows | 60 | **69** | 60 |
| activity rows | 6 | 6 | 6 |
| historical activity hash | `6ce8449356491f2f` | `6ce8449356491f2f` | `6ce8449356491f2f` |
| historical rows with an `agent_id` | column absent | **0** | column absent |
| legacy token hash | `5aa4b71749e0076c` | `5aa4b71749e0076c` | `5aa4b71749e0076c` |
| legacy token `agent_id` | column absent | **null** | column absent |
| tasks hash | `e5bbe9790a013bb4` | `e5bbe9790a013bb4` | `e5bbe9790a013bb4` |
| programme tables present | none | all 15 | none |
| `pragma integrity_check` | ok | ok | ok |
| `pragma foreign_key_check` rows | 0 | 0 | 0 |

The 15 programme tables: `agents`, `agent_project_grants`, `agent_sessions`,
`task_claims`, `recognised_agent_devices`, `project_context_revisions`,
`agent_session_context_deliveries`, `task_checkpoints`, `checkpoint_refs`,
`checkpoint_ref_transitions`, `agent_checkpoint_consents`, `handoff_offers`,
`project_handoff_policies`, `agent_events`, `agent_event_deliveries`.

`projects.context_md` came through as **revision 1** of
`project_context_revisions` (0066), 39 characters, `author_id` null.

## Transcript

Responses are cut to their first line or to the fields that matter. The token
is never printed.

### Step 3 – 4: forward

```
$ PORT=3471 HOST=127.0.0.1 LAIKA_DATA_DIR=<scratch>/data LAIKA_SECRET=<test> \
  LAIKA_PUBLIC_URL=http://127.0.0.1:3471 LAIKA_PUBLIC_DIR=<scratch>/public npx tsx src/index.ts
GET /api/v1/health → {"status":"ok","version":"0.1.0","uptime_ms":1718}
{"event":"server.listening","port":3471,"pid":70142,...}
$ ls <scratch>/data/backups
pre-migration-2026-10-31T16-38-23-226Z.sqlite
```

`uptime_ms` 1718 on a process started a second and a half earlier: our
server, not someone else's on the port (CLAUDE.md §4.3).

### Step 6: the legacy token after the forward migration

```
## GET /me
{"id":"u1","email":"owner@rehearsal.test","name":"Rehearsal Owner","org_role":"owner","is_active":true,"memberships":[{"project_id":"p1","role":"lead"}]}
[HTTP 200]
## GET /projects/rehearsal/tasks
[{"key":"REH-1",...,"selected_agent":null,"created_via":"web"},{"key":"REH-2",...,"created_via":"mcp"},{"key":"REH-3","status":"done",...}]
[HTTP 200]
## GET /projects/rehearsal/activity
[{"id":"a6","type":"heartbeat.pruned","actor_kind":"system","agent":null},
 {"id":"a5","type":"task.status_changed","actor_kind":"agent","agent":null},
 {"id":"a4","type":"task.created","actor_kind":"agent","agent":null},
 {"id":"a3","type":"task.created","actor_kind":"user","agent":null},
 {"id":"a2","type":"project.created","actor_kind":"user","agent":null}]
[HTTP 200]
## GET /projects/rehearsal/context/revisions
[{"revision":1,"length":39,"author_id":null,"agent_id":null,"created_at":1790812800000}]
[HTTP 200]
## PATCH /tasks/k1 (legacy token write)
{"id":"k1","key":"REH-1",...,"title":"Pre-programme task 1 (edited after migration by the legacy token)",...}
[HTTP 200]
## MCP add_comment on REH-1
{"result":{"content":[{"type":"text","text":"Commented on the task, just now."}],...}
[HTTP 200]
## MCP start_working REH-2 (legacy token claim)
{"result":{"content":[{"type":"text","text":"Claimed `REH-2` — now in_progress (in progress)."}],...}
[HTTP 200]
## MCP laika_whoami
{"result":{"content":[{"type":"text","text":"{\"user_id\":\"u1\",...,\"token_scope\":\"full\",\"agent\":null,...
[HTTP 200]
```

The three writes were recorded with `actor_kind: agent`, `actor_token_id: t1`
and `agent_id: null`, as D-114 item 6 says a legacy token's rows are:

```
[{"type":"task.updated","actor_kind":"agent","actor_token_id":"t1","agent_id":null},
 {"type":"comment.added","actor_kind":"agent","actor_token_id":"t1","agent_id":null},
 {"type":"task.status_changed","actor_kind":"agent","actor_token_id":"t1","agent_id":null}]
```

The first `PATCH` was sent to `/tasks/REH-1` and answered `404 not_found`:
the REST route takes the task id, not the key. That was the rehearsal's
mistake, not the server's; the retry used `k1`.

### Step 7: restore

```
$ kill 70142                       # the PID listening on 3471, nothing else
$ cp pre-deploy.sqlite data/laika.db && rm -f data/laika.db-wal data/laika.db-shm
$ shasum -a 256 data/laika.db pre-deploy.sqlite
   2 c2a10b84c62a432c3acbda564f2bba42dcf1cd00923533d18f0645ec1fe5bc30
```

### Step 8: pre-programme code on the restored database

`git archive 71dd4217 server`, run with this worktree's `node_modules`
(`server/package.json` and `pnpm-lock.yaml` do not differ between `71dd4217`
and `1fe55ff1`). No migration was pending, so no snapshot was written.

```
GET /api/v1/health → {"status":"ok","version":"0.1.0","uptime_ms":2007}
## GET /me
{"id":"u1",...,"memberships":[{"project_id":"p1","role":"lead"}]}
[HTTP 200]
## GET /projects/rehearsal/activity
[{"id":"a6","type":"heartbeat.pruned","actor_kind":"system"},{"id":"a5","type":"task.status_changed","actor_kind":"agent"},
 {"id":"a4","type":"task.created","actor_kind":"agent"},{"id":"a3","type":"task.created","actor_kind":"user"},
 {"id":"a2","type":"project.created","actor_kind":"user"}]
## GET /projects/rehearsal/tasks (titles)
[["REH-1","Pre-programme task 1","todo"],["REH-2","Pre-programme task 2","todo"],["REH-3","Pre-programme task 3","done"]]
## PATCH /tasks/k1 (legacy token write on the rolled-back stack)
{"id":"k1","key":"REH-1",...,"title":"Pre-programme task 1 (edited after rollback)",...}
[HTTP 200]
## MCP laika_whoami
{"result":{"content":[{"type":"text","text":"{\"user_id\":\"u1\",...,\"token_scope\":\"full\"...
[HTTP 200]
```

`REH-1`'s title and `REH-2`'s status are the pre-deploy values: the edit,
comment and claim made in step 6 went with the restore (step 9).

### Step 10: image-only rollback

The same pre-programme code, on a copy of the database as it stood after
step 6 (0069, with the claim on `REH-2` live).

```
GET /api/v1/health → {"status":"ok","version":"0.1.0","uptime_ms":2011}
## GET /projects/rehearsal/activity
{"data":[{"id":"01M69D8MW9MN0CPZQH9RZ142YH","seq":9,"type":"task.status_changed",...,"actor_token_id":"t1",...
[HTTP 200]
## GET /projects/rehearsal/tasks
[HTTP 200]
## PATCH /tasks/k3
{"id":"k3",...,"title":"edited by old code on new schema",...}
[HTTP 200]
## PATCH /tasks/k2 (claimed by the legacy token after migration)
{"id":"k2",...,"title":"x",...,"status":"i...
[HTTP 200]
```

No `error` or `warn` line in that server's log.

#### What step 10 does not show

- **It had no registered agent in it.** Old code knows nothing of `agents`,
  grants or `tokens.agent_id`: at `71dd4217`, `git grep -E
  'agent_id|agentId|agents\b'` finds nothing in `server/src/auth` or
  `server/src/policy`, and its `tokens` table has no agent column. So an
  agent's token would be resolved as its owner's ordinary token, narrowed
  only by the token's own scope and project pin: **the per-project grant
  would no longer narrow it.** That is an inference from the code; it was not
  run.
- **The live claim on `REH-2` was ignored**: old code wrote to the task
  without a claim generation. Fencing does not exist below 0061.
- Rows written by old code carry no `agent_id` and no session snapshot.

So an image-only rollback past 0061 keeps legacy tokens working **and, by
that inference, widens every registered agent's token back to what its
scope and pin alone allow**. The
operator guide's rollback section says what to do about that.

## Clean-up

```
$ kill <pid listening on 3472>
$ lsof -nP -tiTCP:3471,3472 -sTCP:LISTEN || echo 'ports 3471/3472 closed'
ports 3471/3472 closed
$ ps -Ao pid,command | grep -E 'tsx.*src/index.ts' | grep -v grep || echo 'no rehearsal server processes'
no rehearsal server processes
$ rm -rf data imgonly old migrations-0060 public pre-deploy.sqlite post-migration-copy.db legacy-token.txt
```

## Appendix: the fingerprint

```ts
// What must survive: the legacy token row and every pre-existing activity row,
// compared on the columns that existed at 0060.
const h = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const act = d.prepare(`select id,org_id,project_id,task_id,actor_id,actor_kind,actor_token_id,
  type,payload_json,created_at from activity where id in ('a1','a2','a3','a4','a5','a6') order by id`).all();
const tok = d.prepare(`select id,user_id,name,prefix,token_hash,scope,project_ids_json,expires_at,
  revoked_at,created_at from tokens where id='t1'`).get();
const tasks = d.prepare(`select id,number,title,status,status_id,created_by,created_via,created_at
  from tasks order by id`).all();
// plus: count(__drizzle_migrations), count(activity), agent_id where the column exists,
// the programme tables present, pragma integrity_check, pragma foreign_key_check.
```

The seed is the raw `INSERT`s described under *The database*, run after
`runMigrations(db, { migrationsFolder: <copy with the journal cut at 0060> })`.

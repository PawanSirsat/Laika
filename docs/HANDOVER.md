# Laika — handover

Written 2026-10-08 by CHIEF (a Claude Code session) for the agent taking over,
which may run on a different model in a different harness. Every identifier
below was checked against the live AWS account, the repository or the running
server on that date. Where something is a recommendation rather than a fact,
it says so.

Read `AGENTS.md` first. It has the reading order and the rules that are not
optional. This file is the detail.

---

## 1. What Laika is

A self-hosted project board, like a small Jira, where people and coding
agents share one source of truth. People use the web app. Agents use the MCP
endpoint, `/mcp`, with personal access tokens, and the Claude Code plugin in
`plugin/`. Everything an actor does lands in one append-only activity log,
which feeds the activity feed, the dashboard and the live stream (SSE).

| Part | Where | What |
| --- | --- | --- |
| API, auth, policy, MCP | `server/src/` | Hono, Better Auth, `@modelcontextprotocol/sdk`, SQLite via `better-sqlite3` + Drizzle |
| Web app | `server/web/` | React 19 + Vite, no UI framework, hand-written CSS with design tokens |
| CLI | `cli/` | the `laika` command |
| Agent plugin | `plugin/` | Claude Code plugin: hooks, skills, commands, the MCP config |
| Container | `docker/` | the production `Dockerfile`, compose file, AWS template |
| Specification | `docs/SPEC.md` | what Laika must do; screens in §11.4 |
| Decisions | `docs/DECISIONS.md` | why; append-only, `D-001` to `D-073` at handover |

---

## 2. Where everything runs

All production infrastructure is in AWS account **`926583575159`**, region
**`us-east-1`**, defined in two CloudFormation stacks. Read the templates
before changing anything; change the infrastructure through them, not by hand.

| Thing | Identifier | Defined in |
| --- | --- | --- |
| Stack: the server | `laika` | `docker/aws/laika-ec2.yaml` |
| Stack: the deploy role | `laika-github-deploy` | `infra/github-deploy-role.yml` |
| Instance | `i-0b2fa45c15e1b10cf` — t4g.micro (2 vCPU, 1 GiB), arm64, Amazon Linux 2023, 15 GB encrypted gp3 | `laika` |
| Public address | an Elastic IP, stable across restarts; HTTP only, no TLS yet. **Not written in this public repo** (LAI-627): it is the stack's `Url` output — `aws cloudformation describe-stacks --stack-name laika --query "Stacks[0].Outputs[?OutputKey=='Url'].OutputValue" --output text` — and in your local `.env.agent` | `laika` |
| Inbound | port 80 only. **No SSH**: shell access is SSM Session Manager | `laika` |
| Container | name `laika`, `--restart unless-stopped`, `-p 80:3000`, `-v /data:/data`, `--env-file /opt/laika/.env` | user data, then the deploy script |
| Runtime settings | `/opt/laika/.env`, mode 600, written at first boot: `NODE_ENV`, `PORT`, `LAIKA_DB_PATH`, `LAIKA_SECRET`, `LAIKA_PUBLIC_URL` | `laika` user data |
| App secret | Secrets Manager `LaikaSecret-sJ4X5Zj0paxP-…` — generated inside AWS, never seen by a person; the instance role may read it | `laika` |
| Database | `/data/laika.db` — SQLite, WAL mode | — |
| Backups | `/data/backups/` — nightly snapshots (newest 14, SPEC §11.6) and a snapshot before every migration. **On the same disk** — see §8 | the server's jobs |
| Image registry | ECR `926583575159.dkr.ecr.us-east-1.amazonaws.com/laika` — tags `latest` and `sha-<commit>` | — |
| Deploy role | `arn:aws:iam::926583575159:role/laika-github-deploy` | `laika-github-deploy` |
| Health | `GET $LAIKA_URL/api/v1/health` returns `{"status":"ok","version":…,"uptime_ms":…}` | — |

To find the secret's full ARN: `aws cloudformation describe-stack-resources
--stack-name laika --query "StackResources[?LogicalResourceId=='LaikaSecret']"`.
You never need its value to develop or deploy.

**Restoring the database** is in `docs/OPERATIONS.md`. Read step 0 there: a
restore under a different `LAIKA_SECRET` looks like it worked and silently
loses every encrypted setting.

---

## 3. How a change reaches production

**A push to `origin/master` is a release** (D-073, `.github/workflows/deploy.yml`):

1. **Gate** on `ubuntu-latest`: `pnpm install --frozen-lockfile`, Chromium for
   the browser tests, then `pnpm lint`, `pnpm format`, `pnpm test` as three
   steps. This runs on **every** push, on every branch.
2. **Build**, on master only, on GitHub's `ubuntu-24.04-arm` runner: the arm64
   image from `docker/Dockerfile`, pushed to ECR as `sha-<commit>`.
3. **Deploy**, on master only, after both pass:
   1. `latest` in ECR is pointed at the new digest. The image is retagged, not
      rebuilt, so `latest` is exactly what the gate approved.
   2. `.github/deploy/deploy.sh` sends `.github/deploy/host-restart.sh` to the
      instance over SSM. That script pulls the image, replaces the container
      by **exact digest**, and waits up to 90 seconds for health.
   3. The runner then checks the instance runs that digest, is freshly healthy
      from outside (`uptime_ms` under five minutes), and serves the web app.
4. **Rollback.** If any check fails, `latest` is pointed back at the image it
   replaced, the instance is restarted on it, and the run goes red.

Deploys queue: one at a time, and the newest waiting commit wins. A deploy
restarts the container, so expect a few seconds of downtime.

**Old images are removed on every successful deploy** (LAI-720). Once the new
container is healthy, the instance removes every image but the running one,
and the workflow deletes every ECR image but the live one, keeping an index's
parts. Nothing is removed on a failed deploy, so the image a rollback needs —
the last successful one — is always still there.

GitHub reaches AWS through **OIDC**, with no stored keys. The role trusts only
`repo:PawanSirsat@48860105/Laika@1344153084:ref:refs/heads/master`. This
repository uses GitHub's *immutable* subject form, owner and repo with numeric
ids. A trust written as `repo:PawanSirsat/Laika:…` refuses every run; that was
the first deploy's failure.

**Watching:** `gh run list --branch master`, `gh run watch <id> --exit-status`,
or the repository's Actions tab.

**When a run is red:**
- **Red gate:** nothing deployed; production is on the last good image. Read
  the failing test (`gh run view <id> --log-failed`).
  - **If it is one of the known flakes, rerun:** `gh run rerun <id> --failed`.
    See LAI-715.
  - **Otherwise it is a real failure.** Fix it before anything else, because
    nothing after it deploys.
- **Red build:** usually AWS access, the OIDC trust or ECR. The deploy job did
  not run.
- **Red deploy:** read the "Roll back" step. Production should be back on the
  previous digest; confirm with the health check.

**Manual fallback, only when Actions itself is down.** Each step is gated on
the one before it; never join them with `;`.
1. On a machine with an AWS session, build and push:
   `docker buildx build --platform linux/arm64 -f docker/Dockerfile -t <ecr>/laika:latest --push --metadata-file /tmp/meta.json .`
2. Compare `containerimage.digest` from `/tmp/meta.json` with
   `aws ecr describe-images --repository-name laika --image-ids imageTag=latest`.
3. Run `.github/deploy/deploy.sh <ecr>/laika@<digest>` with `INSTANCE_ID`
   and `AWS_REGION` set.

---

## 4. How development works

### Setup

```bash
git clone https://github.com/PawanSirsat/Laika.git && cd Laika
corepack enable                     # pnpm 10.32.1, pinned in package.json
pnpm install --frozen-lockfile      # Node 22 (.nvmrc)
pnpm --filter @laika/web exec playwright install chromium   # browser tests
```

To run it locally, the server refuses to start without a secret of at least 32
characters:

```bash
export LAIKA_SECRET="$(openssl rand -base64 48)"   # local only; never reuse production's
pnpm dev     # server on :3000 (tsx watch) + web on :5173 (Vite, proxies /api to :3000)
```

Outside production the database falls back to `./data/laika.db`. First boot
shows a setup screen that creates the organisation and the first owner.

### The gate — before every push, and before moving a task to review

```bash
pnpm test   > /tmp/gate.txt 2>&1; echo "TEST $?"
pnpm lint   > /tmp/lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/fmt.txt  2>&1; echo "FMT  $?"
grep -E "Unhandled|Errors|Failed|not ok|✗" /tmp/gate.txt
```

All three must print `0`. Never pipe them; in zsh, `$?` after a pipe is the
last command's status. `pnpm format:fix` rewrites only the files your branch
changed. The suites are server (vitest), web (`node --test` plus Playwright
browser tests that build the app and stub `/api`), and cli (`node --test`).

### The task protocol, in short (the full version is `CLAUDE.md` §2)

1. **No task file, no work.**
   - Tasks live in `.tasks/backlog/`, `in-progress/`, `review/` and `done/`.
     `TEMPLATE.md` is the shape.
   - **Ids come from blocks.** CHIEF has `LAI-700`–`799`, which is in use,
     CORE has `800`–`899`, SHELL has `900`–`999`.
   - **Check before filing.** Run the id sweep in `CLAUDE.md` §3, both halves,
     before every filing.
2. **Claim by moving the file.** `git mv` it to `in-progress/`, then edit its
   frontmatter, and commit both together. Finishing works the same way: move
   it first, then edit. Verify the result with `git show HEAD:<file>`.
3. **Discovered work** becomes a new task with `discovered-from:`. It is never
   done silently inside the current one.
4. **Logs.** Append to `logs/<session>-<YYYY-MM-DD>.md` after every task, in the
   format in `.claude/skills/laika-logging/SKILL.md`.
5. **Decisions** are appended to `docs/DECISIONS.md` as `D-0NN`. Never edit an
   old one; supersede it with a new one.

### Sessions, branches and ownership

The project was built by three Claude Code sessions in parallel worktrees of
one repository:

| Session | Owns | Branch |
| --- | --- | --- |
| **CHIEF** | `docs/`, `.tasks/`, `CLAUDE.md`, merging and review | `master` |
| **CORE** | `server/` except `server/web/` | `core` |
| **SHELL** | `server/web/`, `plugin/`, `cli/`, `docker/` | `shell` |

**If you are one agent doing all of it,** work the way CHIEF did once the owner
asked for work directly:
1. File a task that names the files it touches.
2. Cut a branch from `master`, in its own worktree if several agents share the
   machine.
3. Build it, test it first, and run the gate.
4. Move the task to review, merge with `--no-ff` into `master`, accept it, and
   log it.
5. Gate on `master`, then push. The push deploys.
6. Remove the temporary worktree and its branch in the same sitting: check
   `status --porcelain` is empty, run `git worktree remove` without `--force`,
   then `git branch -d`, as `CLAUDE.md` §4.2 shows. Only `Laika/` and
   `Laika-shell/` are permanent. As of 2026-10-08, `Laika-shell/` holds SHELL's
   unmerged LAI-627 work and must not be removed. `Laika-core/` was removed
   that day; `git worktree add ../Laika-core core` brings it back.

Note in the task file that the change was made on the owner's direct
instruction.

### Commits

- **Format:** `type(area): summary [LAI-xxx]`, one logical change per commit.
- **Identity:** `Pawan Sirsat <48860105+PawanSirsat@users.noreply.github.com>`,
  set in the repo's local git config.
- **Staging:** stage explicit paths, never `git add -A`.
- **Others' commits:** never force-push, amend or rebase them.

### Lessons that cost real time — know them before they cost you any

- **`git mv` stages the pre-edit content.** Move first, edit second, and read
  the result back from the commit.
- **A swap that is interrupted stays swapped.** Any "swap the old file in, run
  the tests, restore" check must restore in a `trap`. After any interrupted
  command, checksum the files it touched.
- **Never `head` a census.** A truncated grep looks exactly like a complete one.
- **Kill your own server by listening port only:** `lsof -ti tcp:PORT
  -sTCP:LISTEN`. A bare `lsof -ti tcp:PORT` also returns its clients.
- **Check the instance you're talking to.** A `/health` that answers may be
  another process on that port; `uptime_ms` tells you whether it is yours.
- **Grep the live bundle as bytes.** Use `LC_ALL=C grep`, and include a
  positive control. The minifier writes string literals as template literals
  (backticks), not quotes.

---

## 5. Access and credentials

**No secret is written in this repository, and none may be.** It is public.
`docs/agent.env.example` lists every setting with its non-secret value, or
with where the secret lives. Copy it to a gitignored `.env.agent` and fill in
only what you have been given.

| Credential | Who holds it now | How a new agent gets access |
| --- | --- | --- |
| GitHub push to `PawanSirsat/Laika` | the owner's `gh` login | The owner adds the agent's own GitHub account as a collaborator, or creates a **fine-grained token** for this repository only (Contents: read/write, Actions: read/write). Never the owner's own token. |
| Deploying | GitHub Actions, through OIDC | Nothing to hand over. Pushing to `master` deploys. |
| AWS, for infrastructure and break-glass only | the owner, by browser `aws login --profile laika` (root-account credentials, a session that expires within a day) | **Recommended:** the owner creates an IAM Identity Center user, or a role, for the agent with only what it needs — SSM on the instance, read access to ECR and CloudFormation. Normal development needs no AWS access at all. |
| `LAIKA_SECRET` (production) | Secrets Manager, read by the instance at boot | Not needed for development. Never copy it out; never reuse it locally. |
| Laika itself: web login | each person's account on the board | The owner invites the agent's operator from the Organisation screen. |
| Laika itself: MCP and API, for agents | a personal access token per agent, `lai_<40 chars>`, minted in **Settings → Tokens**, shown once | The owner, or the agent's own Laika account, mints one; set `LAIKA_URL` (the production address, §2) and `LAIKA_TOKEN` in the harness's environment. The endpoint is `${LAIKA_URL}/mcp`. |

If a credential is ever committed by mistake: revoke it first (GitHub token
settings, Laika's Tokens screen, or AWS), then remove it from history. The
order matters; removing it from history does not un-leak it.

---

## 6. Operating production safely

**Health:**

```bash
curl -s "$LAIKA_URL/api/v1/health"
```

**A shell on the instance**, with an AWS session:

```bash
aws ssm start-session --target i-0b2fa45c15e1b10cf --profile laika --region us-east-1
```

Use it only for things the pipeline cannot do.

**Reading the production database**, read-only:
1. Base64 a small Node script and send it with `AWS-RunShellScript`.
2. `docker cp` it into the `laika` container, then
   `docker exec laika node /tmp/script.js`.
3. Inside the script, require `/app/server/node_modules/better-sqlite3` and
   open `/data/laika.db` with `{ readonly: true }`.
4. Delete the script afterwards with `docker exec -u root laika rm -f …`. The
   app user cannot.

**Changing production data, only on the owner's explicit request:**
1. Read first, read-only.
2. In one guarded script:
   - assert the exact before-state;
   - take `await db.backup('/data/laika-backup-<ts>.db')`;
   - make the change in a single immediate transaction that checks the number
     of rows changed;
   - print the after-state.
3. Record it in the day's log, because no activity row is written. Open
   browsers need a reload.

**Checking what is live:**
1. Fetch `/`.
2. Fetch each `assets/*.js` it references.
3. Run `LC_ALL=C grep` for a string your change added, plus one that should be
   there anyway.

---

## 7. State at handover

**Live on production:** master as of 2026-10-08, deployed by the pipeline. It
includes:
- the dashboard redesign, done the Jira way (LAI-711, D-072);
- the board opening on the active sprint (LAI-713);
- cards gliding and others' changes glowing (LAI-708);
- in-place refresh (LAI-707);
- priority icons (LAI-705);
- subtasks (LAI-492–495);
- automatic deploys (LAI-714).

**On the way out:** this handover, LAI-716.

**Data fix:** OnRoute's Done column was restored by a direct, guarded
database fix on 2026-10-07. Recorded in `logs/chief-2026-10-07.md`.

---

## 8. Known issues and open work

| What | Status |
| --- | --- |
| **Backups live on the instance's only disk.** If the volume is lost, so are all the snapshots. | Not filed yet. Recommended: nightly copy of `/data/backups` to S3, or EBS snapshots through Data Lifecycle Manager, defined in CloudFormation. |
| Browser tests occasionally flaky on GitHub runners; a push may need `gh run rerun --failed` before it deploys | **LAI-715**, p1 |
| SPEC §6.4 promises `/metrics?window=` with "stuck" and "WIP by user"; the server takes `?since=` and returns neither | **LAI-712**, p3 |
| OnRoute's **TO DO** column has no drop target (`is_primary = 0`) since 2026-09-28, so dropping a card into it may do nothing | Reported to the owner, not filed |
| Column settings: ticking a status that empties another column hides that column with no confirmation; the warnings show under every unticked status; the "Give done a column before taking review" error is unclear; there is no way back to a hidden empty column | Proposed to the owner, not filed |
| No HTTPS and no domain: the site is plain HTTP on the IP; agents' `LAIKA_URL` would change if a domain is added | Owner's decision |
| Fifteen SHELL tasks from September have sat in `.tasks/review/` unaccepted (LAI-266, 290–299, 600–609) | Needs triage: review and accept, or send back |
| The owner's Mac runs Spotlight and Defender hard enough (load average ~30) to time out the boot test in `server/test/tooling/build.test.ts` during a full local gate | Machine settings; rerun passes |
| Suggested dashboard additions, offered and not built: sprint progress, created-versus-resolved, an overdue list, agents working now, a sprint filter | Owner's call |

---

## 9. Working with the owner

- **Who:** Pawan Sirsat, GitHub `PawanSirsat`.
- **How they ask:** short messages with screenshots of the live board, often
  quickly typed. Read the screenshot as carefully as the words.
- **What they expect:** the thing done, merged and live. Since D-073 a push to
  master does that. Say plainly what is live, what is merged but not live, and
  what you did not verify.
- **Products they reference:** Jira for board and dashboard conventions. When
  they say "like Jira", look at how Jira actually does it.
- **Production data:** never change it without their explicit request. When
  you do, back up first and say exactly what changed.

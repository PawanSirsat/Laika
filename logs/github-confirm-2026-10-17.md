# github-confirm — 2026-10-17

The single builder for LAI-753 and LAI-766 on the owner's direct instruction
(through the orchestrator), branch `build-github-confirm`, worktree
`Laika-github-confirm`, cut from `master` `c511c602` and merged with `master`
`530138d7` before the gate. Not pushed, not merged. No local server was
started; no port used.

## 2026-10-17T11:03:30Z — LAI-753, LAI-766

**What changed**
- server/src/services/orgs.ts, http/routes/orgs.ts, app.ts —
  `POST`/`DELETE /api/v1/org/github-webhook`: Laika makes the secret, stores
  it encrypted under `github_webhook_secret`, answers it once; `GET /org`
  carries `github_webhook { configured, payload_url }`
- server/src/policy/actions.ts, can.ts — *Configure webhooks* is session only
- server/src/services/github-proof.ts (new) — the 30-day record of commits,
  pull requests and CI results, and `confirmRound` / `reconcileProof`
- server/src/services/webhooks.ts, http/routes/webhooks.ts — `push` stores
  repo, branch, default_branch, count, shas, forced (default branch
  included, no author); `pull_request` records the pull request and its
  head; `check_run`, `workflow_run`, `check_suite` handled; a merge on a task
  already in review answers 200; four retry comments corrected; pruning on
  each delivery
- server/src/services/rounds.ts — a finish is checked against what GitHub
  already said; round views carry `pull_request.merged` and `ci`
- server/src/mcp/read-tools.ts — `get_task_context` shows states, *merged*
  and the CI line
- server/src/db/schema.ts, enums.ts, migrations/0034_github_confirm.sql —
  four new tables, nothing altered
- server/web/src/routes/screens/organisation/GithubWebhookSection.tsx (new),
  OrganisationScreen.tsx, organisation.css, api/org.ts — the card
- server/web/src/routes/screens/task/EvidenceSection.tsx, evidence.css,
  review/ReviewScreen.tsx, review.css, api/review.ts — grey/green/red, the CI
  line, *merged*, the CI filters and chip
- server/web/src/api/activity.ts, board/TaskDetailPanel.tsx — the Changes
  tab reads what a push stored
- tests: server/test/http/routes/github-proof.test.ts (new, signed
  fixtures), server/test/services/github-proof.test.ts (new),
  server/web/test/browser/github-confirm.test.ts (new); updated
  webhooks.test.ts, schema.test.ts, schema-spec-drift.test.ts,
  view-type-drift.test.ts, review.test.ts (api and browser), activity.test.ts
- docs/SPEC.md — §3.1, §4.26, §4.28–§4.31, §6.4, §7.1, §10.1, §11.4.2;
  docs/DECISIONS.md — D-083

**Decisions**
- Laika generates the webhook secret rather than accepting one — a pasted
  secret is a person choosing a weak one, and they copy it into GitHub either
  way.
- *Configure webhooks* became session only — whoever holds the secret can
  sign deliveries that confirm proof, so an agent's token must not mint one.
- New tables rather than columns on `task_evidence` — the brief forbade
  touching its state field's migration, and the record must exist before any
  round does (events before the finish).
- `task_round_github` keeps each round's CI line and merge — rather than
  recomputing from the record, which expires after 30 days and would make an
  old round's proof change on its own.
- CI counts one kind (check runs, else workflow runs, else suites) — summing
  read one Actions job as three.
- "Required" checks = every check reported — branch protection is in no
  delivery and fetching it would be an outbound call.
- Plausible repositories: the pull request's repo, else the project's, else
  any — the brief's "never across repos when the evidence names one".
- A merged pull request on a task already in review answers 200 instead of
  409 — under the review gate that is the ordinary order, and 409 marked the
  delivery failed on GitHub.
- Pruning on each delivery rather than a §11.6 job — three indexed deletes,
  nothing for a scheduler to remember.
- Commits split by task where files allowed; the shared files carry
  LAI-766's id and name LAI-753 in the body.

**Discovered**
- The retry comments were four, not three: services/webhooks.ts had two.
- A `pull_request` **opened** after the agent finished moves its task back to
  `in_progress` (§10.1's old rule). Uncommon under the gate (the URL is part
  of the proof, so the pull request exists first), recorded in D-083's *does
  not decide*. **Not filed**: LAI-767 and LAI-768 are taken and LAI-769 is
  the lowest free, but the orchestrator hands out ids for this run, so taking
  one could collide with a parallel builder's — flagged in the report.
- LAIKA-477 also names GitHub's legacy commit `status` event, which the brief
  did not; not handled. Flagged in the report.
- `server/test/mcp/parity.test.ts` *add_comment* timed out at 5 s once while
  screenshots ran beside the gate; master's LAI-768 is that.
- `git merge -F -` is a usage error (exit 129), not stdin; nothing ran.
- Screenshots at 390 need the theme set before the resize: the sidebar that
  holds the theme switch is hidden at phone width.

**Verification**
- Mutations: round 1 — 14 server and 4 browser; round 2 — 14 server (incl.
  the service tests), 6 web unit and 1 browser. Every new test went red under
  at least one; each run restored the file and checked the worktree diff hash
  before and after (identical). Scripts and outputs in this session's
  scratchpad (`mutate*.py`, `mutations-*.txt`).
- Gate (repo root, after the last code edit and the merge of master):
  - Gate 1, on the code-final tree merged with `master`, while another
    builder's gate ran in `Laika-capacity-v2` (load average 13–20):
    `pnpm test` exit **1**, `pnpm lint` exit **0**, `pnpm format` exit **1**.
    Format: `server/test/services/github-proof.test.ts`, written after the
    last `format:fix`; fixed and committed. Test: server 3 failed, 2642
    passed, 3 skipped of 2648 (128 files), plus one suite whose `beforeAll`
    timed out — `migrate.test.ts` (5 s), `environment-posture.test.ts`
    (60 s hook), and `build.test.ts`'s two boots ("never became healthy");
    web 2012 of 2012 passed; cli 320 of 320 passed.
  - Those four files alone (`vitest run test/tooling/build.test.ts
    test/db/migrate.test.ts test/tooling/environment-posture.test.ts
    test/mcp/parity.test.ts`): exit 0, 75 of 75 passed — including the built
    server booting through migration 0034. Load, master's LAI-768.
  - The final gate runs after this entry's commit; its exit codes are in the
    report to the orchestrator, not edited in here afterwards.

**State**
Both task files moved to `.tasks/review/`. Not pushed, not merged.

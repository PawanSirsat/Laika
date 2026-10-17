# review-gate — 2026-10-17

The single builder for LAI-758 on the owner's direct instruction (through the
orchestrator), branch `build-review-gate`, worktree `Laika-review-gate`.
Not pushed, not merged.

## 2026-10-17T08:00:19Z — LAI-758

**What changed**
- server/src/services/tasks.ts — an agent is refused any done-category status
  on every path (`agent_cannot_mark_done`); moving into done asks the review
  rule (M7); claim refuses done, cancelled and review; `finishTask` stores a
  round with its proof; `TaskView.send_back`
- server/src/services/task-lifecycle.ts — `review → done` out of the agent table
- server/src/auth/resolve-actor.ts — the comment that said the table kept agents
  out of done, corrected
- server/src/services/rounds.ts, review.ts — rounds and evidence items; the
  queue, accept and send-back
- server/src/http/routes/tasks.ts, review.ts — `POST /tasks/:id/finish`,
  `GET /tasks/:id/rounds`, `POST /tasks/:id/accept`, `POST /tasks/:id/send-back`,
  `GET /review`
- server/src/http/middleware/idempotency.ts — a token is never replayed a
  session's decision or a stored done move
- server/src/mcp/{write-tools,read-tools,server}.ts — `finish_task` takes proof;
  `get_task_context` leads with the send-back; the instructions teach proof
- server/src/services/comments.ts — `sent_back` on comment views
- server/src/db/{schema,enums}.ts, migrations/0032_review_gate.sql — three new
  tables, additive
- server/web/src/api/review.ts, use-review-count.ts; routes/screens/review/*;
  routes/screens/task/EvidenceSection.tsx, evidence.css — the Review page, the
  send-back dialog, the Proof section
- server/web/src/{route-table,ScreenOutlet,ShellProvider,ShellSidebar,
  shell-context,screen-copy,TaskCard,TaskDetailPanel}.* — wiring, the badge,
  the card marker, the comment pill
- docs/SPEC.md §4.7, §4.25–§4.27, §5, §6.4, §7, §11.4; docs/DECISIONS.md D-082
- tests: server/test/services/{review,rounds}.test.ts,
  server/test/http/routes/review.test.ts, MCP cases in write-tools.test.ts,
  server/web/test/api/review.test.ts, server/web/test/browser/review.test.ts,
  and the existing assertions that encoded the old agent-done behaviour

**Decisions**
- `forbidden` + `details.reason` instead of a new error code — §6.3 is closed
  (D-021); D-079 set the shape.
- A released `in_progress` task stays claimable, against the brief's "only
  backlog/todo" — D-078 item 8 and the profile figures depend on it, and it
  moves no category. Done, cancelled and review are refused.
- Idempotency closed narrowly for the gate (decisions and stored done answers)
  rather than re-keying the store by credential, which is LAI-748.
- No new activity verb: `via` on `task.status_changed`, the reason as a
  comment — a verb is an `activity` rebuild and three owners.
- The decision is D-082: `build-cleanup` has D-081 in flight (the D-075
  precedent).

**Discovered**
- `build-cleanup` also adds migration 0032. It cannot be renumbered from here
  without its schema; the regeneration steps are in the task file's build notes.
- The Connect block and the plugin skill README still teach finishing without
  proof → LAI-762 filed (discovered-from: LAI-758).
- `endpoint-coverage.test.ts` reads the JSX text "Pull request" followed by a
  closing tag as a client call site; the label is a constant now.
- The mutation run (eight fixes reverted one at a time, each restored by
  checksum) turned exactly the expected new tests red.
- `build.test.ts` timed out booting the built server under load average ~23;
  the same build booted and migrated by hand (its own `uptime_ms` showed ~13 s
  of start-up), so this is the known slow-machine timeout.

**State**
Moved to .tasks/review/. Screenshots in /tmp/laika-review-gate-shots/.

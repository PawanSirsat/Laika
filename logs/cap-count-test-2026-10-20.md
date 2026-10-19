# cap-count-test — 2026-10-20

Owner-direct worktree `Laika-cap-count-test`, branch
`LAI-784-capacity-count-test`, cut from `master` at `c8327326`. Dispatched to
fix the browser test that failed GitHub run 39104310061. Commits are local and
not pushed.

## 2026-10-19T19:35:00Z — LAI-784

**What changed**
- server/web/test/browser/organisation-roles.test.ts — the Capacity half of
  *"Capacity and Organisation agree on how many people there are"* waited for
  the first `[class*="cap-"]` element. The loading skeleton supplies one before
  `/capacity` answers. It now waits for `.cap:not([aria-busy="true"])`, the
  loaded screen. The name count and both assertions are unchanged.
- .tasks/review/LAI-784-capacity-count-test-reads-the-skeleton.md — filed,
  claimed and moved to review. It records the proof table and the census.

**Decisions**
- Wait for the loaded `.cap` container, not for a non-skeleton `.cap-card`.
  This fixture gives every person `status: 'never'`, so the loaded page folds
  all four into the `.cap-never` line and draws no card. `capacity.test.ts`'s
  `ready()` would have timed out here.
- Rejected: polling until all four names appear (`waitForFunction`). If
  Capacity dropped someone, that fails as a 20 s timeout and loses the
  *"Organisation shows N and Capacity shows M"* message, which is the whole
  point of the test. Waiting for "loaded" and then counting keeps the message.
- Proved the diagnosis before fixing it. With `/api/v1/capacity` held back
  1.5 s by a temporary `page.route`, the old wait failed with GitHub's exact
  message (`Capacity shows 0`) and the new one passed. Serving 3 people under
  the new wait failed with `Capacity shows 3`, so the assertion is not
  vacuous. The probe was removed, a grep for its markers returned 0, and the
  diff is only the fix.

**Discovered**
- `store-requests.test.ts:259` waits on `.timeline, .tl, [class*="timeline"]`,
  the same substring shape, for the Timeline tab. What it reads afterwards is
  request counts after `settle()`, not page text, so an early pass does not
  produce a wrong reading the way this one did. Recorded in LAI-784, no task.
- Every other test that opens Capacity already waits past the skeleton
  (`capacity.test.ts` `ready()`, `member-profile.test.ts:1342`,
  `store-requests.test.ts:456`). The census is in the task file.

**State**
In `.tasks/review/`. Card LAIKA-587 is still In progress, and the owner moves
it. Not pushed: the dispatch said to commit locally only.

The root `pnpm test` exited 1 on one server test only:
`server/test/db/migrate.test.ts:429`, *"0029 … keeps every row, adds the
column and the table, and rebuilds nothing"*, timed out at 5000 ms (8061 ms)
with all workspaces running together. Run alone, `migrate.test.ts` exits 0,
24/24, and that test takes 87 ms. This change touches no server code.

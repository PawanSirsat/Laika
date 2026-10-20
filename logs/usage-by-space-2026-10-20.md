## 2026-10-20T12:46:00Z — LAI-814

Owner-direct builder `usage-by-space`, worktree `../Laika-usage`, branch
`LAI-814-usage-by-space` from master `b54b2384`. No local server started, no
port used: every UI check went through the browser harness's stubbed API.

**What changed**
- server/src/services/token-usage.ts — `UsageProjectTotal` and
  `UsageView.by_project`; `projectModels()` is the one grouped query
  (project × model over `token_usage_days_project_day_idx`) that now serves
  both `usageByProject()` and `cacheByProject()`; `by_project` is `null` in a
  space view.
- server/test/services/token-usage.test.ts — eight tests under *GET /usage
  by_project (LAI-814)*: exact per-space figures and shares for three spaces
  plus an unattributed row, rows + remainder = totals, org price override
  priced the same as `totals.cost` with an unpriced model's caveat, admin in
  no space sees the private one, a token pinned to one space sees only it, a
  member is refused the org view and gets `null` in a space, empty list (not
  null) with nothing in range, and the real SQL captured and EXPLAINed onto
  the project index. The retyped plan case now sums every count.
- docs/SPEC.md — §6.4 `/usage` shape gains `by_project` and its rule, and the
  cost list names `by_project[].cost` (named edit, D-033).
- server/web/src/api/usage.ts — client `UsageProjectTotal`, `Usage.by_project`,
  `OUTSIDE_ANY_SPACE` and `outsideAnySpace()`.
- server/web/src/routes/screens/usage/BySpaceCard.tsx — new card, `BarRows`,
  each space a link to `/insights?tab=usage&project=<slug>`, the remainder
  last.
- server/web/src/routes/screens/usage/UsageScreen.tsx — the card on the org
  view; the scope is derived from `?project=` rather than held in state; the
  space tile's label is the shared constant.
- server/web/src/routes/screens/usage/usage-derive.ts — `scopeFor()`,
  `spaceUsageHref()`.
- server/web/src/routes/screens/usage/usage.css — `.usage-space-link` joins the
  person link's rules; `.usage-outside` is muted.
- server/web/src/components/shell/ScreenOutlet.tsx — `UsageRoute` passes
  `?project=` in and writes it back. Not named in the task file; it is the only
  place route params reach the screen, so the AC's link could not work without
  it.
- server/web/test/api/view-type-drift.test.ts — `UsageProjectTotal` paired.
- server/web/test/api/usage.test.ts, server/web/test/routes/screens/usage/usage-derive.test.ts,
  server/web/test/browser/usage.test.ts — unit tests for the remainder and the
  scope; two browser tests (the card, its links, Back; `?project=` opens a
  space and All spaces drops it); fixtures carry `by_project`; the themes test
  measures 1440 as well.

**Decisions**
- One query shared with the cache card rather than a second grouped query for
  `by_project` — the cache card's query already summed every column, so a
  second range of the same index would have read it twice for nothing.
- The scope is the address, not React state. A row "links to that space's own
  Usage view (`?project=`)" only means something if the view reads
  `?project=`; with the old state a link would have done nothing, and a
  pasted link would have opened All spaces. The selector *replaces* (the
  router's filter rule), a row link *pushes*, so Back returns from a space.
- The remainder is computed on the client from `totals.tokens − Σ by_project`
  and is not a server field: the AC's contract names only `by_project`, and the
  SPEC says what the subtraction means. It has no cost on its row — subtracting
  costs cannot carry the unpriced-model caveats, and `$0` for an unpriced
  remainder is the thing LAI-773 forbids.
- The `:313` tile is the *space* view's and is not shown on the organisation, so
  it could not be reused as the org remainder. Reused instead: its name, now
  one constant `OUTSIDE_ANY_SPACE` for both.
- A space with no rows in the range is absent rather than listed at 0, as
  `cache_by_project` does.

**Discovered**
- `?project=` on `/insights` makes the shell treat that space as open, as it
  already does on Members and Meeting review: the sidebar marks the space
  `aria-current` beside Insights, and the shell reads its name and sprint count
  and subscribes to its event stream. Existing app-wide behaviour of the
  param, not filed. Worth a look if org pages should not light a space.
- On the organisation, for an owner or admin on a session, the *Unattributed*
  tile and By space's *Outside any space* row show the same share: every row
  with no project has no task. They can differ only for a token pinned to some
  spaces, which never draws this page. Kept both because the AC asks for the
  row so the card adds up.
- `git pull --rebase` (§4) was not run: the branch has no upstream and this
  task was told not to push.
- nothing else.

**Tests** (each its own command and exit code; the repo-root gate was not run,
by instruction: polly gates on master after merging)
- `pnpm exec vitest run test/services/token-usage.test.ts` (server/) — 0, 65 cases.
- server/, one file each, all 0: token-budgets (22), token-usage.rework (4),
  token-telemetry (31), agent-time (7), local-activity (36),
  http/routes/usage (15), tooling/structure (20), errors (12),
  tooling/env-contract (9), tooling/policy-spec-drift (259),
  tooling/schema-spec-drift (35), mcp/parity (28). Typecheck 0.
- server/web/, `node --test` one file each, all 0: api/view-type-drift (4),
  api/usage (21), routes/screens/usage/usage-derive (8), browser/usage (16),
  browser/nav-redirects (8), and the 33 static sweeps that walk `src/` or read
  `ScreenOutlet`/SPEC (routes, screen-registry, nav-truth, redirects,
  context-copy, tokens, type-floor, type-roles, states, forms, …). Typecheck 0.
- `pnpm lint` 0 (after fixing one unnecessary cast it caught), `pnpm format` 0.

**Mutations** (each confirmed landed by checksum, restored in a trap, checksum
verified)
- server: a space's tokens drop cache writes → 4 red; priced with the built-in
  table instead of the org's book → the price test red (0.067 against 0.031);
  the readable-space filter removed → the pinned-token test red.
- web: `UsageProjectTotal.share` removed from the client → the drift test red,
  naming it; `outsideAnySpace` stops subtracting → 2 red; `?project=` not
  passed to the screen → both new browser tests red.

**Screenshots** — /tmp/laika-usage-shots/, org view with Laika, Onroute, Atlas
and 10.3M unattributed: `usage-by-space-{light,dark}-{1440,390}-{page,card}.png`.

**State**
Moved to .tasks/review/. Gate criterion left unticked: `pnpm test` not run here.

## 2026-10-20T18:36:05Z — LAI-814 (review round 1)

Sent back BLOCK on one defect, plus three non-blocking notes. The card's
`start_working` refused while it sat in Review (409, *already claimed*), so it
was moved to In progress with `update_status` and then marked.

**What changed**
- server/web/src/routes/screens/usage/usage-derive.ts — `offeredSpaces()` (the
  selector's spaces, All spaces aside; `null` with no list) and `spaceRow()`
  (`link` / `archived` / `plain`).
- server/web/src/routes/screens/usage/BySpaceCard.tsx — a row links only when
  `spaceRow` says `link`; otherwise the name is plain text, with an
  **archived** marker when the list loaded and lacks the space.
- server/web/src/routes/screens/usage/UsageScreen.tsx — computes `offered` and
  threads it to the card.
- server/web/src/routes/screens/usage/usage.css — `.usage-space-name` truncates
  like a link; `.usage-space-archived` is the muted marker.
- server/web/test/browser/usage.test.ts — an org view whose `by_project` holds
  an archived space and whose `GET /projects` sends its tombstone.
- server/web/test/routes/screens/usage/usage-derive.test.ts — the two helpers.
- .tasks/backlog/LAI-825-usage-project-param-lights-a-space.md — filed.
- .tasks/review/LAI-814-usage-by-space.md — round-1 notes, Gate ticked,
  `finished` updated.

**Decisions**
- The marker says *archived* only when the space list loaded: if
  `GET /projects` failed nothing is known, so no row links and none is marked,
  rather than calling every space archived.
- Kept the fix on the client, as the reviewer decided, rather than adding an
  `archived` field to `by_project`: the rule that matters is *what the selector
  can open*, and that is the client's to know.

**Discovered**
- `?project=` on Insights lights the space in the sidebar and opens its event
  stream → LAI-825 filed (discovered-from: LAI-814). The id sweep, both halves
  plus subjects, was run twice — before writing the file and again immediately
  before staging it — and was unchanged; LAI-815…824 are all taken on some
  branch, so 825 was the lowest free in CHIEF's block.
- No service hard-deletes a task or a space (searched `server/src` for both
  forms); the *tied to no task* edge in the task notes needs a manual or future
  delete.

**Tests**
- Before the fix, each failing: `node --test --test-name-pattern archived
  test/browser/usage.test.ts` exit 1 (`expected: 0, actual: 1` on the archived
  row's links); `node --test test/routes/screens/usage/usage-derive.test.ts`
  exit 1 (no export).
- After: usage-derive 0 (10/10), browser/usage 0 (17/17), web typecheck 0.
- **Full gate once, on `161a1559`, clean tree**: `pnpm test` 0 — web 2336/2336,
  cli 530 pass / 2 skipped, server 3287 pass / 10 skipped (159 files + 2
  skipped); `pnpm lint` 0; `pnpm format` 0. Run as one background job (so the
  tool's 10-minute cap could not kill it mid-run) and waited on with nothing
  else running, each command to its own file and exit code.

**Screenshots** — added
`/tmp/laika-usage-shots/usage-by-space-archived-{light,dark}-{1440,390}-card.png`.

**State**
Back in .tasks/review/, every criterion ticked. Not pushed.

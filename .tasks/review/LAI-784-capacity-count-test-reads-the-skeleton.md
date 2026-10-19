---
id: LAI-784
title: 'Organisation-roles counts Capacity''s people while the loading skeleton is still drawn'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-767
started: 2026-10-19T18:57:09Z
finished: 2026-10-19T19:33:00Z
status: review
---

## Goal

GitHub's gate (run 39104310061, `master` at `c8327326`) failed on one browser
test, `server/web/test/browser/organisation-roles.test.ts:438`, *"Capacity and
Organisation agree on how many people there are"*:

```
Organisation shows 4 people and Capacity shows 0
```

Earlier runs passed it. The test waits for the first element matching
`.cap-person, .cap-row, [class*="cap-"]` and then counts the stub's names. The
loading skeleton LAI-767 gave the Capacity page (`CapacitySkeleton` in
`server/web/src/routes/screens/capacity/CapacityScreen.tsx`) is built from
`cap-*` classes and holds no names. So the wait passes before `/capacity`
answers, and the count reads 0 whenever the answer is slow, as it was on
GitHub's two-core runner. On `master` a flaky test means a deploy that does not
happen (D-073).

When this is done, the test counts Capacity's people only once the page has
drawn them, and still fails if the two screens disagree.

## Acceptance criteria

- [x] The test waits until the Capacity screen has finished loading, not just
      until any `cap-*` element exists, before counting names.
- [x] The assertion is just as strict: Organisation shows 4, and Capacity
      shows the same number, with the same messages.
- [x] Every other test that opens Capacity is checked for the same pattern
      (wait for the first `cap-*` element, then read), and any it finds is
      fixed the same way. The result is recorded here.
- [x] No application code changes. Only `server/web/test/` is edited.
- [x] Proven: with `/api/v1/capacity` held back until after the wait, the old
      wait counts 0 and the new one counts 4. That check is temporary and is
      not committed.
- [x] The fixed file passes 5 runs in a row and 1 run under CPU load. Then
      the web workspace tests, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

- Same family as LAI-765: wait for the thing you read, not for a container
  that exists before it is filled.
- `capacity.test.ts` already has a `ready()` helper that skips skeleton cards.
  `member-profile.test.ts` waits for a real link or a named card. Neither
  pattern fits this fixture directly. `capacityPerson()` defaults every person
  to `status: 'never'`, so with presence on, all four fold into the
  `.cap-never` line and the page draws no `.cap-card` at all.

## Result

**The fix** (`server/web/test/browser/organisation-roles.test.ts`, the Capacity
half of the test at line 438):

```ts
// before
await cap.page.locator('.cap-person, .cap-row, [class*="cap-"]').first().waitFor({
  timeout: 20_000,
});
// after
await cap.page.locator('.cap:not([aria-busy="true"])').waitFor({ timeout: 20_000 });
```

The bare `.cap` class appears in exactly two places in `src/`:
`CapacityScreen.tsx:346`, the loaded screen, and `:735`, the skeleton, which
also carries `aria-busy="true"`. So the new locator matches only the loaded
page. In this fixture every person is `status: 'never'`, so the loaded page
shows the names in the `.cap-never` line, not as cards. That is why waiting
for a non-skeleton `.cap-card`, the `ready()` pattern in `capacity.test.ts`,
would time out here. The name count, the `[class*="cap-"]` instrument, is
unchanged.

**It was a test bug, not an app bug.** Once `/capacity` and `/presence`
answer, `CapacityScreen` replaces the skeleton with the whole loaded page in
one render.

**Proof, with temporary changes that were not committed:**

| `/capacity` | wait | people served | exit | message |
| --- | --- | --- | --- | --- |
| held 1.5 s | old | 4 | 1 | `Organisation shows 4 people and Capacity shows 0`, the GitHub failure word for word |
| held 1.5 s | new | 4 | 0 | none |
| held 1.5 s | new | 3 (mutation) | 1 | `Organisation shows 4 people and Capacity shows 3` |

After the probe was removed, a grep for its markers returned 0. `git diff`
showed only the change above.

**Census of the other tests that open Capacity.** Every file under
`server/web/test/` that names `/capacity`, read in full at each place it opens
the screen:

- `capacity.test.ts`: every test calls `ready()` first, which waits for
  `.cap-grid > .cap-card:not(.cap-card-skeleton)`. The skeleton test waits for
  `.cap-card-skeleton` on purpose. Safe.
- `member-profile.test.ts:1342`: waits for the profile link, then for a card
  that has the name. Its comment already names the skeleton. Safe.
- `store-requests.test.ts:451`: waits for *Show tasks*, then for the
  `.cap-task .cap-key` text it reads. Safe.
- `spaces-sidebar.test.ts:264`: waits for the URL and `.screen-bar-title`,
  then asserts that the space tabs and the space bar are absent. Those come
  from the shell, not from Capacity's loading state. Safe.
- `activity-tab`, `usage`, `board-presence`: they stub `/capacity` but never
  read the Capacity DOM.
- `organisation-roles.test.ts`: lines 462 and 469 were the only `cap-` reads,
  and this fix covers them.

Not Capacity, so not changed: `store-requests.test.ts:259` uses the same
`[class*="timeline"]` substring wait for the Timeline tab. What it reads
afterwards is request counts, after `settle()`, not text on the page. It is
recorded here and has no task.

**Verification**, in `server/web` unless noted:

- `node --test test/browser/organisation-roles.test.ts` ×5 in a row: exit
  0 each time, 16 tests, 16 pass.
- Same command, once with 10 `yes > /dev/null` jobs on 10 cores (load
  average 7.2), killed by PID afterwards: exit 0, 16 tests, 16 pass.
- `pnpm --filter @laika/web test` (typecheck, then every web test): exit 0,
  2136 tests, 2136 pass.
- `pnpm lint` at the repo root: exit 0.
- `pnpm format` at the repo root: exit 0.

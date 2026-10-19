---
id: LAI-784
title: 'Organisation-roles counts Capacity''s people while the loading skeleton is still drawn'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-767
status: backlog
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

- [ ] The test waits until the Capacity screen has finished loading, not just
      until any `cap-*` element exists, before counting names.
- [ ] The assertion is just as strict: Organisation shows 4, and Capacity
      shows the same number, with the same messages.
- [ ] Every other test that opens Capacity is checked for the same pattern
      (wait for the first `cap-*` element, then read), and any it finds is
      fixed the same way. The result is recorded here.
- [ ] No application code changes. Only `server/web/test/` is edited.
- [ ] Proven: with `/api/v1/capacity` held back until after the wait, the old
      wait counts 0 and the new one counts 4. That check is temporary and is
      not committed.
- [ ] The fixed file passes 5 runs in a row and 1 run under CPU load. Then
      the web workspace tests, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

- Same family as LAI-765: wait for the thing you read, not for a container
  that exists before it is filled.
- `capacity.test.ts` already has a `ready()` helper that skips skeleton cards.
  `member-profile.test.ts` waits for a real link or a named card. Neither
  pattern fits this fixture directly. `capacityPerson()` defaults every person
  to `status: 'never'`, so with presence on, all four fold into the
  `.cap-never` line and the page draws no `.cap-card` at all.

---
id: LAI-239
title: OrgView is paired now, and the census still says no client type exists
area: server
priority: p1
status: in-progress
started: 2026-09-10T01:00:00Z
assignee: core
depends-on: []
discovered-from: LAI-459
created: 2026-09-18
---

## Why

LAI-459 created `server/web/src/api/org.ts`, so `Org` and `OrgAi` now mirror
`OrgView` and `OrgAiView`. Pairing them in `web/test/api/view-type-drift.test.ts`
is what the client/server drift axis exists for — and it turns **CORE's census
red**, because both types are still listed in `UNPAIRED` with the reason
`'no client type exists'`, which stopped being true when that file was written.

The census caught it the moment the pair existed and said exactly what to do.
That is the check working; it is red because the two halves are owned by
different sessions, not because anything is wrong.

**The list is in CORE's area**, so SHELL cannot take it. §4.4's named case: *"the
exemption list lives in the other owner's area… there is no exemption to take
that is not a crossing, and never disable the check."*

## The exact failure, quoted

```
FAIL test/tooling/response-type-coverage.test.ts
  > every served response type is paired or named
  > names nothing that is already paired or no longer served
AssertionError: expected [ …(2) ] to deeply equal []
+   "OrgAiView is paired now — remove it from UNPAIRED",
+   "OrgView is paired now — remove it from UNPAIRED",

FAIL test/tooling/response-type-coverage.test.ts
  > every served response type is paired or named
  > reports how much of the surface is actually guarded
AssertionError: expected 33 to be 31
```

The second is arithmetic on the first: `paired.size + inherited.length +
UNPAIRED.size` must equal the served total, and the two rows are currently
counted twice — once as paired by the web side, once as unpaired here.

## What to do

Delete these two lines from `UNPAIRED` in
`server/test/tooling/response-type-coverage.test.ts`:

```ts
['OrgAiView', 'no client type exists'],
['OrgView', 'no client type exists'],
```

Nothing else. The count assertion then balances on its own.

## Acceptance criteria

- [ ] `OrgView` and `OrgAiView` are gone from `UNPAIRED`, and no replacement
      entry is added under a different reason — a client type exists, so there
      is nothing to exempt.
- [ ] `pnpm test` from the **repo root** exits `0`. Not the server workspace's:
      the pair that makes this red lives in `server/web/test/`, and a filtered
      run cannot see both sides of the thing it is counting (D-045).
- [ ] The guard that produced the message above is **unchanged** — it did its
      job. If it needed weakening to go green, the wrong line was edited.

## Notes

- **Do not wait for a SHELL change.** LAI-459's half is already written; this is
  the second half of a §4.4 two-owner merge, and CHIEF sequences the landing.
- `Org` declares `ai?` optional and never nullable, matching `OrgView` — the
  field-level `org.settings.edit` gate is *absent, not null*. `fieldsOf` cannot
  see optionality, so `web/test/api/org.test.ts` asserts it directly. Nothing
  here needs to re-check it.

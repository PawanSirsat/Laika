---
id: LAI-241
title: 'No browser test can assert a query string — the harness matches on path alone'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-459
started: 2026-09-18T10:41:19+05:30
finished: 2026-09-18T11:02:55+05:30
status: done
---

## Goal

`server/web/test/browser/harness.ts` matches stubs on **path alone**. Its own
comment says why — *"a query string is the client's business rather than the
fixture's"* — **and that is right for most tests.**

**It is a hole under every browser test in the repo.** A stub answers whether or
not the client asked the right question, so **an assertion about a filtered list
is structurally blind to the filter.**

**This is not hypothetical.** LAI-459's *"a deactivated member stays visible"*
passed against a stub that returned the deactivated person **whether or not
`?include_inactive=true` was sent** — and the client never sent it. LAI-240 is the
defect; this is the reason nothing caught it.

## Why p1 despite being test-only

**It is under work already accepted.** LAI-238's *"nothing is fetched until a
panel is opened"* happens not to depend on a query — **and nothing stops the next
one from depending on one silently.** Every browser assertion about a *filtered*
or *paginated* response is currently unfalsifiable, and none of them says so.

## Acceptance criteria

- [x] A test can **require** that a request carried a given query, and **fail when
      it did not**. Prove it by deleting the parameter from the client and
      watching that assertion — not the suite — go red.
- [x] **Path-only matching stays the default.** The harness's comment is correct
      for most tests, and making every fixture query-exact would break dozens of
      tests to fix a handful. **Opt in, not opt out.**
- [x] **An unmatched request must be visible rather than silent.** If a stub keyed
      on a query does not match, the test must fail with *what was actually
      requested* — a request that quietly falls through to a path-only stub is
      this defect with an extra step.
- [x] **Audit the existing browser tests for assertions that depend on a query**
      and report the list, **including "none besides LAI-240's"** if that is the
      answer. §5's rule: a sweep that does not say what it covered is not
      evidence.
- [~] **`pnpm test` is `EXIT 0` (1932 passed).** `pnpm lint` is `EXIT 1` on
      `master`, in CORE's area — same inherited failure as LAI-240, unchanged.

## Notes / context

**This is §5's *an assertion a broken setup satisfies*, arriving through the
harness rather than the test** — the same family as the bare `rejects.toThrow()`
and the un-asserted setup write, one layer further out, where no amount of care
in the test can see it.

**A `page.on('request')` capture is enough for a single assertion** and needs no
harness change; LAI-240 can use that today. **This task is the general fix**, so
the next person does not have to know to reach for it.


## What it does

A stub key may carry a query, and then it is **required**:

```ts
'/api/v1/users?include_inactive=true': { data: PEOPLE, next_cursor: null }
```

- **Subset matching.** The key names the parameters it cares about; the request
  may carry others. `listAllUsers` adds `cursor` on page two, and a fixture
  should not have to predict that.
- **Most specific wins.** `?a=1&b=2` beats `?a=1` when both fit, so a narrow
  fixture is never shadowed by a broad one declared earlier.
- **Opt in.** A key with no `?` behaves exactly as before. Nothing else in the
  repo changed.
- **No fall-through.** Once any key for a path names a query, an unmatched
  request is **refused, not answered by the path-only stub** — falling through is
  this defect with an extra step (AC3).
- **Refusals are visible.** `harness.unmatched` carries the **full URL actually
  requested**, and the 404 body names the declared keys. A 404 alone tells the
  browser, not the test.

## AC4 — the audit, and what it measured

**Instrumented rather than reasoned.** A temporary probe in the harness logged
every `/api/` request carrying a query, per test file, across all twelve:

| carries a query | does an assertion depend on it |
| --- | --- |
| 10 of 12 files | **none, besides LAI-240's** |

`capacity.test.ts` and `first-boot-status.test.ts` send no query at all.

**Why the other nine do not count.** Their parameters are `limit=` caps and
`?project=` on the SSE stream. **A fixture returns its list regardless of
`limit`**, so dropping it changes no assertion — the blindness needs a parameter
that *filters*, and these do not.

**One nearest miss, named because it is where this arrives next.**
`card-click.test.ts` exercises a genuine filter — `activity?task_id=t1&limit=50`
— and its assertion does not depend on it **only because the fixture is empty**
(`{ data: [] }`). The day somebody fills that in, the assertion is unfalsifiable
unless the stub is keyed. **I did not change it**: AC4 says report, and §3 says
discovered work is filed rather than done. One review line to decide.

## Verification

**Written failing first**, as AC1 asks. All four assertions were red against the
old harness — *"h.unmatched is not iterable"*, *"Cannot read properties of
undefined"* — before any change to `harness.ts`.

**5/5 mutations caught**, harness restored by checksum:

| mutation | |
| --- | --- |
| **client drops the parameter** | red — AC1's proof, the LAI-240 defect exactly |
| refused falls through instead | red — AC3 |
| the refusal is silent | red — AC3 |
| path-only keys start caring | red — AC2 |
| subset becomes exact | red — **after a fix, see below** |

## One mutation came back green, and the test was the thing at fault

**`subset becomes exact` was UNCAUGHT on the first run.** The test named
*"matching is by subset, so unrelated parameters do not break it"* used a
single-page fixture, so the only parameter sent was the one the key named —
**exact and subset are indistinguishable there.** The test was named for a
property it did not exercise, which is §5's rule about comments arriving in a
test title.

Fixed by making the fixture two pages, so the second request really does carry
`cursor` alongside `include_inactive`. The mutation is red now. **Reported rather
than re-aimed**, because the green is the finding.

---

## Accepted — CHIEF, 2026-09-03

All three gates green.

**A key may carry a query string, and then it is required** — and the design is
the one the criteria asked for: **path-only stays the default**, so the dozens of
existing fixtures are untouched, and **opting in is per key.**

### The refusal behaviour is the part that makes it safe

> *"Once **any** key for a path names a query, an unmatched request to that path
> **does not fall through**."*

**That is the criterion about silence**, and it is the one that would have been
easy to get wrong in the permissive direction: a query-keyed stub plus a
path-only fallback would look like it worked and quietly answer the wrong
request — **this defect with an extra step.**

### What it was filed on

LAI-459's *"a deactivated member stays visible"* passed against a stub that
answered **whether or not the client asked** — *"the assertion was structurally
blind to the exact thing it asserted."* **§5's *an assertion a broken setup
satisfies*, arriving through the harness**, where no care in the test could see
it.

**And it was under everything**, not just that one test: every browser assertion
about a filtered or paginated response was unfalsifiable, and none of them said
so.

---
id: LAI-241
title: 'No browser test can assert a query string — the harness matches on path alone'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-459
started: 2026-09-18T10:41:19+05:30
status: in-progress
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

- [ ] A test can **require** that a request carried a given query, and **fail when
      it did not**. Prove it by deleting the parameter from the client and
      watching that assertion — not the suite — go red.
- [ ] **Path-only matching stays the default.** The harness's comment is correct
      for most tests, and making every fixture query-exact would break dozens of
      tests to fix a handful. **Opt in, not opt out.**
- [ ] **An unmatched request must be visible rather than silent.** If a stub keyed
      on a query does not match, the test must fail with *what was actually
      requested* — a request that quietly falls through to a path-only stub is
      this defect with an extra step.
- [ ] **Audit the existing browser tests for assertions that depend on a query**
      and report the list, **including "none besides LAI-240's"** if that is the
      answer. §5's rule: a sweep that does not say what it covered is not
      evidence.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**This is §5's *an assertion a broken setup satisfies*, arriving through the
harness rather than the test** — the same family as the bare `rejects.toThrow()`
and the un-asserted setup write, one layer further out, where no amount of care
in the test can see it.

**A `page.on('request')` capture is enough for a single assertion** and needs no
harness change; LAI-240 can use that today. **This task is the general fix**, so
the next person does not have to know to reach for it.

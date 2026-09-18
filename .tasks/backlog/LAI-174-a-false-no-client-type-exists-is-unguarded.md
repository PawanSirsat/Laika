---
id: LAI-174
title: 'A `no client type exists` that has gone false is the one reason nothing checks'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-171
status: backlog
---

## Goal

`UNPAIRED` in `server/test/tooling/response-type-coverage.test.ts` holds two
kinds of value: **a client type name**, or the sentinel `'no client type
exists'`. One kind is checked and the other is not.

```ts
const wrong = [...UNPAIRED]
  .filter(([, mirror]) => mirror !== NO_MIRROR && !declared.has(mirror))
```

**`mirror !== NO_MIRROR` is the hole.** An entry claiming a client type is
verified to name one that exists. An entry claiming **none exists** is taken at
its word, for ever.

## Two entries are false right now

`server/web/src/api/meeting-reviews.ts` exists and exports both mirrors:

| entry | reason it carries | what is actually there |
| --- | --- | --- |
| `ProposalView` | `no client type exists` | `export interface ProposalView` — the same name |
| `ApplyReviewResult` | `no client type exists` | `export interface ApplyResult` — a different name |

**Neither is SHELL's fault and neither is a pairing they forgot.** Their `PAIRS`
comment says both *"cannot be paired here"*, because the census derives served
types from `*View` exports and `c.json<…>`, so a pair naming anything else
reddens *"PAIRS names a server type that no longer exists"*. They are compared
directly in `web/test/api/meeting-reviews.test.ts` instead, **including
optionality, which `fieldsOf` cannot see.**

So the mirrors exist, are compared, and CORE's list says they do not exist.

## Why the existing staleness guards do not fire

- *"names nothing that is already paired or no longer served"* fires when a type
  **enters `PAIRS`**. These cannot enter `PAIRS`, so it never will.
- *"names a client type that exists"* skips `NO_MIRROR` by construction.

**`OrgView` was caught only because SHELL could pair it** (LAI-239). That was
luck of shape, not the guard being complete — and this is the same defect in the
variant where pairing is impossible.

## What to build

- [ ] **The inverse assertion**: for every entry whose value is `NO_MIRROR`,
      assert **no client type of that name exists**. That is three lines beside
      the existing check and would have caught `OrgView` *without* waiting for
      SHELL to pair it.
- [ ] **Correct the two entries.** `ProposalView` names its mirror;
      `ApplyReviewResult` names `ApplyResult`. Both then fall under the check
      that already verifies a named mirror exists.
- [ ] **Say what the inverse check cannot see**, next to it: a mirror the client
      gives a *different* name — `ApplyResult` — is invisible to a name
      comparison, so `NO_MIRROR` stays a claim a human makes. **The check narrows
      the gap; it does not close it**, and LAI-465's rule says to write that down
      rather than let the next reader assume coverage.
- [ ] Prove it: add a client type named after a current `NO_MIRROR` entry and
      watch it go red; remove it and watch it pass.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

Found by CORE finishing LAI-171 and checking whether the merge had made its own
exemption reasons stale — the habit LAI-239 produced.

**This is the third variant of one defect in a day.** A reason going false
because a screen got built (`OrgView`, caught). A reason going false because a
module appeared that cannot be paired (these two, **uncaught**). And the general
form CHIEF wrote into `CONVENTIONS.md` §4: *an exemption's justification is
checkable if it is data, and unfalsifiable if it is prose.* **`'no client type
exists'` is data that nothing reads** — which is the worst of both, because it
looks checkable.

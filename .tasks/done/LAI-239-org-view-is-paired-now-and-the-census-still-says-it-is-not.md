---
id: LAI-239
title: OrgView is paired now, and the census still says no client type exists
area: server
priority: p1
status: done
started: 2026-09-10T01:00:00Z
finished: 2026-09-10T01:10:00Z
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

- [x] `OrgView` and `OrgAiView` are gone from `UNPAIRED`, and no replacement
      entry is added under a different reason — a client type exists, so there
      is nothing to exempt.
- [x] `pnpm test` from the **repo root** exits `0`. Not the server workspace's:
      the pair that makes this red lives in `server/web/test/`, and a filtered
      run cannot see both sides of the thing it is counting (D-045).
- [x] The guard that produced the message above is **unchanged** — it did its
      job. If it needed weakening to go green, the wrong line was edited.

## Notes

- **Do not wait for a SHELL change.** LAI-459's half is already written; this is
  the second half of a §4.4 two-owner merge, and CHIEF sequences the landing.
- `Org` declares `ai?` optional and never nullable, matching `OrgView` — the
  field-level `org.settings.edit` gate is *absent, not null*. `fieldsOf` cannot
  see optionality, so `web/test/api/org.test.ts` asserts it directly. Nothing
  here needs to re-check it.

---

## Submission note — CORE, 2026-09-10

**Root gate `EXIT 0`** — server 1926, `server/web` and `cli` zero failures. Run
from the repo root, as AC2 requires: the pair that made this red lives in
`server/web/test/`, and the server workspace alone cannot see both sides of the
thing it counts (D-045).

**Two deletions and a comment. The guard is untouched** — `git diff --stat` says
`4 insertions(+), 3 deletions(-)`, and three of the four insertions are the
comment. The census reads `served=32 paired=25 unpaired=6` now; it was
`paired=25 unpaired=8`, with those two rows counted on both sides.

I added one line to the group comment recording that `OrgView` and `OrgAiView`
left it **the same way `CapacityView` and `PresenceView` did in LAI-439** — a
screen got built, so the mirror existed. The comment already said that is how
entries leave; now it says it happened again, and by what mechanism.

### The part worth noting

**This is the first time that staleness guard has fired on a *reason* going
false rather than on an entry becoming unnecessary.** The entries were still
structurally exempt; what changed is that `'no client type exists'` stopped
being a true sentence about the codebase. SHELL's line is the right one to keep:

> *"Not pairing would have been green, and would have left a false claim in
> CORE's list that no check could see."*

That is the same defect LAI-462 was filed for — a comment claiming something the
code no longer supports — caught here by a test instead of by a reader, because
the reason was written where a guard could reach it.

### Nothing else changed

No replacement entry under a different reason: a client type exists, so there is
nothing to exempt. `web/test/api/org.test.ts` asserts `ai?`'s optionality
directly, and this file does not re-check it.

---

## Accepted — CHIEF, 2026-09-03

**Accepted.** Root gate `EXIT 0` — server **1926**, `server/web` and `cli` zero
failures. **Two deletions and one comment**; `4 insertions(+), 3 deletions(-)`,
three of the four being the comment. **The guard is untouched** — *"a green bought
by editing it would have been the wrong line"*.

Census: `served=32 paired=25 unpaired=6`. **The count assertion balanced on its
own** once the rows stopped being counted on both sides, which is what a derived
number should do.

### The finding is not the fix, and you are right about which one matters

> *"That staleness guard has **never fired on a *reason* before** — only on an
> entry becoming unnecessary. **Nothing about `OrgView` changed structurally.**
> What changed is that `'no client type exists'` stopped being a **true sentence
> about the codebase**."*

**And the generalisation is the best thing either of you wrote today:**

> **An exemption's justification is checkable if it is data, and unfalsifiable if
> it is prose.**

*"Every exemption list in `test/tooling/` already stores reasons as map values
rather than comments, and I had read that as a formatting choice. **It is not.**"*

**That is LAI-462's defect caught by a test rather than by a reader** — and the
contrast is exact: the four wrong numbers in `schema-spec-drift`'s docblock were
the same class of claim, written as prose, and took a whole task to find. **The
comment you left behind is in the past tense**, which is the rule you wrote three
tasks ago, applied to your own fix.

**`CONVENTIONS.md` §4 gains it**, credited, because it changes how the next
exemption gets written rather than explaining one that already exists.

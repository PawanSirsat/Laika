---
id: LAI-098
title: '§4.8 and `enums.ts` disagree on three verbs, and neither session can fix it alone'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-051]
discovered-from:
status: backlog
---

## Goal

**Supersedes LAI-114 and LAI-117**, which each described one half of this.

`enums.ts` allows three activity types that SPEC §4.8's closed vocabulary does
not list:

```
task.dependency_removed   comment.edited   comment.deleted
```

`schema-spec-drift.test.ts` currently exempts all three, and **its exemptions are
self-expiring** — the moment §4.8 lists them, the check fails with *"exempted,
but §4.8 and enums.ts now agree; remove the entry"*.

**That is the check working, and it is also why this needs one commit.** I tried
the docs half alone and turned master red:

- SPEC updated, exemptions still present → **fails** (stale exemption)
- exemptions removed, SPEC not updated → **fails** (real drift)

`docs/` is PM's and `server/test/` is yours (CLAUDE.md §1), so **neither of us
can land this alone.** Same shape as §4.16 in LAI-079.

## How this lands

1. You remove the three exemption entries from `schema-spec-drift.test.ts`.
2. **PM applies the §4.8 edit in the same commit as the merge.** The exact text
   is below — build to it and it will match.

Your branch will be red between those two steps. That is expected here and is
the check being right, not a regression.

## The §4.8 edit PM will apply

Replace:

> Types: `org.created`, `task.created`, `task.updated`, `task.status_changed`,
> `task.assigned`, `task.dependency_added`, `comment.added`, `project.created`,

with:

> Types: `org.created`, `task.created`, `task.updated`, `task.status_changed`,
> `task.assigned`, `task.dependency_added`, `task.dependency_removed`,
> `comment.added`, `comment.edited`, `comment.deleted`, `project.created`,

## Acceptance criteria

- [ ] The three exemptions are gone from `schema-spec-drift.test.ts`.
- [ ] With PM's §4.8 edit applied, `pnpm test` is green and the drift check
      reports no exemptions and no drift for activity types.
- [ ] **Verify the exemption list is now empty, or that anything left is real.**
      An exemption list that never empties is a second vocabulary.

## Notes / context

**Worth raising as a pattern, not just this instance.** Two of these have now
needed both halves at once (§4.16, and this). The drift checks are correct to
demand it — the alternative is a spec that may lag silently. But it means
**any spec-and-code change is a two-session commit**, and the only mechanism we
have is a task file carrying the text.

If that becomes common, the right answer is probably a narrow, named scope
exception letting one session land both halves — but that is a rule change, and
it should be made deliberately rather than by whoever is inconvenienced first.
**Say so in your log if you hit it a third time** and I will file the rule change.

---
id: LAI-433
title: '`laika_whoami` is registered, undocumented, and carved out of the parity check by name'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-419
status: in-progress
started: 2026-09-01T23:20:00Z
---

## Goal

`/mcp` serves **eleven** tools. §7.1 lists **ten**. The eleventh is
`laika_whoami`, and it is a good tool — *"the cheapest way for an operator to
confirm a token acts as the person they expect"* — but nothing in `docs/` says it
exists.

Measured against the running container, not read off the source:

```
add_comment create_task finish_task get_project_context get_task_context
laika_whoami list_projects list_ready_tasks log_unlisted_work start_working
update_status
```

## The part that makes it worth a task

`server/test/mcp/parity.test.ts:349` excludes it **by name, inline**:

```ts
(name) => !PAIRS.has(name) && !EXEMPT.has(name) && name !== 'laika_whoami',
```

There is an `EXEMPT` set **on the same line**. The carve-out did not use it.

An entry in `EXEMPT` is a thing a reader can find, count and challenge; a
`name !== '…'` in a filter predicate is invisible to everyone who does not
already know to look for it. **This is the shape D-045's exemption discipline
exists to prevent** — the exemption lists are audited for staleness by
`the exemption lists stay honest`, and an inline comparison is audited by
nobody.

## Acceptance criteria

- [ ] `laika_whoami` is **either** paired with `GET /api/v1/me` — which answers
      the same question and is arguably its REST twin — **or** carried in a named
      set with a written reason. **Not an inline `!==`, either way.**
- [ ] If it is a named set rather than `EXEMPT`, the set has its own staleness
      test, like the others. An exemption nobody is on the hook for removing is
      a permanent hole with an expiry date written on it.
- [ ] §7.1 lists it, or §7.1 says in one line why the tool list deliberately
      excludes it. **`docs/` is CHIEF's** — the half is written and held at
      `scratchpad/lai-433-spec.patch`; take the `ACTIVITY_TYPES`-style route
      (§4.4 step 2 exemption in your own file, or D-045 red-with-a-quote).
- [ ] A test asserts the **count and the names** of registered tools against
      §7.1's list. The count has now been wrong in three places — the ROADMAP
      said eight, LAI-419's AC4 said eight, and §7.1 says ten while the server
      serves eleven.
- [ ] §7.2's *"nine of them have REST twins"* is still true, or is corrected in
      the same landing. It is a count of the same thing and it moves with this.

## Notes / context

**`laika_whoami` calling no `can()` is correct and is not part of this task.**
It reflects the already-resolved actor and reads nothing, exactly as
`getCurrentUser` does for `GET /me`. A deactivated user never reaches it —
`resolve-actor.ts:95` throws `inactive_user` at token auth, which I checked
rather than assumed. **CLAUDE.md §5 now names this case explicitly**, so neither
is a rule violation to be tidied away.

**Do not delete the tool.** It is the first thing anyone will run when a token
does not work, and LAI-419 has a criterion about exactly that confusion.

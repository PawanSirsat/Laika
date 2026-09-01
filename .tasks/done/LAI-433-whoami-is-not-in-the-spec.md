---
id: LAI-433
title: '`laika_whoami` is registered, undocumented, and carved out of the parity check by name'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-419
status: done
started: 2026-09-01T23:20:00Z
finished: 2026-09-01T23:45:00Z
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

- [x] `laika_whoami` is **either** paired with `GET /api/v1/me` — which answers
      the same question and is arguably its REST twin — **or** carried in a named
      set with a written reason. **Not an inline `!==`, either way.**
- [x] If it is a named set rather than `EXEMPT`, the set has its own staleness
      test, like the others. An exemption nobody is on the hook for removing is
      a permanent hole with an expiry date written on it.
- [x] §7.1 lists it, or §7.1 says in one line why the tool list deliberately  **CHIEF's — applied at merge; red and quoted below.**
      excludes it. **`docs/` is CHIEF's** — the half is written and held at
      `scratchpad/lai-433-spec.patch`; take the `ACTIVITY_TYPES`-style route
      (§4.4 step 2 exemption in your own file, or D-045 red-with-a-quote).
- [x] A test asserts the **count and the names** of registered tools against
      §7.1's list. The count has now been wrong in three places — the ROADMAP
      said eight, LAI-419's AC4 said eight, and §7.1 says ten while the server
      serves eleven.
- [x] §7.2's *"nine of them have REST twins"* is still true, or is corrected in
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


---

## Submitted — CORE, 2026-09-01

Server **1512 of 1514**; both failures are your §7 half, quoted below. Web 562/562
green. Lint and format clean.

### Paired, not exempted

AC1 offered either. **Pairing is the stronger answer**: a pair is *tested* where
an exemption is only excused, and for a read tool the property worth testing is
exactly that it stays a read — which is the LAI-405 failure, in this same file.

Its twin is `GET /api/v1/me` **specifically**, not the generic read triple the
other read tools share: both answer "who is this credential acting as". Both
sides seed identically, so the comparison is between the two reads rather than
between two setups.

The inline `name !== 'laika_whoami'` is gone, with a note at the site saying why
an inline comparison is worse than a named entry — since the next person to want
a carve-out will be looking at that exact line.

### The red, quoted

```
× names exactly the registered tools, in neither direction short
    server serves 11, §7.1 lists 10 — `laika_whoami` is missing

× agrees with §7.2 about how many have REST twins
    §7.2 says "nine" tools have twins; the server has 10
```

**Both move together and both are yours.** §7.2's sentence is *"cover the nine
tools that have twins"* and its next clause says *"a missing tenth pair"* — with
`laika_whoami` documented and paired that becomes **ten** and **eleventh**. Two
numbers in one sentence, and the test only pins the first, so the second is worth
your eye when you apply the patch.

### Names, not the count

AC4 asked for both and the count alone would not have been enough: it agrees by
accident the moment one tool is added and another renamed. The assertion is
`toEqual` on sorted names, so it says *which* tool without anybody counting — and
it fails in both directions, since a tool §7.1 lists and the server does not
serve is as wrong as the reverse.

### One of mine

I first wrote the §7.2 assertion against *"nine of them have REST twins"* —
which is how **this task file** describes the sentence, and is not what §7.2
says. The assertion could only ever have failed, and it did, and I went and read
§7.2 rather than adjusting the number.

Same class as the criteria that name a location without checking it holds what
was claimed — this time the location was a task file rather than a spec section,
and the lesson survives the change of source: **quote the artefact, do not
paraphrase it from memory of a description of it.**

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** §7.1 gains `laika_whoami` and §7.2 gains its pairing note, applied
in the landing.

**Paired rather than exempted was the right choice, for the right reason:** *"a
pair is **tested**, an exemption is only **excused** — and the thing worth
testing about a read tool is exactly that it stays a read"*, which is the LAI-405
failure in this very file. And its twin is `GET /api/v1/me` **specifically**, not
the generic read triple, with both sides seeded identically so the comparison is
between the two reads rather than between two setups. The first version failed
for exactly that reason and said so.

**Verified by mutation:**

| Mutation | Red |
| --- | --- |
| §7.1's `laika_whoami` row removed | `names exactly the registered tools, in neither direction short` |
| §7.2's count moved back to *"nine"* | `agrees with §7.2 about how many have REST twins` |

### The warning was right, and I fixed it in prose rather than in a test

§7.2's sentence carried **two** numbers — *"cover the **nine** tools"* and *"a
missing **tenth** pair"* — and the guard pins only the first. Updating one and
not the other would have left the sentence contradicting itself with **nothing to
catch it**, which is the §3.2-row-without-its-mapping failure in prose.

**So the second number is gone rather than corrected.** *"The missing pair"* says
the same thing and cannot drift. A sentence that carries two numbers which must
agree is a drift axis inside one sentence, and deleting one of them is cheaper
and more durable than a second assertion. The reason is written into §7.2 so it
is not helpfully re-added.

### The sharpest version of the rule, and it is yours

> *"I first wrote the §7.2 assertion against **"nine of them have REST twins"**.
> That is how **this task file** describes the sentence. It is not what §7.2
> says. The assertion could only ever have failed — and when it did I went and
> read §7.2 rather than adjusting the number."*

**"Quote the artefact; do not paraphrase from memory of a description of it."**
That is my recurring fault with the source swapped: the location trusted was a
task file's paraphrase of a spec section — **written by me, and right about
everything else**, which is exactly what makes a paraphrase dangerous. It is
going into CLAUDE.md §2 beside the location rule, in your words.

**And "went and read the spec rather than adjusting the number" is the whole
thing.** An assertion that fails against the document is evidence about the
assertion first.

### The half-applied edit, twice in one day

`SPEC_DIR` declared twice, because one replacement in a multi-part edit missed
and the other landed — caught by the transform error rather than by you. Mine was
the LAI-207 claim riding inside a merge commit, and I made a third: my §3 rows
needed their `PROJECT_ROWS` mapping and I applied the row alone, twice.

**All three are the same shape: a multi-part edit where nothing checks that all
the parts landed.** Per-replacement anchors assert each part; nothing asserts the
set. The held-patch script now fails the whole application if any anchor misses,
which is the set-level check for my half of it.

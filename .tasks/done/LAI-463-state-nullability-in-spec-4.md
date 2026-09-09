---
id: LAI-463
title: '§4 states nullability for 29 of 191 columns — raise it where it carries meaning'
area: docs
assignee: chief
priority: p2
depends-on: [LAI-163]
discovered-from: LAI-163
status: done
started: 2026-09-03T00:05:00Z
finished: 2026-09-03T00:45:00Z
---

## Goal

LAI-163's guard compares §4's nullability statements against `schema.ts`. **It
reaches 29 of the schema's 191 columns**, and that number is **not a limitation
of the guard** — it is a measurement of how much §4 says out loud.

`comments.author_id` proves it: **it moved from uncovered to covered without a
line of the guard changing**, because §4.7 gained four words.

**So raising the reach is a `docs/` job.** This is it.

## Acceptance criteria

- [x] **Eleven columns added**, chosen by the rule below and not by count.
- [x] **The criterion held, and it excluded two of the thirteen candidates** —
      `projects.description` and `tasks.description_md`, where null means nothing
      beyond *optional*. Recording the exclusions is what makes the pass
      repeatable.
- [x] **Run after every batch. Zero disagreements** — all eleven new statements
      matched the schema on first assertion, so there was nothing to file and
      nothing to bend §4 towards. **Load-bearing, proved by mutation**:
      `tokens.project_ids_json` → `.notNull()` gives
      *"§4 says nullable and schema.ts says the opposite"*.
- [x] **Snapshot, 2026-09-03: 37 distinct column names stated, up from 26.**
      Dated, in the LAI-163 shape, because it is expected to move.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Nullability is only the first axis.** `schema-migration-drift.test.ts` already
compares type, nullability and primary key between schema and migrations; §4 is
the third party and states the least. **Do not extend this task to types** —
decide that separately once this one has shown what the effort per column
actually is.

**This is one of the two ways a guard's reach grows.** The other is a cleverer
parser, and LAI-163 argued convincingly that inferring *required* from silence
fails on most of the schema. **Stating it is the direction that works**, and it is
the one nobody was doing.

---

## Done — CHIEF, 2026-09-03

**Eleven columns, no disagreements, and the guard's reach is now measurably
wider without a line of its code changing.**

| section | columns | why the null carries a rule |
| --- | --- | --- |
| §4.2 `orgs` | `ai_base_url`, `ai_api_key_enc` | **null is how *"no provider configured"* is recorded** — there is no separate flag, so §10.2 and the Assistant both read this column to decide whether they can run at all |
| §4.7 `comments` | `edited_at`, `deleted_at` | null = never edited, and null = **not deleted**, so every read path must filter on it |
| §4.9 `tokens` | `project_ids_json` | **`null` is the *wider* value** |
| §4.10 `heartbeats` | `token_id` | null = a signed-in session, which is how a human's editor is told from an agent's |
| §4.11 `invites` | `accepted_by`, `accepted_at` | **the pair is the only record of *pending* there is** — no `status` column |
| §4.12 `meeting_reviews` | `reviewed_by`, `reviewed_at` | they say **who acted**, never *whether the row is finished* — `status` does that |
| §4.14 `unlisted_work` | `token_id` | same as §4.10's |

### The one worth reading twice

**`tokens.project_ids_json` is a permission whose absent value is the permissive
one.** A JSON array scopes a token to those projects; **`null` reaches every
project the user can.** That is the opposite of the usual reading, which means a
migration or a bug that loses the column **widens every token it touches** — and
until today §4 said nothing about it either way.

### Two candidates excluded, on the criterion rather than by taste

`projects.description` and `tasks.description_md`. **Null means nothing beyond
*optional*** there, and stating it would add noise that makes the eleven above
harder to notice. **Recording the exclusions is what makes the next pass
repeatable.**

### What I nearly published, and how the day's own rule caught it

My first survey said **37 candidates**, including `activity.org_id` and
`comment_mentions.comment_id`. **Both are `NOT NULL`** — CORE proved `activity.org_id`
is by mutation this morning. My regex read one line per column, and **the schema
puts `.notNull()` on a continuation line.**

**That is LAI-465's defect, in the task I filed LAI-465 from, an hour later.** A
reach decided by a parser nobody checked, under-reporting — here *over*-reporting
— in silence. **I caught it by sanity-checking three columns whose answer I
already knew**, which is the cheapest version of *"report what you found, not only
what you objected to."*

### Nothing to file

**All eleven agreed with the schema on first assertion.** §4 and `schema.ts` do
not disagree anywhere the document now speaks.

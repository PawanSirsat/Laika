---
id: LAI-167
title: '§11.4.2 shows a transcript §4.12 never stored — three artefacts disagree'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-454
status: backlog
---

## Goal

**LAI-454's AC3 cannot be built**, because it asks a response to carry something
Laika does not have. Three artefacts disagree and only one of them can be right.

**§4.12, in full** — there is no transcript column:

```
`id`, `project_id`, `source`, `transcript_hash`, `proposals_json` (§10.2),
`status` (`pending` | `applied` | `expired`), `reviewed_by`, `reviewed_at`,
`created_at`, `expires_at`. Proposals expire unreviewed after 7 days.
```

**§11.4.2, the screen** — written as though it does:

> **Meeting review** — **transcript on one side**, proposals on the other tagged
> NEW / CHANGED / DEAD / DECISION; each proposal shows its transcript quote;
> per-line accept and reject; apply acts only on accepted items; discard the set.

**LAI-454's own Notes** — state the opposite of §4.12 as fact:

> The transcript is the sensitive half. It is somebody's meeting, **stored
> whole**. Whatever the list returns, it is not the transcript body.

`schema.ts` matches §4.12, and `schema-spec-drift.test.ts` enforces the pair in
both directions — so this cannot be resolved from `server/` alone. **A column
without a §4.12 row is a red gate**, by design.

## Why it is not obvious which way to resolve it

LAI-450 built the not-stored version deliberately and recorded why:

> §4.12 keeps a `transcript_hash`, and D-005 is why: *"transcripts are never
> stored"*. The hash is enough to notice the same meeting arriving twice and
> carries none of what was said.

That task was accepted. Against it, §11.4.2's *"transcript on one side"* is the
older text and describes a screen nobody has built yet.

**The security argument points the same way.** §10.2 calls this *"the one
endpoint in Laika where a caller chooses which data leaves the instance"* and
gates it accordingly. Storing the whole meeting for seven days so a screen can
render it beside the proposals is a second copy of the same sensitive material,
sitting in the database rather than in flight.

**The argument the other way is real too**: a human accepting a proposal is
being asked to trust a quote the model chose, and a quote is exactly what a
model can select misleadingly. *"Each proposal shows its transcript quote"* is
weaker evidence than the transcript beside it. If that is the product
requirement, the storage is the cost of it and D-005's reach needs writing down.

**Note D-005 is a heartbeat decision** — *"no file paths, no diffs, no prompts,
no transcript content, ever"*, in a section about what a heartbeat carries.
LAI-450 read it as governing meeting transcripts too. That reading may be right
and it is not what the decision says it is about; **whichever way this goes, say
so explicitly** rather than leaving the next reader to make the same inference.

## Acceptance criteria

- [ ] **Decide, and record it as a decision** — the three artefacts above cannot
      all stand.
- [ ] If the transcript is **not** stored: §11.4.2's Meeting review line stops
      saying *"transcript on one side"* and says what the screen actually shows.
- [ ] If the transcript **is** stored: §4.12 gains the column, §10.2 says how
      long it lives and what deletes it, and D-005's scope is stated —
      heartbeats only, or transcripts too.
- [ ] Either way, LAI-454's AC3 and its Notes are corrected, and the server-side
      half is filed if there is one.

## Notes

Found by CORE claiming LAI-454 and checking its criteria against the sections
they name, before building. **Not resolved here** — `docs/` is CHIEF's and a
decision is not a builder's to make (CLAUDE.md §1).

LAI-454's other criteria are unaffected and are being built.

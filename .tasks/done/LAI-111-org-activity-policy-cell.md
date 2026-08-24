---
id: LAI-111
title: No §3 cell says who may read the org activity feed
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-048]
discovered-from: LAI-048
status: done
---

## Goal

`activity` rows with `project_id IS NULL` — `token.created`, `token.revoked`,
`member.role_changed`, `member.added` at org level, `unlisted.logged`,
`org.created` — have no owner in the §3.1 matrix. Project-scoped rows are easy:
`project.read`, same rule as the REST endpoints. Org-scoped rows are governed by
nothing.

LAI-048 had to pick something to ship the SSE stream, and picked **Export audit
log** (Owner ✓, Admin ✓, Member —, Viewer —), on the grounds that those rows
*are* the audit log. That is a defensible reading, not a decision the spec makes,
and right now it lives in a comment in `server/src/services/events.ts` where
nobody looking for a permission rule will find it.

## Acceptance criteria

- [ ] §3.1 gains a row for reading org-level activity, with all four cells filled.
- [ ] It says explicitly whether it is the same permission as **Export audit log**
      or a separate one. If separate, `policy/actions.ts` gains an action and
      `visibleTo` uses it.
- [ ] §4.8 or §11.5 states which rows the stream delivers to whom, so a client
      author does not have to infer it from what happens to arrive.
- [ ] The comment in `services/events.ts` is replaced by a spec reference.

## Notes / context

Worth deciding rather than defaulting, because the two readings differ in
practice. Members arguably *should* see `member.added` — someone joining the org
is not a secret, and a board that silently gains a person is worse than one that
announces it. They arguably should not see `token.created`, which is closer to a
credential event.

If the answer is "it depends on the verb", then the rule belongs on the verb, and
§4.8's table needs a visibility column. That is the more honest design and the
more expensive one; naming it here so the choice is made with both options in
view.

Blocking nothing today — the narrow reading is the safe direction to be wrong in,
and no UI shows this feed yet. It stops being safe the moment someone builds an
org activity screen and finds Members see an empty page.

## Decided — PM, 2026-08-25

**Org-scoped activity reads follow *Export audit log* (Owner and Admin).** §3.1
now says so. Builder-A picked that cell as a stand-in on LAI-048 and again on
LAI-055; it was the right reading and it is now the rule rather than a code
comment.

**Deliberately not a new cell.** A separate action whose only definition is
"the same people as Export audit log" is two things to keep in step by hand. If
they ever need to differ — someone who may watch the feed but not export it —
that is the moment to split, and it will be obvious because a person will be
asking for it.

Errs narrow, which is correct here: the cost of being wrong is a Member not
seeing that someone minted a token, not a Member seeing it.

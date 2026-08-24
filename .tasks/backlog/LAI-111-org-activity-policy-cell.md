---
id: LAI-111
title: No §3 cell says who may read the org activity feed
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-048]
discovered-from: LAI-048
status: backlog
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

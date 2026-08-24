---
id: LAI-064
title: App shell chrome — sidebar identity, counts, and the user/theme footer
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-058]
discovered-from:
status: review
started: 2026-08-24T23:50:00+05:30
finished: 2026-08-25T00:35:00+05:30
---

## Goal

Bring the shell up to `docs/design/Laika Prototype.dc.html`. **Style only — the
tokens are already correct** (I measured all fourteen against
`docs/design/README.md` and every one matches, both themes). What differs is
composition.

| Prototype | Built today |
| --- | --- |
| Logo with `laika-core · v0.4` mono subtitle | logo, no subtitle |
| Counts on nav items (Sprints `4`, Meeting review `4`) | none |
| User chip bottom-left: avatar, name, role | top-right |
| Theme control bottom-left | three radios top-right |

## Acceptance criteria

- [x] The sidebar carries the **active project context** under the wordmark —
      slug and whatever version string the API actually provides. **If no
      endpoint returns a version, show the project slug alone and say so in your
      log; do not invent `v0.4`.**
- [x] The signed-in user sits at the **bottom of the sidebar** — avatar from
      `theme/avatar-color.ts`, name, and org role — with sign-out reachable.
- [x] The theme control moves to the sidebar footer.
- [x] **Keep all three theme options.** The prototype shows a two-way "Switch to
      dark" because a mockup has no OS to follow. Dropping `System` would be a
      regression; match the placement, not the affordance count.
- [x] Nav counts render **only where a count is real**. A hardcoded `4` is a
      defect (CLAUDE.md §5.1). If a screen has no count endpoint yet, omit it.
- [x] Both themes; no new colour values (D-020).

## Notes / context

**Do not copy the prototype's markup** — it is inline-styled output from a
foreign runtime.

The counts are the part most likely to tempt a shortcut. `Sprints 4` and
`Meeting review 4` are fixtures in the mockup. Sprints has a real endpoint
(LAI-050); meeting review does not exist. Show the first, omit the second.

## Notes at review — builder-b

### AC1, the version — you asked me to say so in the log, so here it is in both

**A version exists, but it is not the project's.** `GET /api/v1/health` returns
`version` (`0.1.0` today) and is public. **Projects have no version** — no
column in `schema.ts`, no field in SPEC §4.3, nothing in the `GET /projects`
payload. So the prototype's `laika-core · v0.4` puts a project and a version on
one line as though the version belonged to the project, and only one of those
two things exists.

Rendered so they cannot be read as one: the slug is labelled `Project
laika-core`, the version `Laika 0.1.0`, and screen readers hear "Laika version"
before the number. Each is omitted independently — on `/projects` there is no
slug, so the line reads `v0.1.0` alone. Nothing invented.

### AC5, the counts

**Sprints shows the total number of sprints in the active project.** Not the
active sprint: SPEC §4.15 allows at most one per project, so that badge would
read `0` or `1` for ever and tell nobody anything. Total is the only number the
data defines without me choosing a meaning for it.

There is **no count endpoint and no total in the page envelope**, so
`countSprints` walks the cursor — the same reason `listAllUsers` does. A count
that stopped at page one would be confidently wrong.

**Meeting review has no count**, and neither does anything else. Both are absent
rather than zero, because a `0` badge is noise.

### AC3/AC4, and a conflict with LAI-062 worth naming

Moving the theme control into the sidebar footer would have **removed it from
every pre-auth page**, because LAI-062 does not render the sidebar without a
session. AC3 here and AC3 of LAI-062 pull opposite ways. Resolved by putting it
where the chrome is: sidebar footer signed in, header signed out. All three
options kept in both — `System` is not dropped.

That also made the top bar empty on a desktop once the user chip moved out of
it, since the nav toggle is hidden above 900px. `shell-head-quiet` collapses it
there and the media query brings it back where the toggle is needed.

### Two defects found while building

1. **`SPRINT_STATUSES` was wrong in my client.** I wrote `complete`; the column
   allows `completed`. A `?status=complete` filter is a 400 and nothing in the
   client would have said so — the type looked right and my own tests all used
   my own wrong value. Found because a seed insert silently did nothing. Fixed,
   and a test now reads `server/src/db/enums.ts` and asserts the two lists match.
2. **The sprint count fired before sign-in.** `useShellContext` keyed only on the
   slug, so a signed-out `/login?project=laika-core` made a request that could
   only 401, for a badge inside a sidebar that is not rendered. Now gated on the
   session.

### Verified live

Signed in with `?project=laika-core`: `laika-core · v0.1.0` under the wordmark;
`Sprints 3` and no other badge; footer carrying avatar, `Ada Lovelace`, `owner`,
sign-out and all three theme options; top bar collapsed. On `/projects`: no
slug, no sprint badge, version alone. At 760px the top bar returns with its nav
toggle. Both themes driven through the real radios — badge, context, footer
border and avatar all flip.

**LAI-062 re-checked, because this task moved the control it guards**: signed
out is still 0 nav links, no sidebar, brand present, and the theme control both
present *and working* (dark applies, light returns).

**Note on the dev database** (`/private/tmp/lai056.db`): I left three seeded
sprints in it so the badge is visible if you screenshot. They are seed data, not
fixtures in the app — remove them and the badge correctly disappears.

### One test of mine had gone vacuous

LAI-062's theme guard asserted the toggle was *not* inside the signed-in branch.
Moving the signed-in copy into the sidebar footer put it in **both** branches,
which pushed it past the regex window — so it passed while no longer testing
anything, and would have passed with the pre-auth copy deleted. Rewritten to
assert positively on the pre-auth branch, and confirmed red when that copy is
removed. Worth knowing generally: a negative assertion stops meaning anything
the moment the thing it forbids legitimately appears elsewhere.

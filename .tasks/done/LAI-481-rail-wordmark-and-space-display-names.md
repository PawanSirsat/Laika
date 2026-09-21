---
id: LAI-481
title: The rail wordmark is always Laika; space rows show display names
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-614
status: done
started: 2026-09-21T12:57:19Z
finished: 2026-09-21T12:57:19Z
---

## Why this file exists, and who wrote it

**Filed retroactively by CHIEF at merge time (2026-09-21), and that is a
deviation being recorded rather than hidden.**

The work landed as `416a0fc`, committed under **LAI-614's** id. LAI-614 is a
different task — the toolbar fold and the prototype evidence pack — and it was
sitting **unclaimed in `.tasks/backlog/`** while this was written against it.
So the change had no task of its own: nothing described it, nothing could be
reviewed against it, and it would have reached `master` attributed to criteria
it does not satisfy.

CHIEF reviewed the diff at merge time and files this so the record says what
actually happened. **The review is real; the paperwork is retroactive.** The
`started`/`finished` timestamps are the commit's, because no other honest value
exists.

**This is the third instance of the same shape** — LAI-605's restyle work was
also committed against an unclaimed backlog task, and SHELL's own 2026-09-20 log
flagged it as debt needing "regularising in a quiet moment". A pattern that has
recurred three times is not a quiet-moment problem.

## What shipped

Two owner-directed reversals, both dated 2026-09-21 in the code comments:

- **`server/web/src/components/sidebar/Sidebar.tsx`** — the rail wordmark is
  now always `Laika`, never the open project. **Reverses LAI-293.** The
  `listed`/`openSpace` lookup is deleted; the space bar already names the
  project, so the rail's identity is the product.
- **`server/web/src/components/sidebar/SpacesSection.tsx`** — space rows show
  `space.name` rather than `space.slug`. **Reverses LAI-271**, whose reasoning
  was that the reference names a space `laika-core`; the lowercase slugs read
  as a bug once real project names appeared. The slug survives in each row's
  `title` attribute alongside the meta line, so nothing is lost.
- `server/web/test/browser/spaces-sidebar.test.ts` and
  `board-follows-space.test.ts` re-aimed; the open space's name is now asserted
  in the space bar headline, which is where it actually lives.

## Acceptance criteria

Written after the fact against the diff, so they describe rather than direct.

- [x] The rail wordmark renders the product name on every route, including
      when a project is open.
- [x] Space rows render the display name; the slug remains reachable as the
      row's `title`.
- [x] Both sidebar suites assert the new behaviour rather than being deleted.
- [x] The reversals of LAI-293 and LAI-271 are recorded **in the code**, dated
      and attributed, so the next reader does not restore the old behaviour as
      a regression fix.

## Review note (CHIEF, 2026-09-21)

Accepted. Small, contained, and unusually well-documented: both comments name
the decision they reverse and the date of the direction, which is exactly what
stops a future session "fixing" it back.

**One thing left behind.** `SidebarProps.spaceName` is now accepted and unused,
carrying a comment that says so. Callers still pass it. That is a defensible
choice — it avoids churning every call site for a prop that may return — but an
unused prop with a comment explaining it is unused is a thing that outlives its
explanation. Worth removing when the sidebar is next touched; not worth a task
on its own.

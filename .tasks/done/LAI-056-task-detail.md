---
id: LAI-056
title: Task detail slide-over
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-049, LAI-055]
discovered-from: LAI-049
status: done
finished: 2026-08-24T21:12:24+05:30
reviewed: 2026-08-24T18:30:00+05:30
started: 2026-08-24T21:01:34+05:30
---

## Goal

The panel a card opens into (SPEC §11.4.2.1). A slide-over on the Board, not a
route of its own — §11.4.2 lists it as a Board sub-view.

## Acceptance criteria

- [x] Opens from a card on both kanban and list views; closes on escape and on
      backdrop click; focus moves into the panel and returns to the card on close.
- [x] Shows description, `created_via` provenance, and the `discovered-from` link
      where one exists.
- [x] **Dependencies with `BLOCKED BY` relations and each blocker's status** —
      the design's wording. A blocker that is `done` must be visibly different
      from one that is not, since that is the whole reason the list is there.
- [x] Comments (LAI-047), oldest first, **distinguishing human from agent** via
      `actor_kind` — the badge LAI-020 and LAI-049 already use.
- [x] Activity trail (LAI-055), newest first.
- [x] Claim and status controls, reusing LAI-049's transition call so a rejected
      transition behaves identically in both places.
- [x] Empty, loading, error and permission-denied states from LAI-020. A `403`
      renders permission-denied, never an empty panel.
- [x] No hardcoded data (CLAUDE.md §5.1).

## Notes / context

SPEC §11.4.2.1, §11.4.2. Style from `docs/design/` — the prototype's screen 2.

**Comments read oldest-first and activity newest-first** in the same panel. That
is deliberate (LAI-047, LAI-055) and will look like a bug to whoever reads it
next; a one-line comment saying why costs nothing now and saves an argument
later.

**Reuse the transition call, do not copy it.** Two implementations of "move this
task" will diverge, and the second one will be the one without the snap-back
LAI-049 tested.

No new dependencies. If a slide-over seems to need a library, file a task naming
it.

---

## Implementation notes for review (Builder-B)

`src/api/comments.ts`, `activity.ts`, `use-task-detail.ts`;
`src/routes/screens/board/TaskDetailPanel.tsx` + `task-detail.css`. Cards and
list rows gained an opener.

### A silent bug this task surfaced, from LAI-049

`GET /projects/:slug/members` returns **`{ members: [...] }`**, not the
`{ data, next_cursor }` envelope every other list uses. I had typed it as a page
in LAI-049, so `.data` was `undefined`, the member map was empty, and **every
name fell back to a raw ULID**.

The board hid it — cards show initials in an avatar, and an unknown assignee
just renders "unassigned". The panel shows names in three places at once, which
is where it became obvious: *"01M0T6D7VM2JX3C58YDHB2FFXT commented"*.

Same class as the `items` vs `data` bug in LAI-049: **a wrong envelope does not
throw, it renders something almost right.** Fixed, with a regression test, and
the type now carries a comment saying why it is not a `Page`.

### Focus restore had to be explicit

AC1 wants focus back on the card at close. I first assumed the browser would do
it once the dialog unmounted — **it does not**; focus falls to `<body>`, so a
keyboard user who pressed Escape lands at the top of the document and re-tabs
the whole sidebar. Caught in the browser, which is the only place it shows.
The effect now captures `document.activeElement` on open and restores it on
cleanup, guarded on the element still being in the document.

### Verified in a browser

| Check | Result |
| --- | --- |
| Opens from kanban **and** list | via a focusable key button, not a click on the draggable card |
| Focus | moves into the panel; **returns to the opener** on Escape |
| Close | Escape and backdrop click both work |
| Provenance | `created_via: api`, created-by name, **discovered-from → `LC-1 SSE reconnect`** |
| Blocked by | `LC-1` with its status; a `done` blocker renders struck-through with a green marker instead of red |
| Comments | 2 → 3 after posting, oldest-first, draft cleared |
| Activity | newest-first, and the new `comment.added` row appeared at the top |
| **Illegal transition from the panel** | *"Cannot move a task from backlog to done"*, status stayed `backlog` |

That last row is the point of reusing `board.move` rather than copying it — the
panel gets LAI-049's no-lie behaviour for free, and there is one implementation
to keep correct.

### `actor_kind` is not on comments

AC4 names `actor_kind`, and `CommentView` does not carry it — only the activity
feed does. A comment that arrived over MCP is agent-authored by definition, so
`isAgentComment` reads `created_via === 'mcp'`: the same fact by a different
route, not a guess. `api` is deliberately **not** badged — a token-authenticated
human script uses it as often as an agent does, and the badge claims something
specific.

Flagging rather than silently substituting, since the criterion names a field
that does not exist on that view.

### The two orderings

Comments oldest-first, activity newest-first, in one panel. Both come from the
server and neither is re-sorted here. The panel's doc comment says why in two
sentences, because it will read as a bug to whoever sees it next — which the
task predicted.

### Small things

- Description renders as **plain text**, not markdown: a renderer is a
  dependency this task may not add, and injecting raw HTML would be worse than
  unstyled prose.
- A dependency outside the loaded set shows `not loaded` rather than being
  omitted — the same honesty as the board's `deps ?`.

### Tests — 14 new, 177 in the package

`activity.test.ts` (unknown event types degrade to themselves; `statusTransition`
refuses a comment carrying `from`/`to`), `comments.test.ts` (tombstones never
reach the thread; `api` is not badged as an agent), and the `listMembers`
envelope guard.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`@laika/web` **177/177**, `@laika/server` **731/731**.

## Review — PM, 2026-08-24

**Accepted.** Verified by opening it in a browser, both themes.

The panel carries status (as a working control), priority, ready, assignee,
description, **provenance** (`created via api`, created by), **blocked-by**,
comments with a composer, and **activity from LAI-055** — *"Raghav Kothari
created this task"* with a real timestamp. Nothing on it is fixture data.

**Two details worth naming.** The open trigger is a `<button>` inside the card
rather than a handler on the card, because the card is draggable — correct, and
it is why my first probe missed it. And *"Nothing. This task can start whenever
someone picks it up."* is better than an empty Blocked-by section: it answers the
question rather than leaving a gap the reader has to interpret.

Escape closes it. The modal scrim intercepts pointer events while open, which is
correct behaviour — it defeated my first attempt to switch themes with the panel
up, which is the scrim doing its job.

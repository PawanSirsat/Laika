---
id: LAI-058
title: Projects screen — list, create, and switch the active project
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-010, LAI-019, LAI-049]
discovered-from:
status: review
finished: 2026-08-24T10:50:10+05:30
started: 2026-08-24T10:41:43+05:30
---

## Goal

`/projects` is already declared in `route-table.ts` and has no screen behind it.
`BoardScreen` currently resolves a project by falling back to "the first one this
actor can read", which is a placeholder, not a product.

Build the real screen: list the projects the actor can see, create one, and make
the choice stick.

**Every endpoint this needs already exists on `master`** — verified at review
time, not assumed.

## Acceptance criteria

- [x] `/projects` lists projects from `GET /api/v1/projects`. Nothing on this
      screen is hardcoded — no fixture names, no invented counts (CLAUDE.md §5.1).
- [x] **Archived projects are handled as tombstones, not as projects.** With
      `updated_since`, `GET /projects` returns `{id, deleted: true}`-shaped rows
      in `data` for archived projects. Render them as removals; never as a card
      with a blank name. **Test this with a tombstone in the response** — it is
      the failure a naive list makes and it looks like a bug in the API.
- [x] Pagination follows §6.3: `next_cursor` drives "load more" (or an
      equivalent), and the screen does not assume one page holds everything.
- [x] Create a project via `POST /api/v1/projects`. On success the new project
      becomes the active one.
- [x] Choosing a project navigates to its board and **survives a reload** —
      `?project=<slug>` is already what `BoardScreen` reads, so use it rather
      than inventing a second mechanism.
- [x] Empty, loading and error states use the LAI-020 components. A caller with
      no projects sees the empty state, not a blank page.
- [x] `403` on create renders `PermissionDenied`, not a generic error — a Member
      cannot create projects (§3.1) and that is a normal outcome, not a fault.
- [x] Both themes. Tokens from `docs/design/README.md` verbatim; no new colour
      values (D-020).

## Notes / context

**Endpoints, confirmed present:**

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/projects` | list — cursor paginated, `updated_since`, tombstones |
| `POST /api/v1/projects` | create — 201 |
| `GET /api/v1/projects/:slug` | the active project |
| `PATCH /api/v1/projects/:slug` | rename / edit (optional here) |

There is no `api/projects.ts` client yet — `server/web/src/api/` has `auth`,
`me`, `setup`, `tasks`. Add one in the established shape.

`POST /:slug/join` exists too, but joining is a different screen's job; do not
pull it in.

**Not in scope**: members and roles (LAI-059), archiving from the UI, and the
project-picker *modal* in the prototype's `SYSTEM` group — that group is not
shipped (CLAUDE.md §5.1).

---

## Implementation notes for review (Builder-B)

`src/api/projects.ts`, `src/api/use-projects.ts`, `src/routes/screens/ProjectsScreen.tsx`,
`projects.css`. `/projects` now has a screen behind it.

### The tombstone rule is tested, not just handled

AC2 asked for a test **with a tombstone in the response**, and the merge logic
started life inside the hook where this package has no renderer to reach it. So I
pulled it out: `applyProjectRows(current, rows, mode)` is pure and exported, and
`projects.test.ts` covers seven cases — a tombstone removing a row, a tombstone
for something never held, a page mixing live rows and tombstones, replace vs
merge, and that a tombstone is **never** rendered as a project.

**Confirmed able to fail**: replacing the branch with an unconditional
`byId.set(...)` — i.e. treating tombstones as projects — turns **4** cases red.

Verified against the real server too, because I wanted to see the shape rather
than trust my reading of §6.3:

```
PATCH /projects/laika-infra {"archived":true}
GET  /projects?updated_since=<ms>
  -> {"data":[{"id":"01M0S35WGG...","deleted":true}],"next_cursor":null}
```

### A narrowing gap the test found

`isTombstone` narrows an `if`/`else` but **not** `.filter(r => !isTombstone(r))`
— TypeScript sees the negation as a plain boolean, so the result stays
`ProjectRow[]` and reading `.name` off it fails to compile. Added `isProject` as
the positive half, which is what consumers that filter actually want. Found by
writing the test, not by reasoning about it.

### Verified in a browser

| Check | Result |
| --- | --- |
| List | `Laika Core` (private) · `Laika Web` (public), keys and slugs from the API |
| Archived project | **absent** — no nameless card, 0 blank-named cards |
| Slug/prefix suggestion | typing *"Meeting Diff Engine"* gave `meeting-diff-engine` / `MDE` |
| Create | 201, folded into the list, navigated to `/board?project=meeting-diff-engine` |
| **Survives a reload** | a fresh load of `/board?project=laika-web` rendered that project's board |
| `422` on create | server returns `slug` and `prefix` issue paths, which the form maps to those inputs |

### Slug and prefix are required here, unlike setup

`POST /projects` demands both — the server does **not** derive them, unlike
first-boot where `project_prefix` is optional. So the form *suggests* and lets
you edit: `slugify` matches the server's regex, `suggestPrefix` returns initials
(`Laika Core` → `LC`) and **returns empty rather than something invalid** when it
cannot make a legal 2–8 character prefix. An empty field that required-validation
asks about beats a fabricated value that 422s.

Once you edit the slug or prefix, typing in the name stops overwriting it.

### The one thing I could not test live

**AC7's `403`.** This session is signed in as the Owner, who *can* create
projects — producing a real 403 needs a Member account, which needs an invite
flow that is not built. What is verified: the screen hands the error to
`ApiErrorState`, and `ApiErrorState` maps `forbidden` to `PermissionDenied` with
no retry (unit-tested under LAI-007, guarded in `states.test.ts`). So the mapping
is proven and the wiring is proven; the end-to-end 403 is not. Saying so rather
than implying I clicked it.

### Pagination

`next_cursor` drives a "Load more" button, and a failed *next* page keeps the
pages already shown — the error is about the fetch, not the data. With three
projects there is one page, so the control is correctly absent; the paging path
is unit-tested through `applyProjectRows`' merge mode.

### Choosing a project uses the URL, not new state

`?project=<slug>`, which `BoardScreen` already reads. A second "active project"
store would be a second thing to keep in sync, and this one survives a reload
for free.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`@laika/web` **163/163**, `@laika/server` **615/615**.

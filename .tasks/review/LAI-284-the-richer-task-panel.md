---
id: LAI-284
title: The task panel to the design — editable fields, dependencies, watchers, tabs
area: web
assignee: shell
status: review
priority: p1
depends-on: []
discovered-from: LAI-283
started: 2026-09-18T23:10:00Z
finished: 2026-09-19T00:05:00Z
---

## Why

The owner asked for the reference drawer (LAI-142) in place of our plain one
(LC-6), and said the agentic-runtime parts could be dummy.

**Most of it was not dummy.** The API already served nearly everything on the
list, and the panel simply never called it:

| Asked for | Found |
| --- | --- |
| Title, description, priority, assignee | `PATCH /tasks/:id` |
| Status | `POST /tasks/:id/status` (`PATCH` refuses it `422`) |
| Dependencies + **Link task** | `POST`/`DELETE /tasks/:id/dependencies` — LAI-233 |
| Watchers, count, roles | `PUT`/`DELETE /watch`, `GET /watchers` — LAI-458 |
| Agent name in provenance | `created_by_client` is a real field (`mira-cli`) |
| `AGENT` badge on a comment | `comments.created_via === 'mcp'` |
| Code blocks in comments | `body_md` is markdown |
| Changes tab | `webhook.commit` activity rows |
| Claim holder | `POST /tasks/:id/claim` |
| `@` mentions | `GET /projects/:slug/mentionable` |

Three things genuinely do not exist and are the only demo data:

1. **The claim's expiry.** The claim is a compare-and-swap with **no TTL**;
   nothing lapses and no column stores a deadline.
2. **The client's version and token scope.**
3. **Handing a task to a runtime.** No endpoint. The button refuses in words
   rather than appearing to queue something.

## What

- `routes/screens/task/` — `InlineEdit`, `DependenciesSection`,
  `WatchersSection`, `CommentComposer`, `CommentBody` + the pure
  `comment-body.ts`, and `task-panel.css`.
- `api/tasks.ts` — `updateTask`, `watchTask`, `unwatchTask`, `listWatchers`,
  `addDependency`, `removeDependency`. `api/mentions.ts` — `listMentionable`.
  `api/client.ts` learns `PUT` (watching is idempotent state, §6.4).
- `demo/agent-runtime.ts` — the three absent things, D-032-shaped.
- Three tabs with counts; the design's footer actions and permission note; the
  header's Move / ⋯ / close.

**Four `NO_BROWSER_CALLER` exemptions deleted** — `*/watch`, `*/watchers`,
`*/dependencies`, `*/mentionable`. That is the guard proving the closure.

## Acceptance criteria

- [x] Title and description are click-to-edit; `PATCH` carries **only** the
      changed field.
- [x] Priority, status and assignee are all editable; tags kept.
- [x] Dependencies show status, key, title and assignee, with link and unlink.
- [x] `Discovered from` renders as the design's dashed callout.
- [x] Watchers list with count and role labels, and a watch toggle.
- [x] Provenance names the client; version and scope are marked as placeholders.
- [x] Comments render fenced code and badge agents; the composer has the
      toolbar and an `@` picker.
- [x] Tabs: Comments / Activity / Changes, with counts.
- [x] Footer: Hand to my agent, Move to Review, and the permission note.
- [x] A Viewer gets the panel read-only, with controls **absent** not disabled.
- [x] Full gate — all three `EXIT 0`, repo root, on a **plain** build.

## Notes

**I guessed an API shape and it cost the whole drawer.** `listMentionable`
assumed a `Page` with `data` and `user_id` fields, because every neighbouring
endpoint is paginated and every other person-shaped payload says `user_id`. The
route returns `{ users: [{ id, name }] }`. `page.data` was `undefined`,
`people.length` threw, and the panel rendered nothing. Read the route; do not
pattern-match its neighbours. `test/api/mentions.test.ts` pins the shape.

**`not-in-bundle.test.ts` caught a real leak.** A string literal in `src/demo/`
reaches the production bundle even behind `if (!DEMO_ENABLED) return` —
`DEMO_ENABLED` is a runtime value, not a build-time constant the minifier can
fold, so the early return removes the *behaviour* and not the *text*. Two
strings leaked: `'2-digit'` from `toLocaleTimeString` options, and the handoff
refusal. The hour is formatted by hand now, and the refusal moved into the
panel — where it belongs anyway, being the screen's explanation rather than demo
data. **Every previous demo module happened to contain no distinctive
literals**, which is why this has not bitten before.

**And the gate must run on a plain build.** The owner's instance is served from
`VITE_LAIKA_DEMO=1`, and `not-in-bundle` read *that* bundle and failed — its own
message says so. `pnpm build` first, gate, then rebuild with the flag.

**The claim deadline is asserted by its absence.** The browser test runs against
a plain build, so it asserts the invented expiry **cannot reach production** —
which is stronger than checking it renders. The first version asserted the
opposite and failed; that was the guarantee working.

**`comment-body` is a parser of one construct, not a renderer**, and its test
says so out loud: bold, links, lists and a `<img onerror>` all survive as
characters. It is split into a `.ts` so `node --test` can load it at all —
a parser beside its JSX cannot be tested, which is how a parser ends up untested.

# Experience architecture

**Phase B deliverable (proposal over evidence).** Information architecture,
navigation, capability-aware views, the command palette and keyboard map, the
mobile IA, the single org-wide live connection, the Command Center and Agent
Operations. **[E]** exists today · **[UI]** UI-only (SHELL) · **[BE]** needs
CORE. Basis `9ac3be1f`.

## 1. Current IA [E]

**Sidebar groups** (`route-table.ts`):

- **HOME:** `/my-day` (:218), `/inbox` (:234), `/work` (:249).
- **SPACES:** pinned spaces, "More spaces" → `/projects` (:171). Hidden when
  there are no spaces (`Sidebar.tsx:208`, B21).
- **ORG:** `/insights` (:263), `/organisation` (:272), `/developer` (:287).

**Space tabs** are flat paths with the project as a query parameter: `/board`,
`/list`, `/timeline`, `/calendar`, `/sprints`, `/dashboard`, `/activity`,
`/meeting-review` (:136-200). Settings alone carries the slug in its path,
`/spaces/:slug/settings` (:328).

**Page tabs** (`page-tabs.ts`): `INBOX_TABS` review / handoffs / unlisted
(unlisted requires `audit_log.export`, :42-46); `INSIGHTS_TABS` capacity /
usage (:49-52); `ORGANISATION_TABS` six tabs (security requires
`token.list_any`, activity requires `audit_log.export`); developer tabs in
three modes (classic / v3 / preview) via `developerTabs()`.

**Gating** comes from the server: `nav-permissions.ts` reads
`GET /permissions` → `me.actions`. Controls are **absent, not disabled**. This
is the right model and every proposal below keeps it.

**Redirects** (`redirects.ts:30-38`): `/review`, `/unlisted`, `/capacity`,
`/usage`, `/tokens`, `/connect`, `/developer/connect`, applied as replace,
carrying the query and able to drop named parameters.

**Keyboard bindings in use today** — nothing proposed may collide:

| Key | Where | Source |
| --- | --- | --- |
| `/` | focus search in a space (no ⌘/Ctrl/Alt) | `SpaceTopBar.tsx:91` |
| `N` `T` `J` `K` `G` `X` | My Day actions | `my-day/shortcuts.ts` |
| `?` `Enter` `Esc` `←` `→` | My Day help, confirm, close, move | `my-day/shortcuts.ts` |
| `Alt+←/→` (±Shift) | nudge a time entry | `my-day/Timeline.tsx:672` |
| `Alt+↑/↓`, `Home`, `End` | Dropdown navigation | `Dropdown.tsx:500-527` |
| `Alt+Arrow` | move a board card | `TaskCard.tsx:261-271` |

My Day lowercases `event.key`, so **Shift+letter also fires there**. That rules
out bare-letter and Shift-letter global shortcuts.

## 2. Proposed IA

One app, one sidebar. What a person sees comes from **capabilities and data
presence, never from a role name**.

```
HOME     Command Center (/home, new) · My day · Inbox · Work
SPACES   <pinned spaces> · All spaces
         └ per space: Board · List · Timeline · Calendar · Sprints ·
           Dashboard* · Activity · Meeting review · Settings
ORG      Agents (new) · Review studio (new) · Insights · Organisation* ·
         Developer access
FOOTER   Notifications (BE) · Profile · Theme
```

`*` = shown only when `me.actions` grants it, as today.

| Element | [E] | [UI] | [BE] |
| --- | --- | --- | --- |
| Global nav | sidebar groups and gating | add `/home`, `/agents` (or Insights › Agents, §7.5), `/review-studio`; retire `/members` | org-wide session / claim list for "running now" |
| Breadcrumbs | only the drawer's parent crumb (`TaskDetailPanel.tsx:143, 305-320`) | `Org › Space › View › LAI-key` from route + `?project=`; last two segments below 600 px; task segment only while a task is open; real `<a>` links | — |
| Space switching | `SpacesPopover`, `SpacesSection` | keep the current view tab and the filters that apply across spaces (status, assignee); drop space-bound ones (sprint, tag) the way `redirects.ts` already drops parameters | — |
| Back behaviour | drawer opens by push (`use-route.ts:16-41`) | tab and filter changes **replace**; route changes **push**; opening a task pushes once, so Back closes the task before it leaves the view (needs B1 fixed first) | — |
| Global search | board `?q=` filters client-side; `GET /tasks` filters only `project`, `status`, `assignee`, `sprint`, `updated_since` | v1 searches spaces, routes, commands and tasks **already loaded**, labelled "In loaded results"; a task key resolves exactly via `GET /tasks/:id` | FTS5 endpoint (M) over title, description, comments, checkpoints |
| Command palette | none | §4 | commands that act on data report only the server's confirmed result |

### 2.1 Migration

| Old | New | Mechanism |
| --- | --- | --- |
| `/` | `/home` | `REDIRECTS`, keeping the query |
| `/members?project=X` | `/spaces/X/settings?tab=members` | function-form redirect (`REDIRECTS` maps fixed paths only) |
| Meeting review / Unlisted "open task" `/board?q=KEY` | `/board?project=<slug>&task=<id>` | `useOpenTask` (fixes B2, B18) |
| existing redirects | unchanged | — |

Every new route lands with its `structure.test.ts` `WEB_*` entry (SHELL's,
D-026) and, per CLAUDE.md §5.1, a SPEC §11.4.2 screen → endpoint row that is
CHIEF's to write before the UI task starts.

## 3. Capability-aware views

The rule: **a role sets nothing directly.** Three inputs decide what a person
sees:

1. **Visibility** — `me.actions` from `GET /permissions`.
2. **Presence** — whether an endpoint returned rows. The server already scopes
   data (e.g. `listReviewQueue` decides who may decide), so an empty answer
   means "nothing for you here", and the section collapses.
3. **Order and density** — the person's own setting.

| Concern | [E] | [UI] | [BE] |
| --- | --- | --- | --- |
| Default landing | `/` resolves to the first nav route (inferred) | `/` → `/home` for everyone | per-user `landing`, `density` on `PATCH /me` (S); localStorage per device until then |
| Density | one | **Focus** (cards, IC default) and **Overview** (compact tables). Default Overview if the person holds `audit_log.export` or has a non-empty review queue — a capability heuristic for the *default only*; the person can override | preference persistence |
| Section order (Command Center) | — | sections with rows rise; empty ones collapse to one line; pins override | — |
| Controls | absent when not permitted | unchanged: no control is rendered that would 403; no client role inference | — |

## 4. Command palette (proposal; dependency: cmdk, own task)

- cmdk's `<Command>` rendered **inline inside our own modal shell** (the
  `Dialog` base with `useDialogFocus`), **never `Command.Dialog`** — that pulls
  in Radix Dialog, whose scroll lock injects a runtime `<style>`, which
  `style-src-elem 'self'` blocks (`library-evaluation.md`).
- **Navigate** — every route the person can reach, filtered by the same
  `nav-permissions` predicate as the sidebar, so the palette never lists a
  destination the sidebar hides.
- **Switch space** — one entry per readable project.
- **Open task** — by key (`LAI-NNN`, `LAIKA-N`), plus the last 20 opened
  (localStorage convenience, wrapped in try/catch).
- **Act on the open task** — only while a task is open and its actions allow:
  status, assign, watch, comment, open on board. Each runs the drawer's own API
  call; a toast shows "Saving…" then the server's result. **Nothing reads as
  done before a 2xx.**
- **Create task** in the current space, only with `task.create`.
- **Time** — start / stop timer (`POST /me/time/timer`).
- **System** — theme, keyboard help.
- Prefixes: `>` commands, `#` spaces, `@` people, `LAI-` tasks. Result counts
  announced through `LiveRegion`.

## 5. Keyboard map (proposal)

| Key | Action | Notes |
| --- | --- | --- |
| `⌘K` / `Ctrl+K` | palette | unbound today; works from inside a text field |
| `/` | focus search in the current scope | existing; extended to Command Center and Work |
| `?` | help sheet | global section + the current screen's; My Day's sheet becomes one section |
| `Esc` | close the innermost layer | needs one dismiss stack, so a menu's Escape no longer closes the drawer (B3) |
| `J` / `K` | next / previous row | only where it already exists (My Day); no new screen gets them in v1 |
| `[` | toggle sidebar rail | proposed; verify no collision before adopting |

**Not proposed:** `g`-chords (collide with My Day's `G`), Shift-letter
shortcuts, new `Alt+Arrow` bindings. Go-to navigation lives in the palette. A
test runs the global handler against My Day's `SHORTCUT_GROUPS` to prove no
collision.

## 6. Mobile IA (designed for the phone, not a shrunk desktop)

- **Bottom bar, five items:** Home, Inbox (badge), Spaces, Search (opens the
  palette full-screen), Me (My day, profile, theme). ORG lives under
  Me › Organisation, gated as today.
- **A space defaults to List grouped by status**, not Board — board drag does
  not work on touch (B17). Status changes go through a picker on the task
  sheet.
- **A task opens as a full-screen sheet** that takes the browser's back
  gesture.
- **Command Center at 390** is one column: each section's count and its top
  three rows.
- **Timeline and Calendar** show "Open on a wider screen" with a link to List,
  rather than a broken layout.
- **Header** collapses breadcrumbs to the last crumb plus Back; filters
  collapse into one "Filters (n)" button (fixes V4).

## 7. One org-wide live connection

### 7.1 Today

- **Server [E].** `GET /api/v1/events` without `?project=` is org-wide:
  `projectId` stays `null` (`server/src/http/routes/events.ts:124-136`); the
  `ready` frame reports `project_id: null` (:262-266); each row is filtered per
  frame through `insidePin` and `visibleTo` against a **freshly reloaded actor**
  (:322-326), so losing access mid-stream is honoured.
- **Client [E].** `event-stream.ts:126` opens
  `EventSource('/events?project=<slug>')`; the registry is keyed by slug. Four
  consumers: `SpaceLive.tsx:76`, `use-shell-context.ts:118`,
  `use-events.ts:165`, `board-motion.ts:363` (carried from the audit). The
  shell polls separately: review count 60 s (`use-review-count.ts:56`), the
  review screen 20 s (`ReviewScreen.tsx:45, 92`), unlisted, token alerts,
  handoff counts — most ignoring tab visibility (B14).

### 7.2 Proposal [UI]

1. The registry holds **at most one** `EventSource`, opened to `/events` with
   no project, on sign-in; closed on sign-out.
2. `subscribeToEvents(slug, listener)` keeps its signature and forwards only
   frames whose `project_id` matches; the client resolves slug → id from the
   cached `/projects`. Org-scoped rows (`project_id: null`) go to a new
   `subscribeToOrg(listener)`.
3. A frame for an unknown project id triggers one `/projects` invalidation
   (covers newly granted access).
4. `gap` and `closed` fan out to every subscriber; reconnect relies on
   `EventSource`'s own `Last-Event-ID`.
5. While the tab is hidden the connection stays open; cache invalidation
   pauses and runs once, batched, on `visibilitychange`.
6. Pollers the stream makes redundant are deleted (review count ×2). Presence
   is not in the stream, so it stays polled — through one visibility-aware
   `usePolled`.
7. **Guard test:** exactly one `EventSource` construction across a session
   that visits Board → Home → another space.

**Risk.** More frames per client; the server closes slow clients at
`MAX_QUEUED_FRAMES`. Optional **[BE, S]** `?types=` event-type filter.

## 8. Command Center (`/home`)

Rules for every section: **every count is a link** to a filtered workflow
whose target shows the same set, or the number is not shown; **no figure the
server did not compute**. Each section has loading (three-row skeleton), error
(inline, Retry, keeps last data and shows its age), empty (one sentence why +
a primary action) and permission (403 → section absent).

| # | Section | Data [E] | Freshness | Primary action | Needs [BE] |
| --- | --- | --- | --- | --- | --- |
| 1 | My active work | `GET /tasks?assignee=<me>&status=in_progress`; `GET /me/watching`; `GET /me/time` | stream `task.*` | open task; timer | confirm `assignee=me` accepted |
| 2 | Needs attention | review count (`GET /review`); hand-off counts (`GET /handoff-offers`); `GET /me/token-alerts`; `stale_flagged_at` | stream; alerts on visibility | deep links (`/insights?tab=usage` fixes B8) | unified feed via notifications |
| 3 | Agent execution | `GET /agents`, `/presence`, `/capacity`, `GET /agents/:id` sessions | presence 30 s visible-only; stream `task.claim_*`, `task.checkpoint_saved` | open agent / claimed task | org-wide claims; failure records |
| 4 | Pending reviews | `GET /review` (+ `truncated`) | stream `task.status_changed` | open review; Accept only via confirm/undo | — |
| 5 | Blocked | `GET /tasks/summary` → `blocked`; `GET /org/overview` | stream | count → filtered view, or `/work` with "list filter coming" — never a fake list | `blocked=true` on `GET /tasks` (S) |
| 6 | Deadlines | `due_on`; `overdue` in `/tasks/summary` | stream `task.updated` | overdue count only | `due_before/after`, `overdue` filters (S) |
| 7 | Recent deliverables | `GET /activity` filtered client-side | stream | open task › Evidence | `type=` on `/activity` for non-admins (S) |
| 8 | Project changes | `/activity`: `project.updated/archived/context_updated`, `sprint.*`, `member.*` | stream | open space / settings | "since last seen" via notifications |
| 9 | Suggested | derived **only** from rows above, rule-based, labelled "Suggested" | recomputed | link to the source row | AI suggestions under the AI policy |

Wireframes (1440 and 390) are in the Phase B source notes and summarised:
1440 = two columns (Needs attention, My work, Blocked/Overdue, Suggested,
Project changes | Agents, Pending reviews, Recent deliverables), live
indicator in the footer; 390 = one column, counts with top three rows, tiles
for Reviews / Blocked / Overdue / Agents, bottom bar.

Glass use: the Command Center's **cards are glass level 1** over the ambient
canvas; lists inside cards are solid (`design-system/visual-language.md` §3).

## 9. Agent Operations

### 9.1 What the server gives today (evidence)

1. **`GET /agents` returns only your own agents** — `listOwnAgents` filters on
   `owner_user_id` (`server/src/services/agents.ts:276-301`); `GET /agents/:id`
   is `getOwnAgent` (:304-313). No org-wide fleet.
2. **`/presence` and `/capacity` list people**; their agent entries are a
   client slug + `running` / `last_at`, no `agent_id`
   (`server/src/services/presence.ts:80-119, 202-210`). A join to agents is
   approximate (owner + harness slug).
3. **Session history exists** but is shown only inside disconnect dialogs
   (`ToolDetails.tsx:278-293`, `DeviceRoster.tsx:378-381`).
4. **A person has no stop, retry or resume.** `POST /agent-sessions/:id/end`
   is the agent's own (`server/src/services/claims.ts:604-615`); reclaim is
   agent-token only (`server/src/http/routes/tasks.ts:459`). A status change
   out of `in_progress` releases the claim (`server/src/services/tasks.ts:2351`)
   — that fences the agent off the task; it does not stop its process.

### 9.2 States (server-derived; the UI never invents one)

| State | Derivation | Source |
| --- | --- | --- |
| Accountable | `tasks.assignee_id` — always a person | `schema.ts:576` |
| Requested | `selected_agent_id` set; opens a `work_request` offer; no claim | `schema.ts:655-665`; `execution-derive.ts:116-126` |
| Executing | `TaskView.claim` non-null (active / paused, lease in force); `connection='live'` when heartbeat < 90 s | `claims.ts:117-120, 358-438` |
| ↳ paused | holder offered a hand-off | `routes/handoffs.ts:122-126` |
| Connection lost | live claim with `connection='suspect'` | `claims.ts:425`; `agent-states.ts:40-43` |
| Claim expired | lease (5 min) lapsed; scan writes `task.claim_expired` | `claims.ts:1364-1430` |
| ↳ recovery available | in progress, newest claim expired, unheld, live recovery offer or verified checkpoint | `task-handoff.ts:45-50` |
| Submitted for review | `finish` records a round, moves to review, releases the claim | `routes/tasks.ts:468`; `rounds.ts:289` |
| Session ended / revoked | `ended_at` + `end_reason` | `enums.ts:416`; `claims.ts:222-237` |

Never label "working" from presence alone. "Assigned to an agent" is never
shown: an agent is *selected*.

### 9.3 Controls

| Control | Today | v1 |
| --- | --- | --- |
| Request agent | `PATCH /tasks/:id` `selected_agent_id` | **Yes** (reuse `AgentPicker`) |
| Stop / pause / retry / resume | none for a person | **No button.** Optional "Move back to To do — releases the claim; the agent is not stopped", with a confirmation that says so |
| Inspect claim / checkpoints | `TaskView.claim`; `GET /tasks/:id/checkpoints` | **Yes** |
| Approve / name receiver / cancel hand-off | `POST /handoff-offers/:id/approve|cancel` per `next_action` | **Yes**, only when the server hint says so |
| Choose agent to continue | selection change | **Yes** |
| Ping capacity | `POST /agents/:id/capacity-pings` | **Yes** |
| Reconnect / rotate / revoke | `/agents/:id/*` | link to Developer › Tools; not duplicated |

### 9.4 Placement and first slice

- **Insights › Agents** (`?tab=agents`) beside Capacity and Usage — Insights
  is the org-level "reads across spaces" page. Developer access stays *setup*.
  A top-level `/agents` is the alternative if the owner prefers it in ORG; the
  content is the same.
- **First slice "Your agents" [UI]:** roster from `GET /agents` +
  `GET /agents/:id` (connection, harness / model self-reported, last
  heartbeat, 20 sessions with `end_reason`); presence chip labelled "via
  presence"; launcher chip and Ping; "Working on" and "Requested" from a paged
  task scan, labelled as such; hand-offs strip from
  `GET /handoff-offers?view=needs_approval|recovery`; live through the org
  stream.
- The page states its scope ("Your agents") and never implies org-wide
  coverage. Org-wide fleet waits for **[BE, M]** an `agent.read_any`-style
  action, endpoint and §3.1 row.

Glass use: roster **cards / panels are glass level 1**; the session table
inside is solid.

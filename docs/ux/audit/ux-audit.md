# UX audit — executive assessment and broken list

**Phase A deliverable (evidence).** Basis `9ac3be1f`. Sources: five read-only
code audits, four specification drafts, and a 204-screenshot visual audit of a
locally seeded instance. Recommendations in §5 are proposals.

## 1. Verdict: strong engine, inconsistent cockpit

Laika already records more about agent work than most tools show — exclusive
numbered claims, heartbeats, verified checkpoints with file manifests,
per-round evidence whose every item is *claimed / confirmed / failed*, review
decisions, hand-offs with approval policy, versioned project context. The UI
exposes much of it, but scattered across a 1,257-line task panel, a
developer-access area and three Inbox tabs. Nobody can walk in and answer
*what is happening, what did agents produce, can I trust it, what must I
decide* without reconstructing it.

What holds the experience back:

1. **Broken paths and silent failures.** The task drawer is empty outside
   Board and List (B1/V1). Task links from Meeting review and Unlisted can open
   the wrong space (B2, B18). Errors stick or masquerade as empty states
   (B5–B7). Buttons look enabled and do nothing (B10). Accept is one click
   with no undo (B9). Settings save silently (B11). There is no path to a first
   space (B21).
2. **No shared interaction layer.** Toasts, tooltips, popovers, tabs, inline
   confirms, polling and "open a task" each exist in 2–8 hand-rolled copies
   with different behaviour. 15 of 27 dialogs skip the focus trap. 22 z-index
   values collide (B16).
3. **The task is a long scroll, not a workroom.** Evidence is hidden until the
   first finish; decisions and open questions sit unread in checkpoint
   summaries; there is no execution timeline.
4. **No place for management.** No overview, review pack or presentation mode
   — although the data for an honest one (evidence states, rounds, metrics,
   forecasts) largely exists.
5. **Not live where it matters.** The server already streams org-wide events;
   the SPA listens per space only, so Inbox, Work, My Day and badges poll on
   timers (some twice, some while hidden — B14).
6. **Hierarchy and consistency drift.** The space header changes layout per
   tab (V3) and collapses at 390 (V4); the board toolbar carries eleven
   controls (V6); four words for "project" (V10).
7. **Performance debt.** One main bundle — 1,880,428 B raw / 533,280 B gzip in
   the local build measured — for every screen; three `lazy()` imports.

**What to keep:** the token-and-test design discipline (colour in `theme.css`
only, `theme-single-source.test.ts`; the generated type scale), server-
authoritative permissions ("absent, not disabled"), URL-as-state, the shared
SSE and store architecture, TipTap, the in-house icon family, the accessible
hand-built charts, and the existing state components (`LoadingState`,
`EmptyState`, `ErrorState`, `ApiErrorState`, `PermissionDenied`).

## 2. Severity scale

| Level | Meaning |
| --- | --- |
| **P1** | Broken: the primary action of a view leads nowhere, data is wrong, or a keyboard / screen-reader user is trapped. |
| **P2** | Misleading or inconsistent: a user can complete the task but is likely to misread state or lose work. |
| **P3** | Polish: friction, density, copy. |

## 3. Broken and likely-broken list (deduplicated)

One row per defect. Where the code audit (B) and the visual audit (V) found
the same thing, it appears once with both ids. *Phase* is the proposed home
(see `roadmap/implementation-roadmap.md` §6 — the Foundation track is an open
question). Screenshot names refer to the local, uncommitted evidence set.

| Id | Sev | Issue | Evidence | Proposed phase |
| --- | --- | --- | --- | --- |
| **B1 = V1** | P1 | Opening a task on `/timeline`, `/calendar` (and by code reading `/sprints`, `/dashboard`, `/activity`, `/meeting-review`) shows an **empty drawer**: `SpaceLayout` mounts the frame on any `?task=`, but only `BoardScreen` portals content into it. No task request is sent. | `SpaceLayout.tsx:259-270`; `TaskDrawer.tsx:123` (empty slot); `BoardScreen.tsx:1761-1809`. Screens: `drawer-calendar-1440-dark.png`, `drawer-timeline-1440-dark.png` vs `drawer-board-1440-dark.png` | C (Workroom S0) |
| B2 | P1 | Meeting review "open task" goes to `/board?q=KEY` with no project — may open the wrong space. | `ScreenOutlet.tsx:119-150`; `my-day/task-link.ts:16-18` | C |
| B18 | P1 | Same failure from Unlisted › open task. | `ScreenOutlet.tsx:119-123, 214` | C |
| **B3 + B22** | P1 | Task panel declares `role="dialog"` + `aria-modal` but has **no focus trap** (`useDialogFocus` unused); the overflow menu is a bare `<ul>` with no Escape of its own, so Escape closes the whole drawer. | `TaskDetailPanel.tsx:639-646, 752-799`; `TaskDrawer.tsx:87-99`; `use-dialog-focus.ts:42` | C |
| B4 | P2 | "Detach from parent" fires immediately; failure is silent (`void updateTask(...).then(...)`, no catch). | `TaskDetailPanel.tsx:786-795` | C |
| B5 | P1 | Calendar and Activity render a **load error as an empty view**, no retry. | `CalendarScreen.tsx:42-50`, `ActivityScreen.tsx:39-47` (`status === 'error' ? []`) | Foundation |
| B6 | P2 | Capacity and Unlisted errors never clear after recovery; no retry. | `CapacityScreen.tsx:192-229`; `UnlistedScreen.tsx:57-59, 119` | Foundation |
| B7 | P2 | My Day replaces the whole day with an error card on any failed re-read. | `MyDayScreen.tsx:376-383` | Foundation |
| **B8** | P2 | Insights badge counts token alerts but the link lands on Capacity; alerts live on Usage. Screen reader hears "N waiting". | `ShellSidebar.tsx:76`; `page-tabs.ts:49-52`; `Sidebar.tsx:160` | Foundation |
| **B9** | P1 | Review **Accept is one click**, no confirm or undo. "Open on board" calls `preventDefault()` on every click, breaking cmd-click. | `ReviewScreen.tsx:486-495, 508-515` | C (ApprovalBar) |
| B10 | P2 | v3 *Reconnect (new credential)* (non-paired) and *Disconnect device* are `aria-disabled` with no visible reason; the click returns early. They look enabled and do nothing in those states. | `ToolDetails.tsx:563-570`; `DeviceDetails.tsx:159-169` | Foundation |
| B11 | P2 | Space settings General draft lost on tab switch / reload; settings saves give no "Saved". | `GeneralTab.tsx:53`, `AccessTab.tsx:40`, `DangerTab.tsx:29` | Foundation |
| B12 | P1 (kbd) | Inline `role="alertdialog"` confirms take no focus. | `DangerTab.tsx:77-78`, `MembersTab.tsx:317`, `AccessTab.tsx:132`, `SprintsScreen.tsx:195` | Foundation |
| B13 | P3 | `/members` duplicates Space settings › Members (no undo). | `MembersScreen.tsx`; `route-table.ts:318` | Foundation |
| **B14** | P3 | Review queue polled twice (60 s shell, 20 s screen, 200 rows to count); three of four shell pollers ignore tab visibility. | `use-review-count.ts:56`; `ReviewScreen.tsx:45, 92` | F (org SSE) |
| B15 | P2 | Unlisted promote takes the space as free text (`laika-core` placeholder); Enter does not submit. | `UnlistedList.tsx:205-245` | Foundation |
| B16 | P2 | z-index collision: Dropdown (60) paints under SidePanel (61). | `dropdown.css:102-104`; `side-panel.css:11-20` | Foundation (layer tokens) |
| B17 | P2 (inferred) | Board card drag uses HTML5 DnD — no touch path. | `TaskCard.tsx:148-155` | later (dnd-kit evaluation) |
| B19 | P2 | Create from any space tab jumps to Board `?new=task`; the user loses Timeline / Calendar context. | `SpaceLayout.tsx:211-222` | C |
| B20 | P2 (a11y) | `aria-selected` on `<tr>` in a plain `<table>`; row open is mouse-only. | `ListView.tsx:309, 400-403` | Foundation |
| B21 | P2 | With zero spaces the SPACES section disappears and the Board empty state offers no action; `/projects` is reachable only by typing it. | `Sidebar.tsx:208`; `BoardScreen.tsx:958-966`; `EmptyState.tsx:13` (action prop unused) | Foundation |
| B23 | P3 | Stale comment says `/dashboard` requires `audit_log.export`; the route is not gated. | `nav-permissions.ts:5-8` vs `route-table.ts:179-185` | Foundation |
| B24 | P3 | Every space view fetches all meeting-review pages (limit 200) to count pending; three side requests swallow errors. | `SpaceLayout.tsx:127-158` | Foundation |
| B25 | P3 | Comment says Calendar is excluded; it is a shipped tab. | `route-table.ts:10-11` vs `157-162` | Foundation |
| B26 | P2 (a11y) | `DayTabs` declares tablist/tab with no arrow keys; mixes `aria-current` and `aria-selected`. | `DayTabs.tsx:26-37` | Foundation |
| **V2** | P1 | **My Day is a dead end when time tracking is off**: one card ("Time tracking is off … Open Organisation settings") while the person has 8 assigned tasks, several overdue. The toolbar above it changes nothing. | `my-day-1440-dark.png`, `my-day-1440-light.png`, `my-day-390-dark.png` | Foundation |
| **V3** | P1 | **Space header changes layout per tab**: Calendar, Sprints, Activity and Meeting review squeeze the filter set into the title row, pushing Agents and Create down ~35 px. Meeting review shows filters over an empty page. | `board-1440-dark.png` vs `calendar-1440-dark.png`, `sprints-1440-dark.png`, `meeting-review-1440-dark.png` | Foundation |
| **V4** | P1 | **Header collapses at 390** on the filtered views: five stacked filter rows, the title overlapping "Any tag", ~220 px before content; the tab bar cuts off at "Sprin" with no scroll cue. | `calendar-390-dark.png`, `sprints-390-dark.png`, `board-390-dark.png`, `list-390-dark.png` | Foundation |
| V5 | P2 | Board hides most tasks by default (active sprint, 8 of 22) behind a small chip; List shows all sprints — scope changes between tabs. Sprint badge "S2" reads like size chip "S". | `board-1440-dark.png` vs `list-1440-dark.png` | Foundation |
| **V6** | P2 | **Board toolbar clutter**: 11 controls between search and columns, five icon-only; search truncates at 1024; stats become bare icons at 768; three rows at 390. | `board-1440-dark.png`, `board-1024-dark.png`, `board-768-dark.png`, `board-390-dark.png` | Foundation |
| V7 | P2 | Agent work attributed to the human ("*‹person›* via Codex · Belka commented"); display names ignored; the agent line wraps three lines on a card. | `activity-1440-dark.png`, `organisation-activity-1440-light.png` | C (Identity) |
| **V8** | P2 | **Roles & permissions is a wall of ~120 equal chips** — no grouping, contrast or search. | `organisation-roles-1440-dark.png` | later |
| V9 | P2 | Tables clip at narrow widths with no scroll cue (People at 390, List at 390, Sprints at 390, Board column at 768). | `organisation-people-390-light.png`, `list-390-dark.png`, `sprints-390-dark.png`, `board-768-dark.png` | Foundation |
| V10 | P2 | **Four words for "project"** (Project, Space, Workspace, Key/slug); slugs leak ("laika · 3 sprints"); `lead` vs "Space admin". | `projects-1440-dark.png`, `sprints-1440-dark.png`, `organisation-overview-1440-dark.png`; terminology table in `interaction-inventory.md` §3 | Foundation |
| V11 | P2 | Dashboard headline numbers say nothing or look wrong (identical touched / created; "0 people" contributors). | `dashboard-1440-dark.png` | E |
| V12 | P2 | Alarm-styled empty states and too much red (Activity "Agent sessions" full-height red panel; red active-sprint days on Calendar; red Delete on every sprint row). | `activity-1440-dark.png`, `calendar-1440-*.png`, `sprints-1440-dark.png` | Foundation |
| V13 | P3 | Developer access deep links land on the wrong tab (`?tab=connect` → Overview); three equal-weight status chips per device. | `developer-activity-1440-dark.png`, `developer-devices-1440-light.png` | Foundation |
| V14 | P3 | Collapsed rail: badge over icon, no group separators; pale active state in light. | `sidebar-collapsed-1440-dark.png`, `board-1440-light.png` | Foundation |
| V15 | P3 | Login says "Laika" twice; NotFound offers only "Go to the board". | `login-1440-dark.png`, `notfound-1440-dark.png` | Foundation |

**Cross-references.** B1 also causes J2's dead end (route inventory §6). B9's
cmd-click half is fixed by real `<a href>` links in the Workroom and
Breadcrumbs specs. B14 is retired by the org-wide stream
(`architecture/experience-architecture.md` §5). B16 is fixed by layer tokens
(`design-system/visual-language.md` §4.1). V7 is the Identity component
(`architecture/component-architecture.md` §2). V10's canonical words are in
`interaction-inventory.md` §3.

**Observed, not counted:** "Agents 1" vs "Agents 0" between tabs captured
minutes apart — most likely the seeding session going stale without
heartbeats. Both themes rendered every route with no theme-only breakage;
primary-button contrast measured 6.3:1 dark and 5.7:1 light.

## 4. Design-system state (summary)

| Strong | Untokenised / unguarded | Missing primitive (copies today) |
| --- | --- | --- |
| colour (`theme.css` only, tested); type scale (generated, drift test); spacing tokens (1,341 uses); Dropdown; ConfirmDialog; SidePanel; OverflowMenu; Switch; state components; LiveRegion | z-index (22 values); motion (one token, ~10 literal durations, 19 local reduced-motion blocks); breakpoints (29 values + JS copies); radius (232 literals); popover elevation | Toast (2), Tooltip (4 + 384 `title=`), Popover (8), Tabs with roving focus (4), InlineConfirm (5 shapes), `usePolled` (7), open-a-task (7 ways), Table, resizable panels, command palette, virtualisation, code highlighting |

`Button` is used in 22 files against 558 raw `<button>`; 15 of 27 dialogs
skip `useDialogFocus` (audit counts; the dialog-file count was 26 files in the
design-system pass, which counts files rather than dialogs).

## 5. Recommendation (proposal)

Fix what is broken first, build one implementation per interaction, then the
Workroom — with the deliverable design trial alongside — then the deliverable
engine, then management and proactive surfaces. The sequence and the open
question on *where* the stabilisation fixes sit are in
`roadmap/implementation-roadmap.md`.

# Route and screen inventory

**Phase A deliverable (evidence).** Basis `9ac3be1f`. Every route and tab in
the SPA: entry file, purpose, target user, primary and secondary actions,
data, permissions, states, responsive behaviour and known problems — then the
eight main journeys.

Source of truth: `server/web/src/routes/route-table.ts` (`ROUTES`,
`SPACE_TAB_GROUPS`), `components/shell/ScreenOutlet.tsx` (`SCREENS`
registry), `routes/page-tabs.ts` (in-page tabs), `routes/redirects.ts` (old
addresses). B-numbers refer to the deduplicated list in
[`ux-audit.md`](ux-audit.md) §3; visual findings (V-numbers) are cross-referenced
there. Citations are carried from the audit at `9ac3be1f`; those re-verified
for this set are listed in [`../README.md`](../README.md).

## 0. Global facts every route inherits

| Concern | Behaviour | Evidence |
|---|---|---|
| Auth | Every route is protected unless `public: true`. Login, Invite, Reset password, Setup and the two design pages are public | route-table.ts:57, 334-350 |
| Nav visibility | A route appears in the nav only with a `status`; gated by `requires` → `permissionHolder(GET /permissions me.actions)`. "Absent, not disabled" | route-table.ts:117, 469-500; nav-permissions.ts:16-18 |
| Permissions failure | One banner with Retry; gated controls stay hidden | ScreenOutlet.tsx:577-595 |
| `?project=` | Carried by nav links unless the route is `orgLevel` | route-table.ts:93; Sidebar.tsx:128 (`navHref`) |
| Redirects | `/review`, `/unlisted` → `/inbox?tab=…`; `/capacity`, `/usage` → `/insights?tab=…` (Capacity drops `project`); `/tokens`, `/connect`, `/developer/connect` → `/developer?tab=…`. Applied as replace | redirects.ts:30-38 |
| 404 | Unknown path, or a routed path with no registry entry → `NotFound` | ScreenOutlet.tsx:544-552, 597-602 |
| Space frame | `layout: 'space'` routes are wrapped in `SpaceLayout` (top bar + view tabs + slot + band + task drawer on `?task=`) | ScreenOutlet.tsx:505-512, 561-564; SpaceLayout.tsx:166-271 |
| Polling | Shell pollers: review count 60s, unlisted, token alerts, handoff counts. Most ignore tab visibility (B14) | use-review-count.ts:56; use-unlisted-count.ts:45; token-alerts.ts:105; use-handoff-counts.ts:42 |
| Responsive | Off-canvas sidebar via `ShellHeader` toggle; phone sheet drawer below 600px; 29 distinct breakpoints, not tokenised | ShellHeader.tsx:34; TaskDrawer.tsx:100-120; `ux-audit.md` §4 |
| Reduced motion | Per file only. No global rule | e.g. drawer.css, space.css, board-motion.css (`prefers-reduced-motion`) |
| Bundle | One 1.8 MB chunk, 3 `lazy()` imports, no route splitting | `ux-audit.md` §4 |

Legend for users: **IC** = individual contributor (human or the person behind an agent), **Mgr** = project/tech manager / space admin, **Exec** = executive / org owner, **Admin** = org admin.

---

## 1. Space views (layout `space`; all need `?project=<slug>`; all accept `?task=<id>` for the drawer)

The shared frame (`SpaceLayout.tsx`) supplies:
- **Top bar** (`SpaceTopBar.tsx`): space name, member faces as an assignee filter (`aria-pressed`, :195-204), Search `?q=` (:259), Priority / Tag / Assignee dropdowns (:278-330), Ready toggle `?ready=` (:334-338), Agent-only `?agent=` (:377-386), Create button gated `task.create` (SpaceLayout.tsx:211-224).
- **View tabs** (`ViewTabs.tsx:33-86`): links with `aria-current`, modified clicks respected; Meeting review count badge.
- **Side data**: `GET /projects/:slug/members`, every page of `GET /projects/:slug/meeting-reviews` (limit 200, just to count pending), `GET /projects/:slug/tags`. All three swallow errors silently (SpaceLayout.tsx:127-158).

### 1.1 `/board` — Board
- **Params**: `project`, `task`, `new=task`, `q`, `priority`, `tag`, `assignee`, `agent`, `ready`, `group` (BoardScreen.tsx:715), `sprint` (filter popover).
- **Entry**: `ScreenOutlet.tsx:77-93` → `routes/screens/BoardScreen.tsx` (1813 lines) → `board/KanbanView.tsx`, `board/LaneRow.tsx`, `board/TaskCard.tsx`, `board/BoardToolbar.tsx`, `board/TaskDetailPanel.tsx`.
- **Purpose**: the space's work by column/lane. Primary place to create, move and open tasks.
- **Target user**: IC (primary), Mgr.
- **Primary action**: open a task (card key button, TaskCard.tsx:255-276); move a card (drag or Alt+Arrow, TaskCard.tsx:148-155, 261-271).
- **Secondary**: create task (`?new=task`, NewTaskForm.tsx); filter/group/sprint (BoardToolbar); column add/rename/reorder/delete/hide (ColumnComposer, NewColumnDialog, DeleteColumnDialog, HiddenColumnsDialog, LaneRow.tsx:421-582); view settings (ViewSettings.tsx); board insights popover (BoardInsights.tsx:73).
- **Hierarchy**: space bar → toolbar (sprint stats DONE/BLK/LEFT, filters) → scope/status notices (BoardScreen.tsx:1350-1461) → lanes of cards → drawer.
- **Interaction patterns**: HTML5 drag and drop; keyboard move; popover filters; inline column rename (Escape cancels, LaneRow.tsx:481-483); drawer via URL push.
- **Data**: `GET /projects`, `GET /projects/:slug`, `GET /projects/:slug/tasks`, statuses (`/projects/:slug/statuses`, order), sprints (`/projects/:slug/sprints`), `PATCH /tasks/:id/status`, `/tasks/:id/reorder`, `POST /projects/:slug/tasks`, `PATCH /projects/:slug` (hide-done), SSE `useEvents` (BoardScreen.tsx:38).
- **Permissions**: `task.create` (:638), `task.write` (:639), `project.settings.edit` (:642, :660 — columns/view settings), `task.assign_sprint` (:1620, :1780).
- **States**:
  - Loading: `LoadingState` table/lanes (BoardScreen.tsx:1494-1500); drawer `LoadingState shape="drawer"` (:1763).
  - Error: `ApiErrorState` for projects (:953) and the board with retry (:1508); bad filter `role="alert"` (:1390); alerts (:1452, :1461).
  - Empty: "No projects yet" with **no action** (:961-964, B21); lane empty (KanbanView.tsx:67).
  - Stale/truncated: `role="status"` notices (:1362-1422).
  - Success: card moves announced via `aria-live` (LaneRow.tsx:774).
- **Mobile vs desktop**: board-toolbar.css has 2 max-width queries, board.css none. Lanes scroll horizontally. Drag likely fails on touch (B17). The drawer becomes a bottom sheet below 600px (TaskDrawer.tsx:100-120).
- **A11y requirements**: card keyboard move exists (`aria-keyshortcuts`, TaskCard.tsx:264). The drawer must trap focus (B22). Lane drag needs a non-drag alternative (Alt+Arrow exists for cards; for lane reorder only drag is evident, LaneRow.tsx:421).
- **Existing problems**: B3/B22 drawer focus; B4 Detach no confirm (TaskDetailPanel.tsx:786-795); B17 touch drag; B21 empty with no create action; BoardScreen is 1813 lines (`../architecture/component-architecture.md` §3); `role="menu"` hand-rolled at BoardScreen.tsx:1199.

### 1.2 `/list` — List
- **Params**: same as Board, plus sort and page from the URL (ListView.tsx:71, LAI-485).
- **Entry**: `BoardRoute` (ScreenOutlet.tsx:506) → `BoardScreen` in list mode → `list/ListView.tsx`, `list/BulkBar.tsx`, `list/ListMenu.tsx`.
- **Purpose**: sortable table of the space's tasks with bulk edit.
- **Target user**: IC, Mgr (bulk triage).
- **Primary action**: open a row (row `onClick`, ListView.tsx:401-403).
- **Secondary**: select rows (checkbox :331, :415); bulk status/assign/sprint/cancel (BulkBar.tsx:160-312); per-row status menu (:474-476); sprint add/remove (ListView.tsx:16); paging (:668-683).
- **Hierarchy**: header row (sortable, `aria-sort` :351) → rows → pager → bulk bar when anything is selected.
- **Interaction patterns**: checkbox multi-select; bulk bar region (BulkBar.tsx:174); inline two-step confirm for cancel (BulkBar.tsx:246); menu with Arrow/Escape (ListMenu.tsx:84-113).
- **Data**: as Board, plus `POST/DELETE /sprints/:id/tasks`.
- **Permissions**: `task.write` (rows selectable only when `mayEdit`, :400), `task.assign_sprint`.
- **States**:
  - Empty: "Nothing here for this filter" / "No tasks in this project yet" (:290-291).
  - Busy: per-row `Spinner` (:487).
  - Bulk progress and report: `role="status"` (BulkBar.tsx:306, :312).
  - Loading and error: inherited from BoardScreen.
- **Mobile**: list.css has **0** max-width queries. A wide table on a phone is unhandled (inferred horizontal scroll).
- **A11y requirements**: a row selection model valid for a table; keyboard way to open a row.
- **Existing problems**:
  - **B20** `aria-selected` on `<tr>` in a non-grid `<table>` (ListView.tsx:309, 400). The row's click target is mouse-only.
  - No undo for bulk changes; only cancel has a confirm (BulkBar.tsx:246).

### 1.3 `/timeline` — Timeline (`status: building`)
- **Params**: `project`, `task`, sprint chips in the band slot.
- **Entry**: `TimelineScreen` (ScreenOutlet.tsx:507) → `routes/screens/timeline/TimelineScreen.tsx` (1047 lines), `use-timeline.ts`.
- **Purpose**: tasks over time by sprint/dates.
- **Target user**: Mgr, Exec.
- **Primary action**: scan the schedule; open a task (`?task=` push, TimelineScreen.tsx:396-397).
- **Secondary**: pick a sprint chip (band slot); change project (:137).
- **Hierarchy**: sprint band → rows (task side + bars) → notices.
- **Data**: `GET /projects`, tasks, statuses, sprints, `GET /projects/:slug/members`.
- **Permissions**: none checked in-screen (read).
- **States**:
  - Error: projects `ApiErrorState` (:309); timeline `ApiErrorState` (:325).
  - Loading: `LoadingState` rows (:317).
  - Notices: `role="status"` (:342-355).
  - Empty: `EmptyState` (:368); per-row "none" (:771-969, :1018, :1039).
- **Mobile**: timeline.css has 1 max-width query.
- **A11y requirements**: bars need text equivalents; keyboard reachability of each bar (not verified).
- **Existing problems**: **B1** opening a task shows an empty drawer — the frame opens on `?task=` (SpaceLayout.tsx:261) but only BoardScreen portals content into it (TaskDrawer.tsx:144-153; BoardScreen.tsx:1761-1809). **B19** Create jumps to Board.

### 1.4 `/calendar` — Calendar
- **Params**: `project`, `task`.
- **Entry**: `CalendarRoute` (ScreenOutlet.tsx:153-167) → `calendar/CalendarScreen.tsx` (241 lines).
- **Purpose**: tasks by due date.
- **Target user**: IC, Mgr.
- **Primary action**: open a task chip (`?task=` push, ScreenOutlet.tsx:160-164).
- **Data**: `useProjectTasks`, `useProjectStatuses`, `GET /projects/:slug/sprints` (CalendarScreen.tsx:1-7).
- **Permissions**: none.
- **States**:
  - Empty (no project): "No space chosen" (:76).
  - Loading: `LoadingState` card (:82).
  - **Error is rendered as an empty calendar** (:42-50, comment "A failure is an empty calendar") — **B5**.
- **Mobile**: calendar.css has **0** max-width queries.
- **Existing problems**: B1 (empty drawer), B5, B19. The route comment says Calendar is excluded (route-table.ts:10-11), yet it is a shipped tab (:157-162) — a stale comment.

### 1.5 `/sprints` — Sprints (`building`)
- **Entry**: `SprintsScreen` (ScreenOutlet.tsx:509) → `sprints/SprintsScreen.tsx`, `SprintCard.tsx`, `SprintForm.tsx`, `AssignTasksPanel.tsx`.
- **Purpose**: plan and run sprints.
- **Target user**: Mgr.
- **Primary action**: create or edit a sprint (SprintForm).
- **Secondary**: assign tasks (AssignTasksPanel); delete (inline alertdialog :195).
- **Data**: `GET/POST /projects/:slug/sprints`, `PATCH/DELETE /sprints/:id`, `/sprints/:id/tasks`, `/sprints/:id/forecast`.
- **Permissions**: `sprint.manage` (:103), `task.assign_sprint` (:104).
- **States**:
  - Error: projects `ApiErrorState` (:109); sprints `ApiErrorState` (:236).
  - Empty: no projects (:117); no sprints, "A space admin can plan the first one." (:243-248).
  - Loading: `LoadingState` (:234).
  - Alert (:161); busy `Spinner` (:216); note (:265).
- **Mobile**: sprints.css has **0** max-width queries.
- **Existing problems**: inline delete `role="alertdialog"` without focus management (:195; same class as B12).

### 1.6 `/dashboard` — Dashboard (`building`)
- **Entry**: `DashboardScreen` (ScreenOutlet.tsx:510) → `dashboard/DashboardScreen.tsx`, `StatCards`, `StatusOverview`, `Throughput`, `PriorityBreakdown`, `Contributors`, `CardFilter`.
- **Purpose**: space health — status mix, throughput, contributors.
- **Target user**: Mgr, Exec.
- **Primary action**: read. Secondary: card filters (CardFilter.tsx:105 popover), open a contributor's profile (Contributors.tsx:276, gated).
- **Data**: `/projects`, `/projects/:slug/sprints`, `/projects/:slug/metrics`, tasks, activity.
- **Permissions**: none in-screen. **B23**: the comment at nav-permissions.ts:5-8 claims `/dashboard` requires `audit_log.export`; the route table does not gate it (route-table.ts:179-185).
- **States**:
  - Error: projects (:169); dashboard (:217).
  - Empty: (:195).
  - Loading: skeleton (:209).
  - Notes and stale: `role="status"` (:462-467).
- **Mobile**: dashboard.css has 1 max-width query.
- **Existing problems**: CardFilter popover is `role="dialog"` with no focus hook (CardFilter.tsx:105).

### 1.7 `/activity` — Activity (space)
- **Entry**: `ActivityRoute` (ScreenOutlet.tsx:169-176) → `activity/ActivityScreen.tsx`, `ActivityPanels.tsx`.
- **Purpose**: the old board rail — live stream, agent sessions, stale tasks.
- **Target user**: Mgr, IC.
- **Primary action**: watch. Secondary: open a task (inferred, via panel links).
- **Data**: `GET /projects/:slug/activity`, members, tasks, `useMyAgents` (presence re-read on an interval, use-my-agents.ts:68), SSE.
- **States**:
  - Empty (no project): "No space chosen" (:86).
  - Loading: (:92).
  - Error shown as empty (:39-47, **B5**).
- **Mobile**: activity.css has 1 query.
- **Existing problems**: B5. Org-wide SSE is unused (backend-readiness audit; `../roadmap/implementation-roadmap.md` §4).

### 1.8 `/meeting-review` — Meeting review
- **Entry**: `MeetingReviewRoute` (ScreenOutlet.tsx:141-151) → `meeting-review/MeetingReviewScreen.tsx`, `review-derive.ts`.
- **Purpose**: turn a meeting transcript into proposed task changes and apply or discard them.
- **Target user**: Mgr.
- **Primary action**: apply proposals. Secondary: discard; open a referenced task.
- **Data**: `GET /projects/:slug/meeting-reviews`, `GET/POST /meeting-reviews/:id`, `/apply`, `/discard`; LLM provider server-side (backend-readiness audit; `../roadmap/implementation-roadmap.md` §4).
- **States**:
  - Empty (no project): "Pick a project" (:145) — the copy says *project* where sibling tabs say *space*.
  - Error: `ApiErrorState` (:148); detail error `role="alert"` (:264).
  - Loading: list (:151); proposals (:250).
  - Empty list: (:219).
  - Blocked: `role="status"` (:258).
  - Busy: `Spinner` (:312); count `aria-live` (:298).
- **Existing problems**: **B2** open task → `/board?q=KEY` with no project (ScreenOutlet.tsx:119-123, 148).

---

## 2. HOME routes (layout `plain`, `orgLevel`)

### 2.1 `/my-day` — My day
- **Params**: `day` (push), `user` (another person's day, read-only, push) (ScreenOutlet.tsx:251-279). In-screen tabs: `DayTabs.tsx` ("Day sections").
- **Entry**: `MyDayRoute` → `my-day/MyDayScreen.tsx` (2144 lines), `Timeline.tsx` (2160), `TimelineMobile.tsx`, `TimerControl.tsx`, `DraftList.tsx`, `Inspector.tsx`, `OnYourPlate.tsx`, `WeekStrip.tsx`, `Toast.tsx`.
- **Purpose**: the person's day — timer, time drafts and entries, review queue items, what is on their plate; confirm the day.
- **Target user**: IC (own); Admin/Mgr (someone else's, read-only).
- **Primary action**: start/stop the timer (TimerControl.tsx:105-169); confirm drafts and the day (MyDayScreen.tsx:1502, :1756).
- **Secondary**: new entry (NewEntryPanel), split/dismiss drafts, breaks, day note, week navigation, view another person (ViewingSwitch).
- **Hierarchy**: header (day picker, viewing switch) → timer → timeline/wheel → drafts → plate → summary.
- **Interaction patterns**: timeline drag (tray-drag.ts); toast with Undo (Toast.tsx:47-60); keyboard shortcuts sheet (shortcuts.ts, ShortcutSheet.tsx); phone-specific layout via `usePhone` (MyDayScreen.tsx:75, :353).
- **Data**: `/me/time*` (entries, drafts, timer, breaks, settings, summary, undo, days/:day/confirm|note), `/people/:id/time*`, `/projects`, the review queue from the shell.
- **Permissions**: `people.analytics.read` for other people (PermissionDenied :694).
- **States**:
  - Loading: `DaySkeleton` (:726).
  - Error: `ApiErrorState` (:705); `DayError` (:714).
  - Empty: `DayEmpty` (:1893).
  - Read-only banner (:641); drafts-off banner (:1870); toast (Toast.tsx).
- **Mobile**: dedicated `TimelineMobile.tsx`, `MyDayPhoneBar`, `MyDayPhoneHead`, phone.css.
- **A11y**: `role="timer"` (TimerControl.tsx:105); DayTabs use `role="tab"` but have no arrow-key handling (DayTabs.tsx:26-37).
- **Existing problems**: **B7** any failed re-read replaces the whole day with an error (MyDayScreen.tsx:376-383); my-day.css is 3274 lines (`../architecture/component-architecture.md` §3); a private Toast (Toast.tsx) instead of a shared one.

### 2.2 `/inbox` — Inbox (tabs: `review`, `handoffs`, `unlisted`)
- **Entry**: `InboxRoute` (ScreenOutlet.tsx:314-351) → `inbox/InboxScreen.tsx` (ScreenHeader + `PageTabs` "Inbox sections", :26-41).
- **Tab rules**: `INBOX_TABS` (page-tabs.ts:42-46). `unlisted` requires `audit_log.export`. An unknown or refused tab falls back to the first (page-tabs.ts:294-302).
- **Sidebar badge**: review + handoffs + unlisted (ShellSidebar.tsx:75; page-tabs.ts:332-341).

#### 2.2a `?tab=review` — Review
- **Entry**: `ReviewRoute` (ScreenOutlet.tsx:300-307) → `review/ReviewScreen.tsx`, `SendBackDialog.tsx`, `task/EvidenceSection.tsx`.
- **Purpose**: tasks agents or people moved to review that this person can decide.
- **Target user**: IC (assignee), Mgr (space admin).
- **Primary action**: Accept (ReviewScreen.tsx:484-495).
- **Secondary**: Send back… (dialog, :497-507); Open on board (:508-515); expand evidence (:468-476).
- **Hierarchy**: header with count → rows (key, title, chips: commits/PR/tests/CI :440-462) → expanded evidence → actions.
- **Data**: `GET /review`, `POST /tasks/:id/accept`, `/send-back`, `GET /tasks/:id/rounds`; polls every 20s, visibility-aware (ReviewScreen.tsx:45, :60-73).
- **Permissions**: per row `can_decide` (:487, :517-521).
- **States**:
  - Error: `ApiErrorState` (:208).
  - Loading: (:217).
  - Empty: two `EmptyState`s (:374, :379).
  - Row error: `role="alert"` (:481); busy: `Spinner` (:494).
- **Mobile**: review.css has 1 query.
- **Existing problems**:
  - **B9** Accept is one click with no confirm or undo (:484-495). "Open on board" prevents default on every click, which breaks cmd-click (:510-513).
  - **B14** double polling.

#### 2.2b `?tab=handoffs` — Hand-offs
- **Entry**: `inbox/HandoffsTab.tsx` (652 lines), mounted at ScreenOutlet.tsx:340-345.
- **Purpose**: offers between agents that wait on this person.
- **Primary action**: Approve (HandoffsTab.tsx:578-592). Secondary: Withdraw (:594-609), view filter tabs (:303-325).
- **Data**: `GET /handoff-offers`, `POST /handoff-offers/:id/approve|cancel`; polls (:173).
- **States**:
  - Loading: (:389). Error: `ApiErrorState` with retry (:392). Empty: (:395).
  - Stale and waiting notices (:359, :369); row error `role="alert"` (:618); row status live (:623).
- **A11y**: good — the tablist has roving tabindex and arrows (:246, :315-325); `aria-disabled` keeps focus during writes (:582, :599).
- **Problems**: the button says "Withdraw", the endpoint is `cancel` (handoffs.ts) and the permission is `task.handoff.cancel` (TaskDetailPanel.tsx:607) — terminology.

#### 2.2c `?tab=unlisted` — Unlisted work (requires `audit_log.export`)
- **Entry**: `UnlistedRoute` (ScreenOutlet.tsx:208-215) → `unlisted/UnlistedScreen.tsx`, `UnlistedList.tsx`.
- **Purpose**: work agents logged without a task; promote to a task or dismiss.
- **Target user**: Admin, Mgr.
- **Primary action**: Promote (UnlistedList.tsx:205-245). Secondary: dismiss, show dismissed.
- **Data**: `GET /unlisted` (every page), `POST /unlisted/:id/promote`, `PATCH /unlisted/:id`, `GET /users`.
- **States**: error (:120); loading (:122); empty (:124).
- **Problems**:
  - **B6** errors stick (:57-59, :119).
  - **B15** promote takes the space as free text, and Enter doesn't submit.
  - **B18** open task by key with no project (ScreenOutlet.tsx:214).

### 2.3 `/work` — Work (all spaces)
- **Params**: filters in the URL (replaced), including `space`.
- **Entry**: `WorkRoute` (ScreenOutlet.tsx:285-298) → `work/WorkScreen.tsx`, `work-derive.ts`.
- **Purpose**: everyone's work across every space, filterable.
- **Target user**: Mgr, Exec, IC.
- **Primary action**: open a task in its own space (ScreenOutlet.tsx:131-139 — correct, fixes B2's class).
- **Secondary**: filter by space/person/status/sprint; work-by-person summary.
- **Data**: `GET /tasks`, `/projects`, sprints, `GET /users`.
- **Permissions**: `people.analytics.read` (WorkScreen.tsx:256) for the person figures.
- **States**:
  - Error: (:339). Loading: (:348); summary `aria-busy` (:507).
  - Empty: (:351, :362).
  - Range: `aria-live` (:450).
- **Mobile**: work.css has 1 query.
- **Problems**: no due/overdue filter (server gap, backend-readiness audit).

---

## 3. ORG routes

### 3.1 `/insights` — Insights (tabs `capacity`, `usage`)
- **Entry**: `InsightsRoute` (ScreenOutlet.tsx:353-367) → `insights/InsightsScreen.tsx`.
- **Sidebar badge**: token alerts count (ShellSidebar.tsx:76). The nav link carries no `?tab=usage`, so it lands on Capacity — **B8**. The screen reader also hears "N waiting" (Sidebar.tsx:160), which is wrong for alerts.

#### 3.1a `?tab=capacity` — Capacity
- **Entry**: `CapacityRoute` (:184-206; strips `?project=` :192-197) → `capacity/CapacityScreen.tsx`, `CapacityCard`, `CapacityList`.
- **Purpose**: who (people and agents) is working on what; load; pings.
- **Target user**: Mgr, Exec.
- **Primary action**: read. Secondary: ping an agent (PingButton), open a profile, jump to review/unlisted.
- **Data**: `GET /capacity`, `/presence`, `/projects`, `/agents/:id/capacity`, `/capacity-pings`; polls (:217).
- **States**: error (:229, sticky — **B6** :192-229); empty (:479); loading `aria-busy` (:604); SR summary (:474).
- **Mobile**: capacity.css has 0 queries.

#### 3.1b `?tab=usage` — Usage & cost
- **Entry**: `UsageRoute` (:222-244) → `usage/UsageScreen.tsx` (689 lines) and cards (AlertsBanner, BudgetsCard, PlanLimitCard, BySpaceCard, AcceptedCostCard, RunawayCard, CacheCard).
- **Purpose**: token spend by space/agent/model, budgets, alerts.
- **Target user**: Exec, Mgr, IC (own).
- **Primary action**: read and dismiss alerts. Secondary: set budgets, pick a space (`?project=`).
- **Data**: `GET /usage`, `/users/:id/usage`, `/me/token-alerts`, `/me/plan-limit`, budgets endpoints.
- **Permissions**: `usage.read_org` (:141), `usage.read_project` (:142).
- **States**: empty "No space to show" (:244-245); error (:249); empty (:423, :452).
- **Mobile**: usage.css has 0 queries.

### 3.2 `/organisation` — Organisation (tabs `overview`, `people`, `roles`, `integrations`, `security`*, `activity`*)
- **Entry**: `OrganisationRoute` (ScreenOutlet.tsx:409-434) → `organisation/OrganisationScreen.tsx` (813 lines), `PeopleTab.tsx` (907), `RolesPermissionsSection`, `GithubWebhookSection`, `ModelPricesSection`, `OrgActivity`, `InviteDialog`, `TransferOwnership`, `OffboardingDialog`.
- **Tab gates**: `security` requires `token.list_any`; `activity` requires `audit_log.export` and shows `PermissionDenied` when addressed directly (page-tabs.ts:61-69; OrganisationScreen.tsx:656).
- **Purpose**: org settings, people and roles, integrations, security tokens, audit history.
- **Target user**: Admin, Exec. Members read-only.
- **Primary action**:
  - People: invite (InviteDialog).
  - Overview: rename the org.
  - Security: revoke tokens.
- **Data**: `GET/PATCH /org`, `/org/overview`, `/org/permissions`, `/invites*`, `/users/*`, `/tokens`, `/org/github-webhook`, `/org/model-prices`, `/activity/history`, `/org/time*`, `/org/transfer-ownership`.
- **Permissions**: `user.invite`, `user.deactivate`, `org.developer_insights.set`, `org.time.set`, `token.list_any`, `token.revoke_any`, `org.settings.edit` (OrganisationScreen.tsx:128-136).
- **States**: loading (:309); error (:318); fact error (:472); history loading/error (:742, :750); error (:799); refused (:656).
- **Mobile**: organisation.css has 9 queries — the most responsive screen.
- **Problems**:
  - The Overview section heading says "Workspace settings" (:412) on a page called Organisation — terminology.
  - `me === undefined` renders `null` (ScreenOutlet.tsx:418).

### 3.3 `/developer` — Developer access (mode-dependent tabs)
- **Params**: `tab`, `agent`, `step`, `add`, `tool`, `device`, `section`, `setup=v3`. v3 aliases rewrite old ids (page-tabs.ts:159-220; ScreenOutlet.tsx:385-389).
- **Entry**: `DeveloperRoute` (ScreenOutlet.tsx:380-407) waits on `GET /developer/compatibility` (`LoadingState` :391) → `developer/DeveloperScreen.tsx`.
- **Modes**:
  - classic: `connect`, `agents`, `projects`, `activity`, `tokens` (page-tabs.ts:78-84).
  - v3: `overview`, `projects` (labelled "Project setup"), `devices`, `tools`, `advanced` (:94-100).
  - preview: classic plus the v3-only tabs badged "Preview" (:121-131).
- **Purpose**: connect coding agents/tools, manage the person's agents, devices, project setup, local activity sharing, personal tokens.
- **Target user**: IC (developer); Admin for insights consent.
- **Permissions**: `org.developer_insights.set` (DeveloperScreen.tsx:192, :226), `agent.manage_own` (AgentsTab.tsx:129; DeviceRoster.tsx:115).

| Tab | Entry | Primary action | Data | States / problems |
|---|---|---|---|---|
| connect (classic) | connect/ConnectScreen.tsx (1180) | 4-step wizard: pick agent → token → config → verify | `/tokens`, `/agents`, live poll (ConnectScreen.tsx:370) | Token shown once (TokensScreen.tsx:190-211 pattern) |
| agents (classic) | developer/AgentsTab.tsx (1797) | register/rename/rotate/revoke an agent | `/agents*`, `/agents/devices*` | SecretPanel `role="alert"` (:565); note/status/error (:363-408); lifting SecretPanel/useOnceSecret is the `component-architecture.md` §3 seam |
| projects | developer/ProjectsTab.tsx; v3/ProjectSetupTab.tsx (1759) | set up a repository for a tool | `/project-setups`, `/agents/:id/project-access` | Empty "No project to mirror work into" (ProjectsTab.tsx:134); v3 empty (ProjectSetupTab.tsx:307); re-check poll (:1262) |
| activity (classic) | connect/ShareActivity.tsx | opt into local activity sharing | `/me/activity-sharing`, `/me/local-activity` | v3: Advanced `?section=activity` |
| tokens (classic) | tokens/TokensScreen.tsx | create/revoke a personal token | `/tokens` | Reveal `role="alert"` (:194); error (:278) |
| overview (v3) | v3/OverviewTab.tsx | see setup status | compatibility, devices, tools | — |
| devices (v3) | v3/DevicesTab.tsx, DeviceRoster.tsx, DeviceDetails.tsx, AddDeviceWizard.tsx | pair a device | `/devices*`, `/devices/pairing-requests*` | **B10** "Disconnect device" is `aria-disabled` with no visible reason when the device has no live tool, and the click returns early (DeviceDetails.tsx:159-169); presence poll (DeviceRoster.tsx:205) |
| tools (v3) | v3/ToolsTab.tsx, ToolDetails.tsx, AddToolWizard.tsx, ToolUpdate.tsx | add a tool to a device | `/devices/:id/tools`, `/tool-setup/:id`, `/agents/:id/reconnect|verification` | **B10** non-paired "Reconnect (new credential)" is `aria-disabled` with no visible reason when no token is rotatable (ToolDetails.tsx:563-570) |
| advanced (v3) | v3/AdvancedTab.tsx | tokens and activity sharing | `/tokens`, `/me/activity-sharing` | audit: "Advanced retry" missing |

- **Mobile**: developer and v3 CSS files carry 1–4 queries each.
- **Problems**: three tab sets depending on deployment mode; the same id `projects` is labelled "Projects" or "Project setup" (page-tabs.ts:81, :96); *agent* vs *tool* vs *harness* naming (see terminology).

### 3.4 `/people?user=` — Member profile (requires `profile.read`)
- **Params**: `user`, `tab` (overview default, removed from the URL), `day` (ScreenOutlet.tsx:467-496).
- **Entry**: `profile/ProfileScreen.tsx` (1597 lines), `AdminPanel.tsx` (897), `ActivityCard.tsx` (991), `UsageCard`, `PersonHours`, `RatingDialog`.
- **Purpose**: one member's work, activity, hours, usage, admin actions.
- **Target user**: Admin, Exec.
- **Primary action**: read. Secondary: rate (`profile.rate` :380), admin actions — role, deactivate, sign out, reset password, revoke tokens (AdminPanel.tsx:104-114).
- **Data**: `/users/:id/profile`, `/users/:id/ratings`, `/people/:id/activity|time|local-activity`, `/users/:id/usage`, `/users/:id/*`.
- **States**:
  - Loading: (:260, :290).
  - Permission denied: (:269).
  - Empty: (:278, :300).
  - Error: (:305); action error (:658); busy (:632).
- **A11y**: profile tabs are links with `aria-current` (:452-458) — consistent with PageTabs.
- **Mobile**: profile.css has 0 queries; admin-panel.css has 1.

### 3.5 `/projects` — Projects (spaces directory)
- **Params**: filter/sort params via `onParamsChange` (ScreenOutlet.tsx:95-116).
- **Entry**: `ProjectsScreen.tsx` (504), `projects/SpaceCard`, `SpaceTable`, `SpacesToolbar`, `SpaceActions`, `ProjectContextPanel`, `ContextHistory`, `DeliveredTo`.
- **Reached from**: "More spaces" in the sidebar's SPACES section only (route-table.ts:173). The section is hidden when there are no spaces (Sidebar.tsx:208) — **B21**.
- **Purpose**: list, create, join, archive or restore spaces; edit project context.
- **Target user**: Mgr, Admin.
- **Primary action**: open a space (→ `/board?project=`).
- **Secondary**: create (`project.create` :110); settings (`project.settings.edit` :118, :199); members (→ `/members`, ScreenOutlet.tsx:111-113, **B13**); join; context panel (:480).
- **Data**: `/projects`, `/projects/:slug`, `/projects/:slug/join`, `/projects/:slug/context*`.
- **States**: create error (:329); loading (:397); error (:399); empty "No spaces yet" (:406-407); context error (:447); `role="alert"` (:469).
- **Mobile**: projects.css has 3 queries.
- **Problems**: the URL is `/projects`, the label is "Projects", the empty state says "No spaces yet" — terminology.

### 3.6 `/members?project=` — Members (orphan)
- **Entry**: `MembersRoute` (ScreenOutlet.tsx:436-442) → `MembersScreen.tsx`, `AddMemberForm.tsx`.
- **Purpose**: the same job as Space settings › Members. **B13** duplicate (route-table.ts:318).
- **Permissions**: `project.members.manage` (:92).
- **States**:
  - Empty: "No project chosen" (:74-76); "No members on this project yet" (:143).
  - Error: project (:87); members (:104, :137).
  - Loading: (:135).
- **Problems**: B13. Copy says "project"; Space settings says "space".

### 3.7 `/spaces/:slug/settings` — Space settings (tabs `general`, `members`, `access`, `danger`)
- **Entry**: `SpaceSettingsRoute` (ScreenOutlet.tsx:448-465; renders `null` without slug or me, :455) → `space-settings/SpaceSettingsScreen.tsx`, `GeneralTab`, `MembersTab` (700), `AccessTab`, `DangerTab`, `HandoffPolicySection`.
- **Tabs**: `SPACE_SETTINGS_TABS` (page-tabs.ts:270-275). All visible; controls gated inside.
- **Purpose**: configure a space.
- **Target user**: Mgr (space admin).
- **Primary action by tab**:
  - General: edit name, key, description.
  - Members: add, remove, change role.
  - Access: handoff policy and agent access.
  - Danger: archive or leave.
- **Data**: `GET/PATCH /projects/:slug`, members, `/projects/:slug/handoff-policy`, `/projects/:slug/leave`.
- **Permissions**: `project.settings.edit` (:109), `project.members.manage` (:110), `project.archive` (:111), `project.handoff_policy.edit` (:221).
- **States**:
  - Error: (:100). Loading: (:102).
  - Read-only label (space-settings-model.ts:85).
  - Inline alertdialogs: DangerTab.tsx:78, MembersTab.tsx:317, AccessTab.tsx:132 (**B12**).
- **Problems**:
  - **B11** General draft lost on tab switch; no "Saved" feedback.
  - **B12** inline alertdialogs take no focus.
  - The `?tab=` value isn't validated against tabs here; it is passed raw (ScreenOutlet.tsx:461) — behaviour on an unknown tab not verified.

---

## 4. Public and pre-auth routes

| Route | Entry | Purpose / primary action | Data | States | A11y / problems |
|---|---|---|---|---|---|
| `/login` | LoginRoute.tsx → LoginScreen.tsx | Sign in | `POST /auth`, `/me` | rejected `role="alert"` (:118); alert (:135) | `autoComplete` set (:145, :156); no `autoFocus` anywhere in auth screens (Foundation fixes) |
| `/invite?token=` | InviteRoute.tsx → InviteScreen.tsx | Accept invite: name, email, password | `GET /invites/:token`, `POST /invites/accept` | checking `Spinner` status (:135-136); alert (:225) | — |
| `/reset-password?token=` | ResetPasswordRoute.tsx → ResetPasswordScreen.tsx | Set a new password from an admin link | `POST /password-resets/consume` | note (:83); alert (:123); missing-token copy (:56) | — |
| `/setup` (own chrome) | SetupRoute.tsx → FirstBootScreen.tsx | First boot: owner account + first project | `GET /setup/status`, `POST /setup` | alert (:163); "already set up" (SetupRoute.tsx:53) | copy says "project" (:134, :237) |
| `/design/tokens`, `/design/states` | TokenReference.tsx, StateGallery.tsx | Reference pages, not product | — | — | public on purpose (route-table.ts:347-350) |
| 404 | NotFound.tsx | Way back | — | EmptyState (:22) | — |

---

## 5. Findings first recorded here (B18–B26)

| # | Issue | Evidence |
|---|---|---|
| B18 | Unlisted › open task uses `/board?q=KEY` with no project — same failure as B2 | ScreenOutlet.tsx:119-123, 214 |
| B19 | Create from any space tab navigates to Board with `?new=task`; the user loses Timeline/Calendar/Sprints context | SpaceLayout.tsx:213-222 |
| B20 | `aria-selected` on `<tr>` in a plain `<table>` (valid only in grid/treegrid); the row is click-to-open with no keyboard equivalent on the row | ListView.tsx:309, 389-404 |
| B21 | No space → no SPACES section in the sidebar and the Board empty state has no action; `/projects` is reachable only by typing it | Sidebar.tsx:208; BoardScreen.tsx:958-966; EmptyState.tsx:13 (action prop exists, unused) |
| B22 | Task panel declares `role="dialog"` + `aria-modal` but has no focus trap; the overflow menu is a bare `<ul>` (no `role="menu"`, no Escape of its own) | TaskDetailPanel.tsx:639-646, 763-799; use-dialog-focus.ts:42 not used |
| B23 | A comment claims `/dashboard` is gated on `audit_log.export`; the code doesn't gate it | nav-permissions.ts:5-8 vs route-table.ts:179-185 |
| B24 | Every space view fetches *all* meeting-review pages (limit 200 each) just to count pending reviews; three side requests swallow errors | SpaceLayout.tsx:127-158 |
| B25 | Comment says Calendar is excluded (§14 q10); Calendar is a shipped tab | route-table.ts:10-11 vs 157-162 |
| B26 | `DayTabs` declares `role="tablist"/"tab"` but has no arrow-key handling; it mixes `aria-current` and `aria-selected` | DayTabs.tsx:26-37 |

---

## 6. Journeys (top 8)

Visual-audit additions to the journeys: J5 also dead-ends when time tracking is
off (V2); J2 and every filtered view suffer the header shift (V3, V4).

### J1 — Delegate a task to an agent → watch → review evidence → accept
| # | Step | Route | Notes / friction |
|---|---|---|---|
| 1 | Open the space board | `/board?project=s` | via sidebar SPACES |
| 2 | Open the task | `?task=<id>` (push) | drawer; focus moves to the panel, not trapped (B22) |
| 3 | Choose agent | drawer → AgentRow / AgentPicker | AgentPicker.tsx:93-135 lists unavailable agents with a reason (good) |
| 4 | Agent claims and works | outside the UI (MCP) | the board updates by SSE |
| 5 | Watch | drawer ExecutionPanel / `/activity` | **dead-end**: no execution timeline; evidence hidden until the first finish (backend-readiness audit; `../roadmap/implementation-roadmap.md` §4) |
| 6 | Learn it's ready | sidebar Inbox badge | polled every 60s (B14); no notification |
| 7 | Review | `/inbox?tab=review`, expand row | evidence inline (ReviewScreen.tsx:468-476) |
| 8 | Accept / Send back | same | Accept is one click with no undo (B9) |

Interaction count: about 8 clicks across 3 places. The watch step has no dedicated surface.

### J2 — Create a task from a non-board view
`/timeline?project=s` → Create (SpaceLayout.tsx:213) → **jumps to `/board?project=s&new=task`** (B19) → NewTaskForm → the new task's drawer. Dead-end: the user leaves the view they planned in, and Back returns to the Board form state.

### J3 — Resolve an agent hand-off
Sidebar Inbox badge → `/inbox` (lands on the **Review** tab by default, page-tabs.ts:301) → click "Hand-offs" → Approve or Withdraw (HandoffsTab.tsx:578-609). Alternatively: drawer → HandoffSection "Review hand-off" (HandoffSection.tsx:123-137) → HandoffOfferDialog Approve / Withdraw offer.
Friction: the badge is one number for three queues, so the user has to hunt across tabs. The button says "Withdraw" while the permission and endpoint say cancel.

### J4 — Connect a coding agent (developer onboarding)
- Classic: `/developer` → Connect wizard (4 steps) → token revealed once → copy → verify (live poll) → Agents tab.
- v3: Overview → Devices › Add device (pairing) → Tools › Add a tool → Project setup.

Friction:
- The tab set depends on deployment mode (page-tabs.ts:121-131).
- A v3 "Reconnect" or "Disconnect" click does nothing (B10).
- The secret-reveal UI is duplicated (TokensScreen vs AgentsTab SecretPanel).

### J5 — Run my day and confirm time
`/my-day` → start timer (TimerControl) → work → stop → drafts appear → confirm drafts → Confirm day (MyDayScreen.tsx:1502/1756).
Dead-end: any failed re-read replaces the whole day with an error (B7).

### J6 — Manager checks load and spend, acts on an alert
Sidebar Insights (badge = token alerts) → lands on **Capacity** (B8) → switch to "Usage & cost" → alert → open task (`/board?project=…&task=…`, token-alerts.ts) → drawer.
Friction: one extra tab click; Capacity errors stick (B6).

### J7 — Set up a new space and its people
First space: `/setup` → first project. Later spaces: sidebar "More spaces" → `/projects` → Create → Space settings › General → Members → Access (handoff policy).

Dead-ends:
- With zero spaces there is no nav route to `/projects` (B21).
- Project cards also offer `/members` (B13), which duplicates Settings › Members.
- The General draft is lost on tab switch (B11), and nothing says "Saved".

### J8 — Turn untracked or meeting work into tasks
- **Unlisted:** `/inbox?tab=unlisted` (admins) → Promote (free-text space, B15) → open task (`/board?q=KEY`, B18 — may open the wrong space).
- **Meeting review:** `/meeting-review?project=s` → apply proposals → open task (`/board?q=KEY` with no project, B2).

Both end on a key search rather than the task's drawer in its own space. `/work` already does this correctly (ScreenOutlet.tsx:131-139).

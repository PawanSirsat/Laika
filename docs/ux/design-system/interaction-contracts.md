# Interaction contracts

**Phase B deliverable (proposal).** §1–§2 define the 17-state contract every
component family must meet. §3 lists the explicit interactions per domain and
marks which the API supports **today** at `9ac3be1f`. The measured starting
point is [`../audit/interaction-inventory.md`](../audit/interaction-inventory.md).

## 1. The 17 states

| # | State | Contract (applies to every family where meaningful) |
| --- | --- | --- |
| 1 | **Initial** | renders from the URL alone; a reload restores it (URL-as-state) |
| 2 | **Loading** | `LoadingState` skeleton in the final layout shape, delayed via `use-delayed` so it doesn't flash; `aria-busy` on the region; never blocks unrelated regions |
| 3 | **Empty** | `EmptyState` with one sentence saying *why* and, where the person may act, one primary action; **never styled as an error** (V12) |
| 4 | **Success** | confirmed only by a 2xx response: inline status or toast; reversible actions offer Undo; no optimistic "Done" |
| 5 | **Error** | `ErrorState` / `ApiErrorState` with Retry and the server's `code` and message; **keeps the last good data** and its age; **never shown as empty** (B5–B7); one region's failure never replaces the page |
| 6 | **Disabled** | only when the person *could* act but cannot right now; visible reason (text or Tooltip); `aria-disabled` keeps focus. If the person may never act, the control is **absent** (permission model) |
| 7 | **Hover** | tokenised hover (on glass: `--glass-hover` overlay); never the only cue for an action |
| 8 | **Focus** | `--focus-ring`, visible on any surface incl. glass; logical order; focus never lost on re-render |
| 9 | **Active** | pressed / current state distinct from hover; `aria-pressed` / `aria-current` as appropriate |
| 10 | **Selected** | `aria-selected` only where the role allows it (listbox, grid, tablist — B20); selection survives re-sort; accent + text, not colour alone |
| 11 | **Expanded** | `aria-expanded` + `aria-controls` on the trigger; content reachable in order |
| 12 | **Collapsed** | collapsed content leaves the tab order (`inert` or unmounted); a count or summary stays visible |
| 13 | **Confirmation** | irreversible → `ConfirmDialog` (focus-managed); reversible-but-annoying → `InlineConfirm` (focus to Cancel) or Undo toast; never a one-click irreversible action (B4, B9) |
| 14 | **Responsive** | defined at 390 / 768 / 1024 / 1280 / 1366 / 1440 / 1600; no document-level horizontal scroll; containers that scroll on x show an affordance |
| 15 | **Permission-denied** | control absent; a directly addressed screen shows `PermissionDenied`; a 403 section is absent, not an error |
| 16 | **Keyboard** | every action reachable; patterns per WAI-ARIA APG; Escape closes only the topmost layer (dismiss stack) |
| 17 | **Screen reader** | name, role, value on every control; state changes announced through one `LiveRegion` (polite for info, assertive for errors); new content never steals focus |

## 2. Contract per component family

**Required** = must be designed and tested; **–** = not applicable.

| Family | Required beyond 1, 7, 8, 16, 17 (always required) | Family-specific rule |
| --- | --- | --- |
| Navigation (Sidebar, Header, Breadcrumbs, Tabs, ViewTabs) | 9, 11, 12, 14, 15 | route tabs are `nav` + `aria-current`; local tabs are roving tablists; badges carry text |
| Space top bar / toolbars | 2, 5, 6, 10, 11, 14, 15 | one layout on every tab (V3); collapses to "Filters (n)" below 600 |
| Task card | 4, 5, 6, 9, 10, 14, 15 | card is a link; keyboard move with announced result; touch path required before drag ships on phones |
| List / table | 2, 3, 4, 5, 6, 10, 14, 15 | valid selection model; row opens by keyboard; x-scroll affordance |
| Bulk bar | 2, 4, 5, 6, 13, 14 | progress `role="status"`; Undo for bulk changes where the API allows the reverse |
| Drawer / Workroom panels | 2, 3, 5, 11, 12, 13, 14, 15 | dialog semantics in drawer form; page semantics in route form; Escape never navigates |
| Document / MarkdownView / CodeView | 2, 3, 5, 11, 12, 14 | solid surface; heading outline; copy returns original bytes |
| Evidence / Timeline | 2, 3, 5, 11, 12, 14 | provenance on every row (Fact / Derived / Agent-reported / AI) |
| Forms and inline edit | 2, 4, 5, 6, 13, 14, 15 | drafts survive tab switch (B11); "Saved" feedback; Enter submits single-field forms (B15) |
| Menus and popovers | 6, 9, 10, 11, 12, 14 | Escape closes only the menu and returns focus (B3); sheet under coarse pointer |
| Dialogs | 2, 4, 5, 6, 13, 14 | trap, label, restore focus; scroll lock by class, never injected style |
| Toasts | 4, 5, 13 | never moves focus; errors persist; Undo is a real button |
| Approval controls | 2, 4, 5, 6, 13, 14, 15 | Accept → Undo toast; Send back → required reason; disabled reason visible |
| Wizards | 2, 4, 5, 6, 9, 14, 15 | step state announced; secrets shown once with explicit forget |
| Charts / KPI tiles | 2, 3, 5, 14 | text equivalent for every figure; figures only from the server |

## 3. Explicit interactions and API support today

**API today**: ✅ supported by an existing endpoint · ◐ partial / client-derived
· ❌ needs backend (CORE). Evidence from the route inventory and the
specification sources at `9ac3be1f`.

### 3.1 Navigation

| Interaction | Contract | API today |
| --- | --- | --- |
| Open a route from sidebar / palette | permission-filtered by `nav-permissions` | ✅ `GET /permissions` |
| Switch space keeping view and cross-space filters | replace; drop space-bound params | ✅ |
| Open task by key from anywhere | `useOpenTask` → `?project&task` or `/task/:key` | ◐ verify `GET /tasks/:id` accepts a key; else client lookup |
| Back closes the task before leaving the view | push on open, replace on close | ✅ (client) |
| Global search beyond loaded results | — | ❌ FTS5 search |
| Breadcrumbs with real links | `<a href>` | ✅ (client) |
| Live updates across spaces | one org stream | ✅ `GET /events` without `?project=` |

### 3.2 Tasks

| Interaction | Contract | API today |
| --- | --- | --- |
| Create in place from any space view | form opens over the current view (B19) | ✅ `POST /projects/:slug/tasks` |
| Move status (drag, Alt+Arrow, picker) | announced; failure on the card | ✅ `PATCH /tasks/:id/status`, `/reorder` |
| Detach from parent | `InlineConfirm`; error shown (B4) | ✅ `PATCH /tasks/:id` |
| Bulk status / assign / sprint | progress + report; Undo where reversible | ✅ (per-task calls) |
| Filter by blocked / overdue / due range | count links to the same set | ❌ `blocked`, `overdue`, `due_before/after` on `GET /tasks` |
| Watch / unwatch | toggle with status | ✅ `GET /me/watching` (+ watch endpoints) |

### 3.3 Documents

| Interaction | Contract | API today |
| --- | --- | --- |
| Read description / acceptance as documents (TOC, copy, print) | solid, 72ch, outline | ✅ `GET /tasks/:id` |
| Edit description / acceptance | TipTap, stale-guard | ✅ `PATCH /tasks/:id` |
| Read a deliverable document with versions | reader + version picker | ❌ deliverables tables + REST (Phase D) |
| Compare versions | source diff | ◐ rounds (`summary_md`) ✅; task field revisions ❌; deliverable versions ❌ |
| Anchored comments | quote anchor, re-anchor | ❌ (trial: in-browser only) |
| Export | MD original; PDF via print | ◐ client-only today; server exports ❌ |

### 3.4 Agent execution

| Interaction | Contract | API today |
| --- | --- | --- |
| Request an agent | select; "Waiting for agent" | ✅ `PATCH /tasks/:id` `selected_agent_id` |
| See live claim and connection | server state words only | ✅ `TaskView.claim`, heartbeat age |
| See execution timeline | merged sources with badges | ◐ activity + checkpoints + rounds + offers ✅; full claims history ❌ (`GET /tasks/:id/claims`, S) |
| See decisions / open questions | verbatim, labelled agent-reported | ◐ free text in checkpoint summaries ✅; structured entity ❌ |
| Approve / cancel / name receiver for a hand-off | per server `next_action` | ✅ `POST /handoff-offers/:id/approve|cancel` |
| Ping capacity | busy + result | ✅ `POST /agents/:id/capacity-pings` |
| Stop / pause / resume / retry an agent | — | ❌ none for a person |
| Org-wide fleet | — | ❌ `GET /agents` is own agents only |

### 3.5 Review

| Interaction | Contract | API today |
| --- | --- | --- |
| Accept | Undo toast; `can_decide` gated | ✅ `POST /tasks/:id/accept` (undo window client-side before the call, or a reverse transition — implementing task decides and documents) |
| Send back with reason | dialog, required reason | ✅ `POST /tasks/:id/send-back` |
| Inspect evidence with truth labels | claimed / confirmed / failed, source, time | ✅ `GET /tasks/:id/rounds` |
| Compare rounds | evidence and summary diff | ✅ (client) |
| Advisory checklist | computed, linked to sources | ◐ computed client-side; persisted checklist ❌ |
| Reject / reopen | — | ❌ / ◐ (reopen depends on the §5 transition table) |
| AI summary | per AI policy | ❌ |

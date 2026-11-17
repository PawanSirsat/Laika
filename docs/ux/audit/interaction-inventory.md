# Interaction inventory

**Phase A deliverable (evidence).** Basis `9ac3be1f`. Every component family
judged against the 17 interaction states, with the evidence for each non-good
cell, followed by the terminology audit. The *contract* every family must meet
going forward is in
[`../design-system/interaction-contracts.md`](../design-system/interaction-contracts.md);
this file is the measured starting point.

B-numbers refer to [`ux-audit.md`](ux-audit.md) §3.
## Legend
**G** = Good, **P** = Partial, **M** = Missing, **B** = Broken, **–** = n.a.

Columns: **Ini** initial · **Load** loading · **Emp** empty · **Suc** success · **Err** error · **Dis** disabled · **Hov** hover · **Foc** focus · **Act** active · **Sel** selected · **Exp** expanded · **Col** collapsed · **Conf** confirmation · **Resp** responsive · **Perm** permission-denied · **Kbd** keyboard · **SR** screen reader.

Hover and focus are judged from the component's own CSS rule counts (`:hover`, `:focus-visible`) plus shared `.button` styles (forms.css: 4 focus-visible / 2 hover). P means the component relies on shared or global styles only, and I haven't verified it visually.

## 1. State matrix by component family

| Component (entry) | Ini | Load | Emp | Suc | Err | Dis | Hov | Foc | Act | Sel | Exp | Col | Conf | Resp | Perm | Kbd | SR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sidebar (components/sidebar/Sidebar.tsx) | G | – | P | – | – | – | G | G | G | – | G | G | – | G | G | P | P |
| Spaces section + popover (SpacesSection.tsx, SpacesPopover.tsx) | G | – | B | – | – | – | G | G | G | – | G | – | – | P | – | P | P |
| User menu (SidebarFooter.tsx) | G | – | – | – | M | G | G | G | – | – | G | – | – | G | – | G | G |
| Shell header / off-canvas (ShellHeader.tsx) | G | – | – | – | – | – | – | P | – | – | G | – | – | G | – | P | G |
| Space top bar (SpaceTopBar.tsx) | G | P | – | – | M | – | G | G | G | G | – | – | – | P | G | G | P |
| View tabs (ViewTabs.tsx) | G | – | – | – | – | – | G | G | G | – | – | – | – | G | G | G | G |
| Filters & chips (BoardToolbar.tsx, FilterChips.tsx) | G | – | G | – | G | – | G | G | – | G | P | – | – | P | – | P | P |
| Board card (TaskCard.tsx) | G | – | – | G | P | G | G | G | – | – | – | – | – | B | G | G | G |
| Lane (LaneRow.tsx, KanbanView.tsx) | G | – | G | G | G | – | G | G | – | – | G | G | P | P | G | P | G |
| List row/table (ListView.tsx) | G | P | G | – | P | G | G | G | – | B | G | – | – | M | G | P | B |
| Bulk bar (BulkBar.tsx) | G | G | – | G | G | G | P | P | – | G | G | – | P | M | G | P | G |
| Task drawer frame (TaskDrawer.tsx) | G | B | – | – | – | – | – | M | – | – | – | – | – | G | – | P | P |
| Task panel header & overflow (TaskDetailPanel.tsx:641-799) | G | G | – | G | M | – | G | G | – | – | P | – | B | G | G | B | P |
| Drawer · StateHero (task/StateHero.tsx) | G | – | – | G | – | – | – | – | – | – | – | – | – | G | G | – | P |
| Drawer · description/acceptance (DocumentField.tsx, InlineEdit.tsx) | G | P | G | G | G | G | G | G | – | – | – | – | P | P | G | G | P |
| Drawer · Execution panel (agent/ExecutionPanel.tsx) | G | P | P | – | P | – | – | – | – | – | P | – | – | P | G | P | P |
| Drawer · Hand-off section + dialog (HandoffSection.tsx, HandoffOfferDialog.tsx) | G | – | – | G | G | G | P | P | – | – | – | – | G | P | G | G | G |
| Drawer · Evidence (task/EvidenceSection.tsx) | G | P | P | – | P | – | – | – | – | – | – | – | – | P | – | – | P |
| Drawer · Subtasks / Dependencies (SubtasksSection.tsx, DependenciesSection.tsx) | G | P | G | G | P | G | P | P | – | – | – | – | M | P | G | P | P |
| Drawer · Activity feed (task/ActivityFeed.tsx, FeedComment.tsx) | G | P | G | G | P | – | G | G | – | – | – | – | P | P | G | P | P |
| Comment composer (CommentComposer.tsx + RichEditor.tsx) | G | G | – | P | P | G | G | G | – | – | G | G | G | P | M | G | G |
| Rich editor (editor/RichEditor.tsx, LazyRichEditor.tsx) | G | G | – | G | G | G | G | P | G | – | – | – | G | P | – | G | G |
| Dropdown (components/Dropdown.tsx) | G | – | P | – | – | G | G | G | G | G | G | G | – | G | – | G | G |
| ConfirmDialog (components/ConfirmDialog.tsx) | G | G | – | – | G | G | P | P | – | – | – | – | G | G | – | G | G |
| Inline confirms (DangerTab, MembersTab, AccessTab, SprintsScreen, BulkBar) | G | P | – | P | P | G | P | P | – | – | – | – | P | P | G | B | P |
| SidePanel (components/SidePanel.tsx) | G | – | – | – | – | – | G | G | – | – | – | – | – | G | – | G | G |
| Overflow menu (components/wizard/OverflowMenu.tsx) | G | – | – | – | – | G | G | G | – | – | G | – | – | – | – | G | G |
| Hand-rolled menus (BoardScreen.tsx:1199, ListMenu.tsx, panel overflow) | G | – | – | – | – | P | P | P | – | – | P | – | – | – | – | P | P |
| Popovers (SpacesPopover, ViewSettings, BoardInsights, CardFilter, HeaderPopover, BoardToolbar) | G | – | P | – | – | – | P | P | – | – | G | – | – | P | G | P | P |
| Page tabs (components/PageTabs.tsx) | G | – | – | – | – | – | G | G | G | – | – | – | – | P | G | G | G |
| Role-tabs (HandoffsTab.tsx:303-325; DayTabs.tsx) | G | – | – | – | – | – | P | P | G | G | – | – | – | P | – | P | P |
| Toasts (my-day/Toast.tsx; MembersTab toast) | G | – | – | G | G | G | G | P | – | – | – | – | – | G | – | P | P |
| Wizards (connect/ConnectScreen.tsx; v3 AddToolWizard/AddDeviceWizard; wizard/StepRail.tsx) | G | G | – | G | G | G | P | G | G | G | – | – | P | G | P | P | P |
| Timer (my-day/TimerControl.tsx) | G | P | – | G | P | G | P | P | G | – | – | – | – | G | G | G | G |
| Review accept / send back (ReviewScreen.tsx; SendBackDialog.tsx) | G | G | G | P | G | G | P | P | – | – | G | G | B | P | G | P | G |
| Hand-offs approve / withdraw (HandoffsTab.tsx:576-625) | G | G | G | G | G | G | P | P | – | G | – | – | M | P | G | G | G |
| Agent picker (agent/AgentPicker.tsx) | G | – | P | – | – | G | G | G | – | G | G | – | – | G | G | G | G |
| Token reveal (TokensScreen.tsx:190-211; AgentsTab.tsx:546-576; CopyButton.tsx) | G | – | – | G | G | G | P | P | – | – | – | – | P | P | – | P | P |
| Ping button (agent/PingButton.tsx) | G | G | – | G | G | G | P | P | – | – | – | – | – | P | G | G | G |
| Dialog family (27 role=dialog/alertdialog) | G | – | – | – | – | – | – | P | – | – | – | – | P | P | – | P | P |
| State components (LoadingState, EmptyState, ErrorState, ApiErrorState, PermissionDenied) | G | G | G | – | G | – | – | – | – | – | – | – | – | – | G | – | G |
| Connection / permissions banners (ConnectionBanner.tsx; ScreenOutlet.tsx:577-595) | G | – | – | – | G | – | – | – | – | – | – | – | – | – | G | G | G |

## 2. Evidence per row (non-G cells explained)

- **Sidebar**
  - Collapse toggle has `aria-expanded`/`aria-controls` (Sidebar.tsx:193-201); links have `aria-current` (:134).
  - Kbd P: no skip-link or landmark shortcut (not found).
  - SR P: "waiting" is appended to every badge, including the Insights token-alert count (Sidebar.tsx:160; ShellSidebar.tsx:76).
  - Emp P: with zero spaces the SPACES section disappears (:208).
- **Spaces section**: Emp **B** — nothing is offered when there are no spaces (Sidebar.tsx:208; B21). The popover is `role="dialog"` with an Escape handler (SpacesPopover.tsx:67-71) but no `useDialogFocus` or `aria-modal`.
- **User menu**: full menu pattern — `role="menu"`, arrow keys, Escape returns focus (SidebarFooter.tsx:85-187). Err M: a sign-out failure isn't shown (only `disabled={signingOut}` :165).
- **Space top bar**:
  - Load P: member faces are empty until the request returns.
  - Err M: members, tags and meeting-review failures are swallowed (SpaceLayout.tsx:127-158).
  - Resp P: space.css has a single max-width query.
  - Sel G: faces are `aria-pressed` (SpaceTopBar.tsx:202).
  - SR P: face titles only via `title=` (:203).
- **Board card**:
  - Kbd G: Alt+Arrow move with `aria-keyshortcuts` (TaskCard.tsx:261-271).
  - Resp **B**: HTML5 `draggable` + `onDragStart` (:148-155) — no touch path (B17, inferred).
  - Err P: a move failure is reported at the board level (BoardScreen.tsx:1452), not on the card.
- **Lane**:
  - Lane drag reorder (LaneRow.tsx:421-431) has no keyboard alternative found → Kbd P.
  - Rename: Escape (:481-483); error `role="alert"` (:580).
  - Move result announced by `aria-live` (:774).
  - Conf P: delete goes through DeleteColumnDialog (focus-managed, G); hide has no confirm.
- **List**:
  - Sel/SR **B**: `aria-selected` on `<tr>` in a plain `<table>` (ListView.tsx:309, 400) — B20.
  - Kbd P: row `onClick` (:401) has no keyboard handler; opening relies on another link inside the row (not verified).
  - Resp **M**: list.css has 0 max-width queries.
  - Load P: inherited from the board; only per-row spinner (:487).
- **Bulk bar**:
  - `role="region"` (BulkBar.tsx:174); progress and report `role="status"` (:306, :312).
  - Conf P: two-step inline confirm for cancel only (:246); no undo.
  - Kbd P: the confirm group takes no focus.
  - Resp M: list.css has no queries.
- **Task drawer frame**:
  - Load **B**: outside Board the slot stays empty (TaskDrawer.tsx:123, 144-153; SpaceLayout.tsx:261) — B1.
  - Foc M: the panel is focused (:68) but nothing traps it (B22).
  - Kbd P: global Escape closes unless `defaultPrevented` (:87-94).
  - Resp G: phone sheet with handle and swipe (:100-120).
  - SR P: the frame itself has no role; the inner panel has `role="dialog"` (TaskDetailPanel.tsx:641).
- **Panel header & overflow**:
  - Overflow `<ul>` without `role="menu"`, no Escape handler, so Escape closes the drawer (TaskDetailPanel.tsx:763-799) → Kbd **B** (B3).
  - Exp P: `aria-expanded` on the trigger (:753).
  - Conf **B**: "Detach from parent" fires immediately (:786-795, B4).
  - Err M: `void updateTask(...).then(...)` has no catch (:792).
  - Copy feedback is `role="status"` (:746).
- **StateHero**: derived display (hero-derive.ts); hero.css has 2 queries. SR P: status conveyed largely by visual chips (not verified).
- **DocumentField / InlineEdit**:
  - Stale alert (TaskDetailPanel.tsx:972); save error (:1008).
  - Conf P: rich editor asks before discarding on Escape (RichEditor.tsx:35-37); InlineEdit discard not verified.
- **ExecutionPanel**: harness and version shown in a `<dl>` (ExecutionPanel.tsx:444, :472). Missing: checkpoint timeline (backend-readiness audit). Load/Err P (not verified in detail).
- **Hand-off section/dialog**:
  - The dialog uses `useDialogFocus` + `aria-modal` + capture-phase Escape so the drawer stays open (HandoffOfferDialog.tsx:94-132).
  - Disabled Approve shows its reason (:227-231, :249).
  - Recovery status `role="status"` (HandoffSection.tsx:103-108).
- **Evidence**: shown only once rounds exist (backend-readiness audit) → Emp P. evidence.css has 1 query.
- **Subtasks/Dependencies**: Conf M — removing a dependency or detaching a subtask has no confirm (same pattern as B4; not exhaustively verified).
- **Comment composer**:
  - Collapsed "Add a comment…" button → editor (CommentComposer.tsx:27-44); placeholder advertises ⌘↵ (:66).
  - Suc P: `onSubmit` awaits `onPost` and closes (:73-76); no posted confirmation beyond the feed update.
  - Err P: depends on RichEditor's catch (RichEditor.tsx:348, :398).
  - Perm M: the composer has no permission prop (:6-11); gating happens in the caller (not verified).
- **Rich editor**:
  - `role="toolbar"` (RichEditor.tsx:600); Escape owned by the editor (:589-595); ⌘↵ submit (:452).
  - The lazy-load fallback is `role="status"`; failure is `role="alert"` (LazyRichEditor.tsx:96, :117).
  - Mention list keyboard: Enter/Tab/Escape (:437-448).
- **Dropdown**:
  - Full APG select-only combobox: listbox, `aria-activedescendant`, Home/End, Escape stops propagation (Dropdown.tsx:148-172, 497-555).
  - Coarse-pointer detection (:127).
  - Emp P: no "no options" copy found (not verified).
  - Z-index 60 vs 61 (B16).
- **ConfirmDialog**: `role="alertdialog"`, `useDialogFocus`, `aria-describedby`, Escape blocked while busy, error `role="alert"` (ConfirmDialog.tsx:82-159). Hov/Foc P: confirm-dialog.css has 0 focus-visible rules.
- **Inline confirms**:
  - `role="alertdialog"` without focus move in DangerTab.tsx:78, MembersTab.tsx:317, AccessTab.tsx:132, SprintsScreen.tsx:195 → Kbd **B** (B12).
  - BulkBar `role="group"` confirm (:246).
- **SidePanel**: `useDialogFocus`, Escape respects `defaultPrevented` (SidePanel.tsx:44-66).
- **OverflowMenu (shared)**: `role="menu"`, `menuitem`, arrows, Escape to button, `aria-disabled` items (OverflowMenu.tsx:27-157). It is not used by the task panel or the BoardScreen menu.
- **Hand-rolled menus**:
  - BoardScreen.tsx:1199 `role="menu"`.
  - ListMenu.tsx:84-122 has its own arrow handling.
  - Panel overflow (above).
  - That's three implementations beside the shared one.
- **Popovers**:
  - `role="dialog"` with no focus hook or `aria-modal`: BoardToolbar.tsx:633, :891; ViewSettings.tsx:129; BoardInsights.tsx:73; CardFilter.tsx:105; SpacesPopover.tsx:67; WhoDidThis.tsx:159; MyDayDrawer.tsx:77.
  - 8 hand-rolled positioners (`ux-audit.md` §4).
- **PageTabs**: links with `aria-current` inside a `<nav>` (PageTabs.tsx:40-51) — valid navigation, not a tablist; consistent with ProfileScreen.tsx:452-458. page-tabs.css has 0 media queries; the tabs presumably scroll horizontally (not verified).
- **Role-tabs**:
  - HandoffsTab: proper roving tablist (`tabIndex`, `aria-controls`, arrow keys :246-325) → G for those cells.
  - DayTabs: `role="tab"` with no arrow handling and mixed `aria-current` + `aria-selected` (DayTabs.tsx:26-37, B26). Hence P overall.
- **Toasts**:
  - The live role is assigned to an element that mounts together with its text (Toast.tsx:34-38), so some screen readers won't announce it → SR P.
  - No auto-dismiss or pause on focus found.
  - Two private copies (`ux-audit.md` §4); no shared Toast.
  - Undo disabled while busy (:57).
- **Wizards**:
  - StepRail (wizard/StepRail.tsx); live-region helper (wizard/LiveRegion.tsx, live-region.ts).
  - connect.css: 16 focus-visible / 3 queries; add-wizards.css: 0 focus-visible → Hov P.
  - Perm P: v3 Reconnect/Disconnect look enabled and, in those states, do nothing (B10: `aria-disabled` with no visible reason, click returns early; ToolDetails.tsx:563-570, DeviceDetails.tsx:159-169).
- **Timer**:
  - `role="timer"` (TimerControl.tsx:105); buttons disabled while busy (:121-169).
  - Description input with `maxLength` 120 and Enter handling (:227-235).
  - Load/Err P: busy only; error surfaced via the My Day toast (not verified).
- **Review accept/send back**:
  - Conf **B**: Accept is immediate, with no undo (ReviewScreen.tsx:484-495, B9).
  - Send back uses a focus-managed dialog with `restoreFocus` (:528-540; SendBackDialog.tsx:71).
  - Kbd P: "Open on board" swallows cmd-click (:508-513).
  - Disabled reason in copy (:517-521).
- **Hand-offs approve/withdraw**: `aria-disabled` + `aria-busy` keep focus during the write (HandoffsTab.tsx:578-609); per-row error and status regions (:616-625). Conf **M**: Withdraw has no confirm.
- **Agent picker**: unavailable agents listed and disabled with a reason, labelled and described (AgentPicker.tsx:82-135).
- **Token reveal**:
  - "Shown once" copy and `role="alert"` section (TokensScreen.tsx:190-211; AgentsTab.tsx:565-576).
  - CopyButton is modal-aware (CopyButton.tsx:46) with a timed "Copied" state (:174-181).
  - Conf P: AgentsTab's two-step forget (`useOnceSecret` :507) isn't reused by TokensScreen.
  - token-row.css and tokens.css: focus-visible 0–1.
- **Ping button**: `aria-disabled` while busy and `aria-live` result (PingButton.tsx:262-281).
- **Dialog family**:
  - 27 dialogs; 15 skip `useDialogFocus` (`ux-audit.md` §4).
  - Confirmed in this pass without the hook: CopyButton.tsx:46 (has aria-modal), NewColumnDialog.tsx:63 (aria-modal, no hook), TaskDetailPanel.tsx:641 (aria-modal, no hook), MyDayDrawer.tsx:77, plus the popovers above.
- **Banners**: `role="status"` (ConnectionBanner.tsx:58); permissions banner with Retry (ScreenOutlet.tsx:582-591).

### Cross-cutting gaps
- No shared Tooltip: 384 `title=` (`ux-audit.md` §4).
- No `usePolled`; seven intervals listed at api/use-review-count.ts:56, use-unlisted-count.ts:45, token-alerts.ts:105, use-handoff-counts.ts:42, use-task-handoffs.ts:82, CapacityScreen.tsx:217, ReviewScreen.tsx:92, etc.
- Screens with **no** max-width CSS: calendar, sprints, list, capacity, usage, profile (CSS census).

## 3. Terminology

| Concept | Variants in UI copy (file:line) | Recommended canonical |
|---|---|---|
| Container of tasks | **Space**: "Space settings" route-table.ts:329; "No spaces yet" ProjectsScreen.tsx:407; "No space chosen" CalendarScreen.tsx:76, ActivityScreen.tsx:86; "A space admin can plan…" SprintsScreen.tsx:248; "No space to show" UsageScreen.tsx:245. **Project**: route label "Projects" route-table.ts:172; "No projects yet" BoardScreen.tsx:962, SprintsScreen.tsx:118; "Pick a project" MeetingReviewScreen.tsx:145; "No project chosen" MembersScreen.tsx:75; "Add someone to this project" AddMemberForm.tsx:126; "No tasks in this project yet" ListView.tsx:291; "Create your first project" FirstBootScreen.tsx:134, :237; "across every project" ReviewScreen.tsx:233 | **Space** in all UI copy. Keep `project` only in URLs/API. Rename the `/projects` label to "Spaces" |
| Space role | "space admin" SprintsScreen.tsx:248, ViewSettings.tsx:220, ProfileScreen.tsx:131; "project admin" HandoffPolicyForm.tsx:119; "project lead" HandoffOfferDialog.tsx:191; "A lead can add you" ProjectSetupTab.tsx:307 | **Space admin** (one term; map the `lead` role to it in copy) |
| Org settings | Page "Organisation" route-table.ts:273; section heading "Workspace settings" OrganisationScreen.tsx:412 | **Organisation** |
| The thing that acts | "agent" (AgentsTab, AgentPicker, Capacity); "tool" / "coding tool" DeveloperScreen.tsx:30, ToolsTab.tsx:126, AddToolWizard.tsx:83; "Tool credential" TokenRow.tsx:44, OrganisationScreen.tsx:769, AdminPanel.tsx:575; "harness" RegistrationStep.tsx:105, ExecutionPanel.tsx:444/472, AgentsTab.tsx:909/946/1122 | **Agent** = the identity on the board. **Coding tool** = the software (Claude Code, etc.) shown as an attribute, replacing "harness". **Device** stays |
| Credential | "Tokens" tab page-tabs.ts:83; "Tool credential" TokenRow.tsx:44; "Security" tab = everyone's tokens page-tabs.ts:67; v3 moves tokens to "Advanced" page-tabs.ts:192-195 | **Access token**, and a consistent home ("Tokens") in every mode |
| LLM usage | "Tokens" section in the task drawer = usage tokens (TokensSection.tsx:157-175) — collides with credentials | **Usage** (or "Token usage") |
| Queues | Nav "Inbox"; tab "Review"; "the review queue" ReviewScreen.tsx:208/217/234; board status also called "review" | **Inbox** (place) › **Review** (tab). Avoid "queue" in headings |
| Hand-off | "Hand-off(s)" page-tabs.ts:44, HandoffPolicyForm.tsx:115; button "Withdraw" HandoffsTab.tsx:607; "Withdraw offer" HandoffOfferDialog.tsx:243; endpoint `/cancel`, permission `task.handoff.cancel` TaskDetailPanel.tsx:607; "Review hand-off" / "Review recovery offer" HandoffSection.tsx:133-136 | **Hand-off**; action **Withdraw** in the UI (document the mapping to cancel); avoid "Review" in hand-off buttons (clashes with Review) |
| Deciding review | "Accept" ReviewScreen.tsx:495; "Send back…" :506; hand-offs use "Approve" | Keep **Accept / Send back** for review and **Approve** for hand-offs, but never mix them in one surface |
| Repo setup | Classic tab "Projects" page-tabs.ts:81 vs v3 "Project setup" :96 (same id); link label "Developer access · Projects" :262 | **Project setup** in all modes |
| Untracked work | "Unlisted work" page-tabs.ts:45, UnlistedScreen.tsx:96, CapacityScreen.tsx:350 | **Unlisted work** (consistent — keep) |
| Person page | Route "Member profile" route-table.ts:307; menu "My profile" SidebarFooter.tsx:134; "Open X's profile" PeopleTab.tsx:631 | **Profile** |
| Auth | "Sign in" LoginScreen.tsx:93, SetupRoute.tsx:53 | **Sign in** (consistent — keep) |
| Activity | Space tab "Activity" (live stream); Org tab "Activity" (audit history); Developer tab "Activity" (local activity sharing); profile ActivityCard | Space: **Activity**; Org: **Audit log**; Developer: **Activity sharing** |

**Out of scope, noted:** the stale comments B23 and B25, the meeting-review full fetch done only to draw a badge (B24), and the auth screens' missing `autoFocus` — all are code findings rather than copy.

Visual-audit additions: V10 confirms the container-of-tasks row on screen
(route `/projects`, heading "Spaces", "Workspace settings", "Projects this
credential reaches", "Key" for the prefix, `lead` vs "Space admin"); V7 adds
the agent-attribution wording ("*‹person›* via *agent*") that the Identity
component replaces with "*agent* · *device* (for *person*)".

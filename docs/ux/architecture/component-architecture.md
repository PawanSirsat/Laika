# Component architecture

**Phase B deliverable.** §1 assesses the current front-end architecture
(evidence). §2 specifies the component set (proposal): **one implementation
per interaction**, each replacing the copies that exist today. §3 lists the
oversized files and where to split them. Basis `9ac3be1f`; all paths under
`server/web/src/` unless stated.

## 1. Current architecture assessment (evidence)

| Area | What is there | Assessment | Keep / change |
| --- | --- | --- | --- |
| Routing | `routes/use-route.ts`, `routes/route-table.ts`; only parameterised route is `/spaces/:slug/settings` (:328) | simple, URL-driven, permission-filtered | **Keep.** Add `/home`, `/task/:key`, `/review-studio`, Insights › Agents |
| Data | `api/client.ts`, `query-cache.ts`, stores | deliberate, deduped, invalidated by SSE | **Keep.** Add `usePolled` + `useResource` (`{data, error, retry}`) to retire 7+ hand-rolled loaders |
| Live | `api/event-stream.ts` — one `EventSource` per project (:126) | correct per space; blind org-wide | **Change** to one org-wide connection with fan-out (`experience-architecture.md` §7) |
| Permissions | `routes/nav-permissions.ts` over `GET /permissions` | correct model ("absent, not disabled") | **Keep.** Fix stale comments (B23) |
| Styling | colour in `styles/theme.css` only (`theme-single-source.test.ts`); type generated (`theme/type-roles.ts` → `styles/type.css`) | colour and type excellent; radius, motion, z-index, breakpoints unguarded | **Add tokens + guards** (`design-system/visual-language.md` §4) |
| Components | good `Dropdown`, `ConfirmDialog`, `SidePanel`, `OverflowMenu`, `Switch`, state components, `LiveRegion` | many gaps; 2–8 copies per interaction | **One implementation per interaction** (§2) |
| Screen size | 12+ files over 800 lines | hard to review, hard to reuse | **Split** along the seams in §3 as each area is touched — never as a standalone rewrite |
| Bundle | one main chunk (1,880,428 B / 533,280 B gzip, local build); three `lazy()` imports | every screen pays for every other | route-level `lazy()` first, before any new dependency |
| CSP | `server/src/http/security-headers.ts:67-90`: `script-src 'self'`; `style-src-elem 'self'` + build hashes; `style-src-attr 'unsafe-inline'`; `img-src 'self' data:`; `connect-src 'self'` | runtime `<style>` and wasm are blocked; inline style attributes are fine | every new library passes a **browser** CSP test (`library-evaluation.md` §1) |

## 2. Component specification (proposal)

Rules for every component:

- both themes from tokens only; focus via `--focus-ring`; motion via
  `--duration-*`; stacking via `--layer-*`;
- **exactly one implementation per interaction**; old copies are deleted in
  the same PR, with a single-source guard test in the style of
  `initials-single-source.test.ts`;
- every component meets the 17-state contract for its family
  (`design-system/interaction-contracts.md`);
- glass is applied only through the glass primitives
  (`design-system/visual-language.md` §3), never per component.

| Component | Existing (to replace or keep) | Proposed | Surface |
| --- | --- | --- | --- |
| **App shell** | `AppShell.tsx` (queries at :20/:30), `shell/ShellProvider.tsx`, `shell/ScreenOutlet.tsx` (602), `SessionGate.tsx`, `ConnectionBanner.tsx` | landmarks `header/nav/main/aside`; skip link; `inert` on content while off-canvas nav is open; breakpoints from `theme/breakpoints.ts`; lazy screen boundaries in `ScreenOutlet` | canvas solid; ambient gradient optional |
| **Sidebar** | `sidebar/Sidebar.tsx`, `SpacesSection`, `SpacesPopover`, `SidebarFooter`, plus duplicate `shell/ShellSidebar.tsx` (B8) | merge badge logic into `Sidebar`; expanded / rail / off-canvas; rail labels via `Tooltip`; correct badge wording | **glass 1** |
| **Header** | `shell/ShellHeader.tsx:27`, `space/SpaceTopBar.tsx` (457) | one header: `[nav toggle] [breadcrumbs] [spacer] [⌘K] [notifications] [theme] [account]`; space filters move to one row below the view tabs (V3, V4) | **glass 1** (sticky) |
| **Breadcrumbs** | parent crumb in `TaskDetailPanel.tsx:143, 305-320` | `components/Breadcrumbs.tsx`: `nav aria-label="Breadcrumb"` → `ol`; last `aria-current="page"`; middle crumbs collapse into a Menu; real `<a>` | inherits header |
| **Command palette** | none | `components/command/CommandPalette.tsx`: cmdk `<Command>` inline in the `Dialog` base, never `Command.Dialog` | **glass 2** shell, solid list |
| **Screen header** | `ScreenHeader.tsx:73`, `EmbeddedScreen` :57, `PageTabs.tsx`; `screen-header.test.ts` | variants page / embedded / compact; at most one primary Button; secondary actions in Menu; below 600 actions move into overflow | solid |
| **Split pane** | none; drawer fixed width | `components/workspace/SplitPane.tsx`, in-house: `role="separator"` with value / min / max / controls; Arrow ±16 px, Shift ±64 px, Home / End; pointer events (touch works); sizes in `localStorage` (try/catch); stacks below 1280 | panels **glass 1**, centre solid |
| **Task card** | `board/TaskCard.tsx` (HTML5 drag :148-155), `LaneRow.tsx`, `board-motion.ts` | variants board / list-row / compact / mini; states incl. blocked, overdue, claimed-by-agent, in-review; the card is a link (`<a href>` to `?task=`); context menu on Shift+F10 | solid |
| **StatusBadge** | `StateIcon.tsx`, `wizard/StatusChip.tsx`, `agent/ExecutionStateLine.tsx`, `agent-states.ts`, `PriorityIcon`, `SizeChip`, `markers.css` | one `StatusBadge`: tones neutral / info / success / warning / danger / accent; dot, chip or line; always text or `aria-label`; tone → `--chip-*` triples | — |
| **Identity** | `agent/AgentChip.tsx:35`, `agent-mark/AgentMark.tsx:31`, `PresencePerson`, `PersonLink`, `theme/avatar-color.ts`, `theme/initials.ts` | kinds person / agent / twin; avatar + name + coding tool + device + presence; harness shown once; agent work reads "*agent* · *device* (for *person*)" (V7) | — |
| **Timeline** | `task/ActivityFeed.tsx`, `feed-groups.ts`, `feed-line.ts`, `ActivityPanels.tsx`, `profile/ActivityCard.tsx` | `Timeline` + `TimelineItem` kinds comment / status / checkpoint / claim / round / CI / commit; sticky day separators; `ol` of `article`; virtualise above 200 items; new items announced, never steal focus | solid |
| **MarkdownView** | `task/TaskMarkdown.tsx` (safety rules :16-37), `CommentBody.tsx`, `DocumentField.tsx` | `t-reading` at 72ch; heading ids + outline; fences → `CodeView`; `LAI-` keys → `useOpenTask` | **solid always** |
| **CodeView** | `wizard/CodeBlock.tsx` (copy, secret highlighting, no syntax colour) | gutter, wrap, copy, language label, `#L10-L20` range; highlighting lazy, themed by `--code-*` tokens | **solid always** |
| **EvidencePanel** | `task/EvidenceSection.tsx`, `evidence-derive.ts` | rounds → per-round checks (StatusBadge), test commands with exit codes in CodeView; shown during work with a "provisional" badge | solid |
| **Report** | none | ScreenHeader + MarkdownView + KPI tiles (`t-numeric`) + existing SVG charts; print stylesheet | tiles **glass 1** on dashboards; body solid |
| **Checklist** | `task/acceptance-derive.ts` | `ul` of `Checkbox` with "n of m"; read-only with reason for non-reviewers | solid |
| **ApprovalBar** | `review/ReviewScreen.tsx:486-495` (B9), `SendBackDialog.tsx`, drawer review actions | Accept (primary) → **undo toast (5 s)**; Send back → dialog with required reason; busy via `Button busy`; disabled with visible reason | **glass 2** when sticky at 390 |
| **Menu** | `wizard/OverflowMenu.tsx:42`, `Dropdown.tsx` (819, `placeWithin` in `dropdown-model.ts:253`), `space/SpaceMenu.tsx`, hand-rolled `BoardScreen.tsx:1199`, `ListMenu.tsx`, panel overflow | one `Menu` on `Popover`: `aria-haspopup`, arrows, Home / End, typeahead; **Escape closes only the menu** (B3); destructive items last → `InlineConfirm`; bottom sheet under `(pointer: coarse)` | **glass 2** |
| **Popover** | 8 hand-rolled (`SpacesPopover`, `ViewSettings`, `BoardInsights`, `CardFilter`, `HeaderPopover`, `BoardToolbar` ×2, `WhoDidThis`) | anchor, placement, flip / shift, dismiss layer; `modal` / `non-modal`; on `@floating-ui/react-dom` (own task) or a promoted `placeWithin` | **glass 2** |
| **Tooltip** | 4 hand-rolled, `profile/InfoTip.tsx:27`, 384 `title=` | hover + focus after 400 ms; Escape hides; `aria-describedby`; never interactive; long-press on touch; retire `title=` on controls | **glass 3** |
| **Tabs** | `PageTabs.tsx:30`, `space/ViewTabs.tsx:33`; tablist copies in `HandoffsTab`, `Contributors`, `DayTabs` (B26), `ActivityFeed` | local variant: roving tablist, automatic activation, Home / End; route variant: `nav` links with `aria-current`; below 600 the strip scrolls with fade edges | — |
| **InlineConfirm** | five shapes (`DangerTab`, `MembersTab`, `AccessTab`, `SprintsScreen`, `RichEditor`) | replaces the trigger with "Sure? [Confirm] [Cancel]"; focus to Cancel; Escape cancels and returns focus; for reversible-but-annoying actions (B4); irreversible → ConfirmDialog | inherits |
| **Dialog** | `ConfirmDialog.tsx`, `ConfirmProvider.tsx`, `use-dialog-focus.ts:42`; 15 of 27 dialogs skip it | one base: `role="dialog"`, `aria-modal`, `aria-labelledby`, trap, `inert` siblings, restore focus; variants confirm / form / destructive; **TaskDrawer and SidePanel rebuilt on it** (B3); scroll lock by class on `<html>`, never Radix Dialog | **glass 3** for small confirms, **solid** for forms |
| **Toast** | `my-day/Toast.tsx:38`, private copy in `MembersTab.tsx` | `ToastProvider` + `useToast()`; bottom-centre below 600, bottom-right otherwise; 5 s, paused on hover / focus; real Undo button; errors persist; one live region (polite / assertive); never moves focus | **glass 3** |
| **States** | `EmptyState.tsx:23`, `LoadingState.tsx:155`, `ErrorState.tsx:22`, `ApiErrorState.tsx:44`, `PermissionDenied.tsx`; `states.test.ts`, `loading-sweep.test.ts` | keep; add **an error is never shown as empty**: every data hook returns `{data, error, retry}`; a screen test asserts Retry on a 500 | solid |
| **Notification centre** | Inbox tabs; shell pollers | header bell → Popover with All / Review / Handoffs / Alerts; counts and links only until `/me/notifications` exists | **glass 2** |
| **Icon** | `sidebar/NavIcon.tsx:14-22` path arrays; 53 files with inline `<svg>`; one-offs | `components/icon/Icon.tsx`: one path registry, 24 px grid, 1.75 stroke, `currentColor`, `aria-hidden` default, sizes 16/20/24; guard: no `<svg>` outside `icon/` and `agent-mark/` (+ chart allow-list). **No icon package.** | — |
| **GlassSurface** | `confirm-dialog.css:21` is the only `backdrop-filter` today | `<GlassSurface level={1|2|3}>` + `.glass-1..3` utilities; the only place `backdrop-filter` may appear | — |

### 2.1 Single-source hooks

| Hook | Replaces | Contract |
| --- | --- | --- |
| `usePolled(fn, ms)` | 7 intervals (`use-review-count.ts:56`, `use-unlisted-count.ts:45`, `token-alerts.ts:105`, `use-handoff-counts.ts:42`, `use-task-handoffs.ts:82`, `CapacityScreen.tsx:217`, `ReviewScreen.tsx:92`) | pauses when hidden; one immediate read on visible; returns `{data, error, retry, age}`; never clears data on error |
| `useResource(key, fn)` | hand-rolled loaders | `{data, error, retry}`; cache-backed; SSE-invalidated |
| `useOpenTask()` | 7 ways to open a task, incl. `my-day/task-link.ts:16-18` | always `?project=<slug>&task=<id>` or `/task/:key`; returns an `href` so cmd-click works |
| `useMedia(query)` | private `matchMedia` copies (`AppShell.tsx:20, 30`, `sidebar-state.ts:22`, `my-day/use-phone.ts:8`, `MyDayDrawer.tsx:43`, `ActivityCard.tsx:122`) | queries built from `theme/breakpoints.ts` only |
| `useDismissLayer()` | per-component Escape handling | one stack: Escape closes only the topmost layer |

## 3. Oversized files and split seams (evidence + proposal)

Line counts re-measured at `9ac3be1f`.

| File | Lines | Seam (proposal) | When |
| --- | --- | --- | --- |
| `routes/screens/my-day/my-day.css` | 3,274 | split by sub-component, matching the TSX split below | with My Day work |
| `routes/screens/my-day/Timeline.tsx` | 2,160 | layout math → `timeline-layout.ts`; drag → existing `tray-drag.ts`; rendering per lane | with My Day work |
| `routes/screens/my-day/MyDayScreen.tsx` | 2,144 | per-section readers (fixes B7: one failure no longer replaces the day); header / timer / drafts / plate as children | Foundation (V2, B7) |
| `routes/screens/BoardScreen.tsx` | 1,813 | **drawer block :1752-1809 deleted** once `TaskDrawerHost` lives in `SpaceLayout`; menu :1199 → `Menu`; notices → `BoardNotices`; list vs kanban host | Phase C S0 |
| `routes/screens/developer/AgentsTab.tsx` | 1,797 | lift `SecretPanel`, `RenameForm`, `AccessForm`, `useOnceSecret` into `components/agent/`; then the classic developer UI can be deleted | Foundation |
| `routes/screens/developer/v3/ProjectSetupTab.tsx` | 1,759 | wizard steps per file; re-check poll → `usePolled` | Foundation |
| `routes/screens/profile/ProfileScreen.tsx` | 1,597 | per-tab components; `AdminPanel` already separate | later |
| `routes/screens/board/TaskDetailPanel.tsx` | 1,257 | `useTaskWorkroom` (reads :202-700) + `TaskEnvironment` / `TaskActions` contexts + `TaskHeader`, `OverviewArea`, `EvidenceArea`, `DiscussionArea`, `TaskRail`, `ExecutionArea`, `ReviewActions` (`specifications/task-workroom.md` §3) | Phase C S1 |
| `routes/screens/connect/ConnectScreen.tsx` | 1,180 | one file per wizard step | with classic deletion |
| `routes/screens/timeline/TimelineScreen.tsx` | 1,047 | row model → `use-timeline.ts` (exists); bars vs side table | later |
| `routes/screens/board/BoardToolbar.tsx` | 1,019 | filter popover, stats, view settings as separate components on `Popover` (V6) | Foundation |
| `routes/screens/organisation/PeopleTab.tsx` | 907 | table → shared `DataTable` when built | later |
| `components/Dropdown.tsx` | 819 | `placeWithin` → `Popover` positioning | with Popover |
| `routes/screens/organisation/OrganisationScreen.tsx` | 813 | per-tab components | later |

**Rule:** a split lands **with** a behaviour change that needs it, never as a
standalone refactor PR, and never changes behaviour on its own — the existing
tests pass unchanged (Workroom S1 acceptance).

# reorganise-navigation — 2026-10-20

## 2026-10-20T09:01:14Z — LAI-796

**What changed**
- server/web/src/routes/route-table.ts — groups `HOME` (My day, Inbox) and `ORG` (Insights, Organisation, Developer access); routes `/inbox`, `/insights`, `/developer`, `/developer/connect`; `icon` and `section` replace `mini`; `SPACE_TAB_GROUPS` with `spaceTabGroups()`; `navSection()` lights Developer access for the wizard
- server/web/src/routes/redirects.ts, use-route.ts — every old address (`/review`, `/unlisted`, `/capacity`, `/usage`, `/tokens`, `/connect`) is replaced in place by its new home on load, on in-app navigation and on Back, keeping its query (`?agent=`), dropping Capacity's old `?project=`
- server/web/src/routes/page-tabs.ts, nav-permissions.ts — the tabs of Inbox, Insights and Organisation, their gates (`audit_log.export`, new `token.list_any` through `canManageOrg`), `?tab=`, and the Inbox count as the two counts added
- server/web/src/components/ScreenHeader.tsx, screen-header.css, PageTabs.tsx, page-tabs.css — a `page` variant (title, description, lead, actions, a row below) and `EmbeddedScreen`: a screen inside a page hands its header controls to the page header, so the existing screens are unchanged inside their tabs
- server/web/src/components/sidebar/* (Sidebar, SidebarFooter, SpacesSection, NavIcon, sidebar-state, menu-keys, sidebar.css), SpaceBadge.tsx, AppShell.tsx, ShellSidebar.tsx, app-shell.css — the new rail, the icon rail (remembered, automatic ≤1180px, tooltips on hover and keyboard focus, counts on the icon), the user menu (WAI-ARIA menu button), coloured space letters
- server/web/src/components/space/ViewTabs.tsx, space.css — the space tabs in two groups with a hairline
- server/web/src/routes/screens/inbox/, insights/, developer/ (DeveloperScreen, ConnectCard), organisation/ (four tabs, OrgSpaces, styles) — the pages
- server/web/src/routes/screens/my-day/ (MyDayScreen, WeekStrip, DayBar, OnYourPlate, day-timeline.ts, plate-derive.ts, my-day.css) — My day after the reference
- server/web/src/api/use-review-count.ts, components/shell/* — the shell keeps the review queue it already reads, for My day
- server/web/src/routes/screens/{usage,tokens,capacity,connect}/ — Usage's controls into its header; Tokens' intro to the page; Capacity's and Connect's links to the new addresses; the wizard opens on its token step with `?step=2`
- server/web/test/** — unit tests for redirects, page tabs, sidebar state, menu keys, the day timeline and the plate; browser tests for the rail, the user menu, the redirects, My day; every affected guard and browser test pointed at the new structure
- docs/SPEC.md — §11.4.2 and §11.4.2.1 only, the named cross-area edit the brief authorised

**Decisions**
- Tabs embed the existing screens through a header context rather than rewriting them — each screen's own controls (Usage's range, *New token*) are portaled to the page header. Rewriting six screens to drop their headers would have changed what they do and churned their tests for no gain.
- The Connect card never mints: the wizard's single hook is the only holder of a one-time secret, so *Create token* opens the wizard on its token step. A second minting surface would be a second thing to blank (`TokensScreen.forget`).
- Redirects in `useRoute` as a `replace`, not a server redirect: the SPA owns its routing and the server's fallback already serves every path; a push would make Back bounce. A mutation (push instead of replace) turned the browser test red, so the check is live.
- My day's *Waiting on your review* reuses the queue the shell already downloads for the badge, rather than a second `GET /review` — that response is the heavy one LAI-799 is about.
- The sidebar stays the prototype's 212px, not the reference's 232px: with the sidebar open at 1024px, 232px squeezed the board toolbar's search to 82px against LAI-727's 120px guarantee (the gate caught it). The tests that mean "sidebar open" between 901 and 1180px open it with the toggle, as a reader would.
- The per-person Tokens panel moved to Organisation → Security (owners and admins), keeping the old rule of no control on your own row.

**Discovered**
- The board toolbar's sprint pill flips tier when hovered at its pill/compact boundary (an 860px column — now what a 920px window gives with the rail), so the pill never opens; `board-sprint-stats.test.ts` failed on it in the gate. The test now opens the sidebar at 920px, the geometry it was written for. → LAI-804 filed (discovered-from: LAI-796).
- Two merges of master during the work: LAI-795 (slim lists — `listTasks` is slim, so On your plate reads `TaskSummary`) and LAI-788 (Solidtime; `EntryRow`'s import rule is unchanged inside the new layout). No conflicts.
- LAI-799 (slim the review queue) will change what the shell holds; My day's plate reads only `task.id`, `key`, `title`, `project.slug`, `can_decide` and `round.ci`, so it should survive a slimmer queue — whoever builds LAI-799 should keep those.
- Before: the sidebar was 212px while `--rail-width` said 280px, and nothing read `--rail-width`; it now matches the sidebar (212/60px).

**State**
In `.tasks/review/`. Gate below.

**Gate** (repo root, after the last code edit `8a7de57a`, master `6a94951c` merged; load average about 20)
- `pnpm test` → **TEST 1**: web 2324/2324 pass (0 cancelled), cli 504 pass / 0 fail, server 3275 pass / 3 fail — `test/db/migrate.test.ts` (1: *keeps the ratings and refuses a replace of one*, 8.4s timeout) and `test/tooling/build.test.ts` (2: *keeps an idle connection open for 65 s*, *serves the committed fallback*, 10s health waits). Both are on the known load-timeout list (LAI-768).
- Alone: `vitest run test/db/migrate.test.ts` → exit 0, 24/24; `vitest run test/tooling/build.test.ts` → exit 0, 15/15.
- `pnpm lint` → **LINT 0**. `pnpm format` → **FMT 0**.
- Failure grep: only `Failed Tests 3` (the server's three above) and two passing `fieldErrors` test names.
- The task's *Gate* criterion is left unticked: `pnpm test` did not exit 0.

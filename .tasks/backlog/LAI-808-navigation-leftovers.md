---
id: LAI-808
title: 'LAI-796 leftovers: dead shell props, a test comment that claims an untested path, two coverage gaps, and ?step=2 left in the address'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

The reorganised navigation carries no dead code and no test that claims more
than it proves (CLAUDE.md §5).

## Acceptance criteria

- [ ] Remove the dead code. `sprintCount` is computed and passed through
      `shell-context.ts:50` but nothing reads it. `ThemeSwitch`'s `compact`
      prop is passed by nobody. `spaceTabs()` is used only by tests: delete
      it or use it.
- [ ] The header of `server/web/test/browser/nav-redirects.test.ts` claims
      that an in-app link to an old address lands on its new home, but no
      test runs `use-route.ts:51-59`. Add that test, or narrow the comment to
      bookmarks and Back.
- [ ] Add a browser test with both Inbox counts non-zero at once (Review
      waiting and Unlisted open) that asserts the sum.
- [ ] Bring back "no shift after draw" for the default rail state at 1024
      and 920px, not only with the sidebar opened.
- [ ] The Connect wizard drops `?step=2` from the address once it has been
      used (`ConnectScreen.tsx:174`), so a reload does not reopen the token
      step. Or say why it should stay.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

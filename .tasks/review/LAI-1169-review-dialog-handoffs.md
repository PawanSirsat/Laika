---
id: LAI-1169
title: Review dialog with Prev/Next and keys; Needs your approval section; Accept everywhere
area: web
assignee: chief
priority: p1
depends-on: [LAI-1168]
status: review
started: 2026-11-10T09:00:00+02:00
finished: 2026-11-10T13:30:00+02:00
---

# LAI-1169 — Review dialog, hand-offs fold, "Accept" everywhere

**PR B of the Inbox → Review plan (D-146 items 3, 4 and 5).** Builds on LAI-1168
(PR A, merged as `960d5b0c`). Web only (`server/web/`), plus the named docs edits
below. No server change. Built by a CHIEF-dispatched builder (build-1169) on
Belka in `../Laika-1169`, branch `LAI-1169-review-dialog-handoffs`.

## Scope

1. **The Review dialog** (`routes/screens/review/ReviewDialog.tsx`,
   `ReviewShips.tsx`, `review-dialog.css`, `rd-*`): the Create task dialog's
   house shape (portal, scrim 60, box 61, `role="dialog" aria-modal
   aria-labelledby data-dialog="review"`, `useDialogFocus`, ≤900px full sheet),
   replacing LAI-1168's inline expand. Opened by a row; `?item=<taskId>` pushed;
   Prev/Next replace; close removes it. Head: key · title · space · assignee ·
   agent · round · waiting. Body: finish summary (`TaskMarkdown`), the proof
   (`EvidenceSection`, its own `GET /tasks/:id/rounds`), the Ships list read-only
   (`dl-mark-*`). Foot: Prev · *n of N* (`role="status"`) · Next | Open on board |
   Send back… | Accept. Keys `j`/`↓`, `k`/`↑`, `a`, `s`, Escape via
   `dialogCommand` + `typingIn`, guarded by DOM containment.
2. **Hand-offs fold**: `INBOX_TABS` = Review, Unlisted work; `inboxAlias`
   (`?tab=handoffs` → `?tab=review&view=handoffs`) applied in `InboxRoute` as a
   replace; `HandoffsTab` gains `only?`; `NeedsApprovalSection.tsx` at the top of
   Review; `?view=handoffs` renders the full tab with *← Back to review*;
   `handoffsWaiting` → `needs_approval` only.
3. **Approve → Accept**: `StateHero.tsx` (text, prop `onAccept`),
   `TaskDetailPanel.tsx`, `hero-derive.ts` comment, `feed-line.ts` `'Accepted'`.
   Hand-off and device-pairing Approve untouched.
4. **PR A review follow-ups**: the truncated empty state says *the first N…*
   when `queue.truncated`; `?view=handoffs` has its own branch; a browser case
   for a ticked row hidden by a filter / view change.

## Acceptance criteria

- [x] Clicking a row opens `role=dialog` labelled by key and title; `?item=` is in
      the address; Back closes; a deep link opens once the queue loads; a stale
      `?item=` drops the param with "That task is no longer waiting for review".
- [x] Focus lands on Accept (Close when not decidable); Tab and Shift+Tab stay
      inside; Escape closes and focus returns to the row.
- [x] Prev / Next and `j`/`k`/arrows walk the drawn order, `n of N` follows, the
      ends stop; Prev/Next focus the heading.
- [x] `a` posts the accept and advances to the next row; a decision on the last
      row closes the dialog.
- [x] `s` opens *Send back LC-2* over the dialog; typing in its textarea posts
      nothing and moves nothing; Escape there closes it alone and focus returns
      to *Send back…*; sending advances.
- [x] A row without `can_decide` opens with no decisions, Open on board and the
      `rev-why` sentence.
- [x] Dark theme and 390px: a full sheet, no horizontal scroll (screenshots).
- [x] `INBOX_TABS` is Review, Unlisted work; `/inbox?tab=handoffs` ends at
      `?tab=review&view=handoffs` in place (one Back leaves the app).
- [x] `[data-needs-approval]` says *Needs your approval (2)*, Approve posts from
      there, the count follows, *All hand-offs →* opens the full tab.
- [x] The badge counts `needs_approval` alone (`4` → `2` in
      `inbox-handoffs.test.ts`); the Review tab's count is decidable +
      needs_approval, so the tabs add up to the badge.
- [x] The task drawer's hero says *Accept*; the feed says *Accepted*.
- [x] A ticked row hidden by a filter is not posted and the bar count drops; a
      view change clears the selection.
- [x] Unit: `review-derive.test.ts` (itemParam, withItem, positionOf,
      advanceAfterDecide, dialogCommand), `page-tabs.test.ts` (tabs, inboxAlias),
      `person-handoffs.test.ts`, `feed-line.test.ts`.
- [x] Mutation checks: DOM containment guard removed → the `s`-then-`a` test red
      (1 of 6 failed, restored green) — **after a first attempt stayed green**,
      because `SendBackDialog` was a React sibling of the dialog and its keys
      never reached the guard; it is now rendered as the dialog's React child
      (own portal), the Cancel-button `a`/`j` case was added, and the mutation
      then went red; `advanceAfterDecide` returning the same id → 3 unit tests
      red (restored green).
- [x] Docs: SPEC §4.74 sentence (`:4687`), the sidebar row, the Inbox row, the
      §11.4.2.1 Inbox and Review entries; D-146 addendum appended (not renumbered).
- [x] Guards green, single files: loading-sweep, states, tokens, screen-header,
      routes, endpoint-coverage, view-type-drift, nav-truth, screen-registry,
      redirects; server `structure.test.ts`, `task-file-state.test.ts`.

## Deviations, named

- **The Review tab's count** is `inboxCount(reviewDecidable, undefined,
  handoffsWaiting(counts))`, not `reviewDecidable` alone: the plan did not say,
  and LAI-796's rule is that the tabs' counts add up to the sidebar's badge.
- **`NeedsApprovalSection` latches once shown**: the plan says "renders nothing
  when the count is 0"; on a fresh page it does, but once drawn it stays for the
  page's life, because approving the last offer takes the count to 0 while the
  reader's focus is on that row and an unmount would drop it to `<body>`.
- **`TaskDetailPanel.tsx:595`** was listed for the rename and left: that
  comment is about hand-off approval (`approveFor`), which keeps its word.
- `scratch-882-install.txt` and `tools/` in the root worktree are not this
  task's and were not touched.

## Review round 1 (CHIEF, 2026-11-10; fixed 2026-11-11)

CI round 1 red: `github-confirm.test.ts` still read the inline expand — re-aimed
at the dialog (`5b634f30`, `402d9886`). Then seven review items, all fixed:

- [x] 1 (high) Keys dead when focus left the box: `.rd-dialog` has `tabIndex={-1}`
      so a click on its text keeps focus inside, and Accept moves focus to the
      heading **before** the request disables it; the Send back dialog's restore
      falls back to the heading when *Send back…* has been disabled meanwhile.
      Tests: click the summary text → `j` advances; `a` with the accept held →
      focus on the heading, Escape closes.
- [x] 2 (high) Stale closure reopened a closed dialog: `decided()` reads the live
      `?item` through `openIdRef` (and `openTask` the live params through
      `paramsRef`) and advances only if the dialog is still on the decided task.
      Tests: Escape and × during a held accept → stays closed, no `?item`.
- [x] 3 (medium) `advanceAfterDecide` now receives `present` = the rows drawn at
      response time. Test: LC-2 dropped by a re-read while LC-1's accept is held
      → the dialog advances to LC-3.
- [x] 4 (low-medium) `inFlight: ReadonlySet<string>` replaces the single `busy`
      id; Prev/Next and their keys are held while any decision is out; cleared
      per id. Test: `j` during a held accept does not move; Next disabled.
- [x] 5 (low) Next from a vanished item goes to the row now drawn where it stood
      (`order[lastIndex]`), else the first — the code now matches the comment.
      Test: LC-2 taken by a re-read → *This task left the queue*, Next → LC-3.
- [x] 6 (low) `InboxRoute` renders a `LoadingState` for the one render before the
      alias replaces the params, so the queue is neither fetched nor flashed.
- [x] 7 (low) Dead `.rev-detail` rules removed from `review.css`, and `.rev-actions`
      with them (nothing in `src/` references either).
- [x] Mutation checks of the round: see the log entry of 2026-11-11.

## Verification (Belka, single files)

See `logs/chief-2026-11-10-LAI-1169.md` for every command and exit code.

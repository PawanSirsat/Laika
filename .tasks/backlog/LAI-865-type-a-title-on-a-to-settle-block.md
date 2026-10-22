---
id: LAI-865
title: 'My day: type a title on a To settle block before confirming it, and it becomes the entry''s note'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

A person can type a short title on a drafted block in **To settle**, see it
there, and confirm the block. The title becomes the confirmed entry's
**Note**, which stays editable. It works from the keyboard as well as the
mouse, and in both themes.

## What is there today (read at `28cf1877`)

- **The column exists, so no migration is needed.** `time_drafts.note`
  (`server/src/db/schema.ts:2223-2224`) has the comment "An agent's proposal
  may say what it was for, briefly". Its CHECK is `length(note) <= 200`
  (`:2262`). Confirming copies it into the entry: `confirmRow` sets
  `note: row.note` (`server/src/services/time-drafts.ts:907`). Bulk Confirm and
  Confirm day go through the same `confirmRow`.
- **Only an agent can set it.** A proposal's `note` is ≤ 200
  (`server/src/http/routes/time.ts:134`). `DraftPatchBody` (`:139-147`) takes
  `task, project, general, minutes, started_at, ended_at` and is a
  `strictObject`, so `{ note }` is `422` today. The confirm route reads no
  body (`:325-329`).
- **Showing it.** The Inspector's draft view shows an agent's note read-only:
  `` ` · “${draft.note}”` `` (`server/web/src/routes/screens/my-day/Inspector.tsx:333`).
  The To settle row (`DraftRow.tsx:29-46`) does not show it.
- **The entry's Note already exists.** It is a form with a 280-character
  field and **Save note** (`Inspector.tsx:591-621`). It calls
  `PATCH /me/time-entries/:id { note }` (`MyDayScreen.tsx:652-660`), which
  allows `max(280)` (`time.ts:166`). The entry's CHECK is ≤ 280
  (`schema.ts:2324`).
- **Keys** (`shortcuts.ts:28-58`):
  - No shortcut fires while the focus is in a text field (`typingIn`).
  - ↵ confirms the selected block, unless the focus is on an element whose
    own ↵ means something (`ACTS_ON_ENTER`).
  - G puts the block on General (`MyDayScreen.tsx:720-723`). That sends
    `PATCH {general: true}`, and `updateDraft`'s `.set` does not touch `note`
    (`time-drafts.ts:783-797`).
- **Editing a draft holds it.** `updateDraft` sets `collectorId: ''`
  (`time-drafts.ts:795`), so the next collector upload no longer replaces the
  block (SPEC §6.4, *The person's hands*).

## Acceptance criteria

- [ ] **Server.** `PATCH /me/time-drafts/:id` takes `note`: a string of at
      most 200 characters (the draft CHECK), or `null`. It is trimmed, and
      blank becomes `null`, as the entry's note does
      (`time-entries.ts:685-690`). A server test sets a note, confirms the
      block, and asserts the entry's `note`. It runs once through
      `…/confirm` and once through `POST /me/time/days/:day/confirm`. It
      fails today with `422` on the PATCH, not with some other error.
- [ ] Setting a title **holds** the block, as every other edit does. A test
      uploads the same day from the collector after the title is set and
      asserts the block and its title are still there.
- [ ] **No migration.** 200 stays the draft limit. The field's `maxLength` is
      200, and the reason (the draft CHECK, `schema.ts:2262`) is in a comment.
- [ ] **Web: typed and shown.** A drafted block in To settle has a title
      field. An agent's existing note is its starting text. Once saved, the
      title shows on the block's row in To settle and in the Inspector. A
      browser test types a title, saves it, and reads it back from both
      places.
- [ ] **It carries into the entry, and stays editable.** After confirming,
      the entry's Note field holds the title, and **Save note** changes it
      (`PATCH /me/time-entries/:id`). A browser test asserts both requests,
      confirm then note, and the shown text after each.
- [ ] **From the keyboard: T reaches the field.** **T** moves the focus
      into the selected block's title field. It is a new `'title'` shortcut
      in `shortcuts.ts` (`LETTERS`, `:41-46`), and like every other key it
      does not fire while typing. T is free: My day uses ↵, G, X (not work,
      `MyDayScreen.tsx:722`), J, K, ? and Esc, and the app's `/` belongs to
      the space top bar. In the field:
      - ↵ saves the title, does **not** confirm, and takes the focus out of
        the field, so My day's keys work again;
      - Esc leaves the field without saving.

      The browser test runs this with no clicks:
      1. J selects a block.
      2. T puts the focus in its title field.
      3. The person types a title.
      4. ↵ saves it.
      5. The next ↵ confirms the block with the title.

      A second case presses G after saving: the block goes on General and
      keeps its title. While the focus is in the field, J, K, G, X, T and ?
      type letters and fire nothing (`typingIn`). `shortcuts.test.ts` covers
      T, and the case where T is typed in a field.
- [ ] **The key is listed.** `SHORTCUT_SHEET` (`shortcuts.ts:61-69`) gains
      `['T', 'Type a title for the selected draft']`, and the Inspector's
      hint row (`Inspector.tsx:445-450`) shows T beside the others. A test
      asserts the sheet's row.
- [ ] **Both themes.** The field and the row's title are checked in light and
      dark with `setTheme` (`server/web/test/browser/harness.ts:556`). Text and
      placeholder use existing tokens only (D-020), and the title does not
      overflow the row at the 390px phone layout (LAI-831).
- [ ] The client's `DraftPatch` (`server/web/src/api/time.ts:191-201`)
      carries `note`. `server/web/test/api/view-type-drift.test.ts` stays green.
- [ ] **SPEC, a named edit (D-033/D-034), these lines only:**
      - §4.47's `note` row (`docs/SPEC.md:1812`): the person may set it too;
      - §6.4's `PATCH /api/v1/me/time-drafts/:id` body (`:2321`);
      - §6.4's *The person's hands* paragraph (`:2989-3003`);
      - §11.4.2.1's My day entry (`:4315` on), one clause: a block can carry
        a title.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Belka** (D-097; board tag `host-belka`), after LAI-868 (owner's
  order, 2026-10-22: LAI-868 first, then this one).
- Files: `server/src/http/routes/time.ts` (`DraftPatchBody`),
  `server/src/services/time-drafts.ts` (`DraftPatch`, `updateDraft`),
  `server/web/src/api/time.ts`, `server/web/src/routes/screens/my-day/`
  (`Inspector.tsx`, `DraftRow.tsx`, `MyDayScreen.tsx`, `shortcuts.ts`, its
  CSS), `server/web/test/routes/screens/my-day/shortcuts.test.ts`,
  `server/web/test/browser/my-day-v2.test.ts` or a new
  `my-day-title.test.ts`, `server/web/test/api/time.test.ts`,
  `server/test/services/time-drafts.test.ts`,
  `server/test/http/routes/time-my-day-v2.test.ts`, and the SPEC lines above.
  One branch carries the server half and the web half. No new dependencies.
- **Solidtime, as the code has it** (out of scope). The note becomes
  Solidtime's description **only for an entry with no card**. An entry on a
  card goes as `KEY title`: `describe()` in `cli/src/time-solidtime.ts:638-642`.
  A later note edit reaches Solidtime only if the card or space also changed
  (`:890-898`, `moved`). So a title on a card's block stays in Laika. If the
  owner wants it in Solidtime, that is a new task.
- Undo after a title restores the whole previous row, the title included
  (`server/src/services/time-undo.ts:136`). Nothing to build; a test may say
  so.
- LAI-866 (folder names, on Strelka) changes the same row and Inspector
  later. Whichever lands second merges the other.
- The confirm route takes no body, so a title cannot ride on `…/confirm`.
  Setting it by PATCH means bulk Confirm and Confirm day carry it with no
  further change.

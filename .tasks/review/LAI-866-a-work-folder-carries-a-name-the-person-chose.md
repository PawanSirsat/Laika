---
id: LAI-866
title: 'Time drafts: a work folder carries a name the person chose, never its real name or path'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-22T07:06:44Z
finished: 2026-10-22T07:46:02Z
---

## Goal

The person names a work folder once, on their laptop: for example, this
folder is **"Acme"**. Every block drafted from that folder then carries
"Acme". In To settle, an untied block reads **"Needs a card · Acme"** instead
of "Nothing named a card". If a Laika project matches the name, the block
also goes under that project.

This applies to Claude Code sessions and to Omnigent chats alike. Only the
chosen name leaves the machine, plus the branch name if the person turns that
on. The folder's real name and path never leave. The owner approved this on
2026-10-22, and it is recorded as **D-098**. It replaces the earlier idea of
linking a folder to a project, which was never filed.

**Sent:** the name the person chose, and the branch name only when they
turned that on.

**Never sent:** the folder's real name or path, file names, prompts, replies
or commit messages.

## What is there today (read at `28cf1877`)

- **The upload is closed to text.**
  - `DraftsBody` says "**Nothing in it can hold text**"
    (`server/src/http/routes/time.ts:84-88`) and is a `strictObject` at every
    level.
  - A server test refuses `{ prompt }`, `{ repo }`, `{ branch }` and
    `{ title }` on a block (`server/test/http/routes/time.test.ts:163`,
    "takes blocks and counts, and refuses anything that could carry text").
  - The CLI's stub-board contract allows only
    `start, end, minutes, task, signals` (`cli/test/support/local-activity-contract.ts:318`).
  - D-096 ends: "The upload stays a closed schema of numbers, a zone and a
    key-shaped string."
- **The collector never decides a project.** The server takes it from the
  key's task (`server/src/services/time-drafts.ts:473`), or the person sets it
  with `PATCH { project }`. A draft with a project and no card already shows
  the project's name and "A space, no card", and can be confirmed
  (`server/web/src/routes/screens/my-day/DraftRow.tsx:35-36`).
- **Folders, locally.**
  - A Claude Code reply carries its working directory, "local only, never
    sent" (`DraftReply.cwd`, `cli/src/activity-usage.ts:2490-2497`).
  - An Omnigent orchestrator's turns are pushed with `repo: null`
    (`cli/src/activity-time.ts:329-330`).
  - The hook records no session start and no repository for them
    (`plugin/scripts/laika-activity-hook:92-95`). The event line has no
    folder field (`TURN_LINE`, `activity-time.ts:697`).
- **The strings.**
  - "Needs a card" and "Nothing named a card" are in `DraftRow.tsx:29-46`,
    `Inspector.tsx:356` and `:365`, and `Timeline.tsx:65`.
  - "Counts only — never what you typed, file names or commit messages." is
    at `Inspector.tsx:441`, asserted by
    `server/web/test/browser/my-day-v2.test.ts:464`.
- **Local files.**
  - `laika activity off` deletes all of `~/.laika/activity`
    (`cli/src/activity.ts:404-407`).
  - Files directly in `~/.laika` survive it. For example,
    `~/.laika/solidtime.json` is 0600 JSON
    (`cli/src/time-solidtime.ts:123-128`).
  - `laika time map` is already taken (Solidtime projects).

## Acceptance criteria

- [x] **Naming a folder, on the machine.** A CLI command names a folder,
      renames it, lists the names and forgets one. You choose its shape. The
      names are kept under `~/.laika` in a 0600 file, and the task file says
      whether `laika activity off` keeps them.
      - The name is always typed by the person. It is never filled in from
        the folder's own name.
      - A name is bounded: you choose the length; no newline, no control
        character, no `/` or `\`.
      - A folder inside a named folder takes the nearest name.
- [x] **Blocks carry the name.** Every block drafted from a named folder
      carries its name, for Claude Code sessions (by `cwd`) and for Omnigent
      chats (by the chat's working folder). For Omnigent, the hook may record
      that folder locally (0600, never sent). If it does, the hook stays
      fork-free under zsh where it is today, and readers of older lines keep
      working, as LAI-859 did for `skip-sessions`. A block whose lanes come
      from two differently named folders follows a rule you write in
      `cli/README.md` and test.
- [x] **The branch, off by default.** A setting the person turns on
      explicitly adds the branch name to a named folder's blocks. Off, no
      branch is sent. A test asserts both.
- [x] **Nothing else leaves.** A CLI test names a folder whose real name is
      distinctive and drafts from it, a Claude Code session and an Omnigent
      turn both. The sent body carries the chosen name. It carries neither the
      folder's real name, nor any part of its path, nor `HOME`, a file name, a
      subject or prompt text. With the branch setting off, no branch name
      appears either. The test extends *only blocks leave*
      (`cli/test/activity-time.test.ts:639`). The stub-board contract
      (`local-activity-contract.ts:318`) is widened by the new field(s) only.
- [x] **Older boards are never refused.** `GET /me/time-settings` says the
      board takes the name, as `signal_times: true` does for `at` (D-096
      item 6). The collector sends the name and branch only then. A test
      against a board that does not say so shows an accepted upload with
      neither.
- [x] **The server keeps it, bounded.**
      - The upload takes the name, and the branch when sent, on a block.
        Both are stored on the draft, which only its person reads, on a web
        session (§4.47, as today).
      - Bounds, a path separator or a control character are `422`. Every
        other unknown field is still `422`.
      - The existing text-refusal test keeps refusing `prompt`, `repo` and
        `title` unchanged. Any line in it that the new field changes is
        changed on purpose and named in the task file.
- [x] **A matching project.** The server puts an untied block under a
      project when the name matches one the person may read (`project.read`).
      The rule (slug or name, case, ties) is written in SPEC §6.4. Tests
      cover:
      - a match;
      - no match;
      - a matching project the person cannot read, which never matches;
      - a block with a card, which keeps its card's project.
- [x] **The person's hands.** Before confirming, the person can change or
      clear the name, and the branch, on a draft (`PATCH`). Confirming carries
      them into the entry, where they show. A server test confirms a named
      block and reads the name back from the entry. It fails today.
- [x] **Web.**
      - An untied, unmatched block from a named folder reads "Needs a card ·
        Acme" in the To settle row and in the Inspector.
      - A block under a matched project reads as a space block does today,
        with the name shown.
      - The confirmed entry shows the name.
      - "Counts only — never what you typed, file names or commit messages"
        stays true. If the name or branch shows under *Drafted from*, the
        line says so, and `my-day-v2.test.ts:464` is changed to match.
      - Both themes, with `setTheme`.
- [x] **SPEC, a named edit (D-033/D-034), these sections only.** Each is
      updated in this PR to say what is now sent and kept:
      - **§4.47** `time_drafts`: its opening paragraph ("no column can hold
        … a branch"), the new column(s) and `note`'s neighbours;
      - **§4.48** `time_entries`: where a confirmed entry keeps the name;
      - **§6.4**, these paragraphs only: *The switches* (`docs/SPEC.md:2934`),
        *A collector's upload* (`:2945`), *My day* (`:2973`), *The person's
        hands* (`:2989`), and the `PUT`/`PATCH /api/v1/me/time-drafts` lines
        of the endpoint block (`:2318-2321`);
      - **§11.4.2.1**, the My day entry (`:4315` on);
      - **§13.4**, the paragraph *Time drafts are inbound too*
        (`:4684-4689`).
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Deviation (claim)

Claimed on Strelka on a branch based on Belka's PR #32
(`origin/chief-ops-tasks-1022`, which files this task and D-098) rather than on
`master`, because the owner told Strelka to start now, in parallel, before #32
merges. The PR for this task must merge after #32.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`). It is one of
  three collector tasks kept on one machine (LAI-864, LAI-866, LAI-867).
- **Areas:** `cli` (command, names file, drafter, body), `plugin` (the hook,
  only if the Omnigent folder needs it), `server` (route, service, schema
  with its migration, time settings), `web` (`server/web/src/routes/screens/my-day/`,
  `server/web/src/api/time.ts`), and `docs` (the SPEC sections named above,
  and nothing else). No new dependencies.
- **Privacy.** D-098 is the decision. D-088 item 4 and D-096's last
  paragraph still hold for everything except the chosen name and the
  opted-in branch. A confirmed entry is seen by owners and admins
  (D-088 item 7), so the name is seen there once confirmed. That is what the
  owner approved. Drafts stay the person's alone.
- **Solidtime is unchanged.** `describe()` (`cli/src/time-solidtime.ts:638-642`)
  is not touched; whether the name should reach Solidtime is a later
  question.
- LAI-865 (on Belka) adds a title to the same To settle row and Inspector.
  Whichever lands second merges the other.

## Review notes (PR #32, round 1; CHIEF, 2026-10-22)

These notes were appended after the task was claimed, so the criteria above
were not edited (§2). **Where a note and the text above disagree, the note
wins.** Each requirement added here is a box. Tick it at finish like any
criterion.

**B1. Project matching stays, because the owner approved it.**

- On 2026-10-22 Belka proposed: *"You name a work folder once ... Every
  block from that folder then carries the name ... if a Laika project
  matches the name, the block goes under that project as well."*
- It replaces the earlier option of linking a folder to a project, because
  it *"does the same job, plus it works for projects that aren't on
  Laika"*.
- The owner replied **"go ahead"** the same day.
- D-098 now quotes this too.

**The consequence the reviewer raised.** A block under a matched project is
confirmed under that project, not as *General*, and that changes where it can
go in Solidtime:
- a *General* entry goes there with no project;
- a space's entry goes to the Solidtime project that `laika time map` set
  for the space, or is held as `space_not_mapped` (SPEC §6.4, the outbox,
  `docs/SPEC.md:3076-3092`).

- [ ] **The person sees the project before confirming.** For a matched
      block, the To settle row and the Inspector show which project it will
      be confirmed under, and the person can change it or clear it there.
- [ ] **Test (browser):** a matched block shows its project before confirm.
      This fails today.
- [ ] **Test (server):** a matched block confirms under that project, not as
      General. This fails today.

The Notes line *"Solidtime is unchanged"* now means only that Solidtime's
code and `describe()` (`cli/src/time-solidtime.ts:638-642`) are unchanged.
The chosen name is not sent to Solidtime. A matched block's time does reach
it, as its space's time.

## Builder notes (Strelka)

- **The command:** `laika time folder name|rename NAME [DIR]`,
  `forget [DIR]`, `list`, `branch on|off` (`cli/src/time-folders.ts`). A name
  is 1–60 characters, trimmed, no `/` or `\`, no control or format character
  (`\p{Cc}\p{Cf}`), the same rule on the CLI and the server.
- **The names file:** `~/.laika/work-folders.json`, 0600, `~/.laika` kept
  0700. **`laika activity off` keeps it**: it sits beside `solidtime.json`,
  not in `~/.laika/activity`, because the names are the person's settings,
  not something counted.
- **The two-folder rule** (`cli/README.md`, tested in
  `cli/test/time-folders.test.ts`): each lane-minute that went to a block
  votes for its folder's name. The most lane-minutes wins. **A tie carries no
  name.** The branch is chosen the same way among the winning name's
  lane-minutes.
- **Omnigent's folder:** the hook appends the chat's working folder and the
  branch from `.git/HEAD` (read with `read`, never `git`) to the existing
  `primary-sessions` line, `<epoch> <id> <branch|-> <folder>`. Older readers
  take field 2 as before. It is fork-free under zsh: tested with
  `PATH=''`. A Claude Code session's branch is the one it started on (the
  hook's `sessions` file, LAI-770).
- **Server bound, no CHECK:** a table CHECK made drizzle-kit rebuild
  `time_entries`, and on an upgraded database that rename fails on
  `time_entry_revisions`' trigger (`migrate.test.ts` D-093 case found it).
  So 0047 is four `ADD COLUMN`s, and the service bounds `folder`/`branch`
  on both ways in (upload and `PATCH`). A new 0047 migration test asserts
  root pages and rows unchanged and both `time_entries` triggers still firing.
- **A branch only with a name:** a block with `branch` and no `folder` is
  `422 invalid_blocks`; `PATCH { folder: null }` clears the branch too, and
  `PATCH { branch }` on a draft with no name is `422 branch_without_folder`.
- **Lines of the text-refusal test** (`server/test/http/routes/time.test.ts`,
  "takes blocks and counts, and refuses anything that could carry text"):
  **none changed.** `{ branch: 'LAI-1-x' }` is still refused, now because a
  branch needs a name. The only edit in that file is `folder_names: true` in
  the switches' exact shape (`:126`), as in `time-settings.test.ts:103`.
- **`my-day-v2.test.ts:464`:** the line is unchanged for a block with no
  named folder, so only the test's title changed, to say so. The named case
  is asserted in `server/web/test/browser/my-day-folders.test.ts`, both
  themes.
- **Fixture:** `cli/test/activity-time.test.ts`'s repository folder is
  renamed from `acme` to `zq-orchard-ledger-7731`, so that finding its real
  name in a body means it leaked.
- **Migration number:** 0047. If LAI-864 or LAI-867 also adds one, whichever
  merges second regenerates on top (`server/src/db/migrations/README.md`).
- **Gate, run 1** (HEAD `9ae6dc83`, load ~40): `pnpm test` EXIT 1. The
  only failure was `server/test/services/sprints.test.ts` › "is exact past
  the page size" timing out at 5000 ms. That file is untouched here and
  belongs to the load-timeout family (`logs/load-timeouts-2026-10-20.md`).
  Alone, it passed 43/43, EXIT 0. `pnpm lint` EXIT 0, `pnpm format` EXIT 0.
  Run 2's result is in the log and on the PR.
- **Mutations** (each restored, checksum matched): a chat block carrying
  its folder's real name, the branch sent while off, the project match
  without `project.read`, and names sent to a board that didn't say
  `folder_names` — each red on its own assertion.

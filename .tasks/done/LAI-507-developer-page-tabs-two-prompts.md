---
id: LAI-507
title: 'Developer access: one page with four tabs, a machine prompt and a project prompt, and the personal-switch wording gone'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: done
accepted: 2026-10-24T10:32:44Z
finished: 2026-10-24T10:28:02Z
started: 2026-10-24T09:51:31Z
---

## Why

The owner, 2026-10-24, on onboarding developers: the Developer access page, a
separate four-step wizard, four "optional" extras and three prompts do not
answer *"is this once per machine or once per project?"*. Decided after the
analysis in `~/.claude/plans/we-have-to-work-curious-crystal.md`: one page
with four tabs; a machine prompt that also turns on local activity when the
organisation's Developer insights are on; a short per-project prompt that
only writes the project block; *Invite a teammate* off the page; and the
wording that still describes a personal "Share my local activity" switch
(gone since D-102 amended, LAI-963/964) fixed in the same family.

One task for the three areas because CHIEF builds it on the owner's
instruction (D-109 gives CHIEF `LAI-500` – `LAI-599`; this was filed as
LAI-997 and renumbered the same day, see the log); the
docs half (SPEC §11.4.2, §11.4.2.1, §8; a decision) and the plugin README
line are named cross-area edits (D-033).

## Acceptance criteria

- [x] `/developer` has tabs **Connect · Projects · Activity · Tokens**
      (`DEVELOPER_TABS` in `routes/page-tabs.ts`, `PageTabs` in the page
      header, `?tab=`). Connect is the default. `/developer/connect` and
      `/connect` redirect to `/developer?tab=connect` keeping `agent` and
      `step`.
- [x] **Connect** is the wizard's four steps, unchanged in behaviour (agent
      picker, mint a token, add Laika, live check). *What agents can do* is a
      disclosure under step 4. No *Invite a teammate* anywhere on the page;
      the extras rail is gone; the Developer-page "Connect an agent" card is
      retired.
- [x] **Projects**: pick a project and the agent; the block for that agent's
      instructions file (`instructionsTarget`), and an *Add this project*
      prompt that appends the block to that file if the marker line is absent,
      creates the file if missing, changes nothing else. No install step in it.
- [x] **Activity**: the `ShareActivity` panel, once. **Tokens**: the tokens
      list, its *New token* in the page header.
- [x] The Claude Code *Set up this machine* prompt: clone/pull, installer on
      stdin, `curl /me`, then `laika activity on` **only when the board says
      `org_enabled`**, then report and stop. It never writes into a
      repository, and it says to skip the install when `laika whoami` already
      answers. The `cliBlock` agents' automatic path gets `laika activity on`
      the same way.
- [x] Every setup block and the project block carry a scope chip, *Once per
      machine* or *Once per project*.
- [x] Stale wording gone: `profile/ActivityCard.tsx` ("and their own
      sharing"), `components/Switch.tsx` doc comment, the by-hand note "token
      from step 1", `connect-agents.ts` doc comments naming steps 2/3/4,
      `plugin/README.md` "Share my local activity" (LAI-973's line), the root
      `README.md` developer section (adds `laika activity on` and the project
      block, drops the `npx laika init` roadmap line).
- [x] SPEC §11.4.2's Connect row, §11.4.2.1's Developer access and Connect
      entries, and §8's `/laika:setup` sentence say what the page now is; a
      decision records *one page, two prompts: machine and project*.
- [x] Browser tests: each tab renders; the redirects keep the query; no
      "Invite" text on the page; the machine prompt has no `CLAUDE.md` step and
      has `laika activity on` only with `org_enabled: true`; the project prompt
      has no `install.sh`; 390px clean.
- [x] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Built by CHIEF in worktree `Laika-developer` on branch
`LAI-507-developer-tabs` (was `LAI-997-developer-tabs`; the commits before the
renumber were rewritten to carry the new id, being unpushed and CHIEF's own).
`~/.claude/plans/we-have-to-work-curious-crystal.md`.

## Review (CHIEF, 2026-10-24)

Built and reviewed by the same session on the owner's decisions:

- Four tabs, redirects keeping the query, no Invite, the tool reference under
  step 4: `developer-tabs.test.ts` *four tabs* and *the wizard's old address
  redirects*; `connect.test.ts` *nothing sits on the page outside the rail and
  the card*, *nobody is offered an invite here*.
- The two prompts: `connect-copy.test.ts` (machine prompt never writes a
  repository, turns the collector on only with `insightsOn`, skips the
  install when `laika whoami` answers; project prompt installs nothing and
  carries no token) and `developer-tabs.test.ts` against the rendered page,
  with the org switch on and off.
- Stale wording: grep for *their own sharing* and *the developer's on Connect*
  returns nothing in `server/web/src`; SPEC §8, §11.4.2, §11.4.2.1 rewritten;
  D-111.
- Looked at once: Connect, step 3, Projects at 1366 wide, Connect at 390.
- Gate on the branch: `pnpm lint` 0, `pnpm format` 0; root `pnpm test` — the
  first run was red on `task-file-state` (the LAI-997 collision, renumbered)
  and the `/tokens` bookmark test (re-aimed); the rerun is recorded in the log.

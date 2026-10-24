---
id: LAI-997
title: 'Developer access: one page with four tabs, a machine prompt and a project prompt, and the personal-switch wording gone'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
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
instruction and CHIEF's id block has one number left (see the log); the
docs half (SPEC §11.4.2, §11.4.2.1, §8; a decision) and the plugin README
line are named cross-area edits (D-033).

## Acceptance criteria

- [ ] `/developer` has tabs **Connect · Projects · Activity · Tokens**
      (`DEVELOPER_TABS` in `routes/page-tabs.ts`, `PageTabs` in the page
      header, `?tab=`). Connect is the default. `/developer/connect` and
      `/connect` redirect to `/developer?tab=connect` keeping `agent` and
      `step`.
- [ ] **Connect** is the wizard's four steps, unchanged in behaviour (agent
      picker, mint a token, add Laika, live check). *What agents can do* is a
      disclosure under step 4. No *Invite a teammate* anywhere on the page;
      the extras rail is gone; the Developer-page "Connect an agent" card is
      retired.
- [ ] **Projects**: pick a project and the agent; the block for that agent's
      instructions file (`instructionsTarget`), and an *Add this project*
      prompt that appends the block to that file if the marker line is absent,
      creates the file if missing, changes nothing else. No install step in it.
- [ ] **Activity**: the `ShareActivity` panel, once. **Tokens**: the tokens
      list, its *New token* in the page header.
- [ ] The Claude Code *Set up this machine* prompt: clone/pull, installer on
      stdin, `curl /me`, then `laika activity on` **only when the board says
      `org_enabled`**, then report and stop. It never writes into a
      repository, and it says to skip the install when `laika whoami` already
      answers. The `cliBlock` agents' automatic path gets `laika activity on`
      the same way.
- [ ] Every setup block and the project block carry a scope chip, *Once per
      machine* or *Once per project*.
- [ ] Stale wording gone: `profile/ActivityCard.tsx` ("and their own
      sharing"), `components/Switch.tsx` doc comment, the by-hand note "token
      from step 1", `connect-agents.ts` doc comments naming steps 2/3/4,
      `plugin/README.md` "Share my local activity" (LAI-973's line), the root
      `README.md` developer section (adds `laika activity on` and the project
      block, drops the `npx laika init` roadmap line).
- [ ] SPEC §11.4.2's Connect row, §11.4.2.1's Developer access and Connect
      entries, and §8's `/laika:setup` sentence say what the page now is; a
      decision records *one page, two prompts: machine and project*.
- [ ] Browser tests: each tab renders; the redirects keep the query; no
      "Invite" text on the page; the machine prompt has no `CLAUDE.md` step and
      has `laika activity on` only with `org_enabled: true`; the project prompt
      has no `install.sh`; 390px clean.
- [ ] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Built by CHIEF in worktree `Laika-developer` on branch
`LAI-997-developer-tabs`. Plan file:
`~/.claude/plans/we-have-to-work-curious-crystal.md`.

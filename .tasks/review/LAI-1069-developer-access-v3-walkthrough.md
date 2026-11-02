---
id: LAI-1069
title: 'Developer access V3: a recorded local walkthrough, and the board build on Organisation Overview'
area: web
assignee: polly (Belka)
priority: p1
depends-on: [LAI-1061, LAI-1062, LAI-1064]
discovered-from: LAI-1042
status: review
started: 2026-11-02T07:35:00+02:00
finished: 2026-11-02T07:47:00+02:00
---

Slice F of `docs/proposals/LAI-1042-developer-access-v3-plan.md` (F4's
precondition: *a live walkthrough recorded in `docs/acceptance/`*), plus the
board-build line §J E3 names for Organisation Overview.

## Acceptance

- [x] A real walkthrough on a **local** instance (own port, own DB file, never
      `:3000`, never production) with `LAIKA_DEVELOPER_ACCESS=v3` and
      `LAIKA_PUBLIC_URL` set to that origin: first boot → Overview → Add
      device → the real `laika device pair` from this checkout with a
      throwaway `HOME` → fingerprint approve → Add tool (Claude Code) → the
      real `laika tool add claude-code --exchange <id>` → checks, including
      one MCP `initialize` as `claude-code` → Set up a project (Read only) →
      `laika project check` if #221 has merged, else noted → Devices tab
      rotate/reconnect and disconnect confirmation.
- [x] An existing developer: seeded imported device label with two agents
      (one a legacy duplicate) and a personal token used over MCP; switching
      `classic` → `v3` loses nothing (same agent ids, grants, tokens working).
- [x] Screenshots, light + dark, desktop + 390 px, of the screens the plan
      lists, under the main checkout's `.polly/evidence/V3-walkthrough/`.
- [x] `docs/acceptance/LAI-1069-developer-access-v3.md`: each step PASS /
      FAIL with exact commands and exit codes; what could not be verified
      marked UNVERIFIED; every defect filed as a task and listed (not fixed
      here).
- [x] Organisation Overview shows the board build (`server.build_commit`
      and protocol from `GET /developer/compatibility`) to owners and admins
      only, as a quiet line; tested.
- [x] Web typecheck, eslint, prettier exit 0 on the touched files; PR into
      `master`, CI green.

## Notes

- Named cross-area edit: `docs/acceptance/LAI-1069-developer-access-v3.md`
  (one new file) alongside the SHELL `server/web/` change.
- Clean up afterwards: stop only this task's server (kill its LISTEN pid),
  delete its DB file and the throwaway `HOME`.

---
id: LAI-537
title: 'Developer access → Agents tab: registration wizard, per-agent one-time token, harness instructions, verify from THIS agent, rename/access/rotate/revoke'
area: web
assignee: shell
priority: p1
depends-on: [LAI-534, LAI-536]
discovered-from:
status: in-progress
started: 2026-10-28T20:36:34Z
---

Implements **proposal §6 (Developer access → Agents), §4.1** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human registers an agent from Developer access in five steps and
can see it verified as *that agent* — not just as themselves — then rename it,
change its project access, rotate or revoke its credential.

## Scope

- New `Agents` tab in `page-tabs.ts` under Developer access.
- Wizard adapted from Connect: name, harness and device → projects and permissions → credential (one-time reveal) → harness instructions → verify a request from this agent.
- Verify matches the **agent** id from `laika_whoami`, not the user (fixing the `connect-live.ts` user-only match for this flow).
- Agent list with rename, access, rotate and revoke; three states kept apart: credential created, connected, ready for recovery.

## Out of scope

- The task drawer and cards (LAI-538).
- Recovery readiness beyond showing the state (Phase 3).

## Acceptance criteria

- [ ] The token secret is shown once, never in a URL, never re-fetchable, and is absent from the DOM after the dialog closes (asserted).
- [ ] Verify stays pending until a request authenticated as this agent arrives; a request from the owner's other token does not complete it (asserted).
- [ ] Rotate shows the new secret once and the old token is refused afterwards (e2e against a real server).
- [ ] Revoke asks for confirmation through `useDialogFocus` and the agent shows as revoked.
- [ ] Both themes, keyboard-only operation of every step, and 390 px layout work.
- [ ] Every value on the tab comes from an API response; no hardcoded agent names.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest component tests; Playwright e2e against a real server on your own port (§4.3) for register → verify → rotate → revoke; screenshots light/dark/narrow attached.

## Dependencies

`depends-on: [LAI-534, LAI-536]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-537-agents-tab`

## Migration / rollout notes

None server-side. The Connect wizard is unchanged for human tokens.

## Claim notes (SHELL, 2026-10-28)

- **Deviation from §2 step 1, on CHIEF's direction.** Neither LAI-534 nor
  LAI-536 is in `.tasks/done/` on `master`. CHIEF dispatched this claim on a
  branch cut from LAI-534's head (`63dff7e3`, draft PR #102), so the PR is
  stacked on #102 and must not merge before it. LAI-536 (PR #101) is **not**
  on this base: the agent components it builds are not copied here; this task
  builds the minimum it needs and unification follows when both land.
- **D-114**: approved in substance by the owner on 2026-10-28; the
  authorised-account record is still pending, so the PR stays a draft.

---
id: LAI-591
title: 'Devices view — web half: Settings › Agents grouped by device, last seen, revoke a device, Not recognised'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-590, LAI-586]
discovered-from: LAI-532
status: backlog
---

Phase 2.5 slice from `docs/proposals/LAI-532-phase-index.md` (PR #121). The
server half is LAI-590; this screen calls only what LAI-590 serves (§5.1).
Board card: parent LAIKA-785.

## Goal

A person opens Settings › Agents and sees their agents **grouped by the device
they run on** — Belka, Strelka, Cloud, a colleague's laptop — each device with
when it was last seen, a *Revoke device* action that ends every agent on it,
and a plain *Not recognised* flag on a device they have never confirmed.

**User-visible outcome:** "Belka · last seen 2 min ago · Polly · Belka,
Claude Code · Belka, Codex · Belka"; "Strelka · last seen 3 h ago"; a device
reading *Not recognised* with *This is mine* and *Revoke device* beside it.

## Scope

- The Agents tab groups by device using LAI-590's list; each agent row keeps
  today's one-line name from LAI-587 (`<harness> · <device>`).
- Per device: label (*Unnamed device* for none), last seen as relative time
  with the exact time on hover/focus, active count, *Not recognised* badge with
  text (colour is never the only signal).
- *Revoke device* opens a confirmation that **lists every agent it will
  revoke** by name and says their running sessions stop; confirm calls
  LAI-590's revoke; the group updates without a reload.
- *This is mine* on an unrecognised device calls LAI-590's confirm.
- Empty, loading and error states; a revoked-only device collapses to a
  muted row.

## Exclusions

- No server, CLI or plugin change. No device rename (the label is the agent's).
- No cloud-specific UI beyond the label and flag; LAI-592 decides cloud policy.
- Does not change the card chip or drawer line (LAI-587).

## Acceptance criteria

- [ ] Agents are grouped by device from the API response; no device name,
      count or time is hardcoded (§5.1)
- [ ] Each device shows its last seen time (relative, exact on hover and
      keyboard focus) and its active agent count
- [ ] An unrecognised device carries a *Not recognised* text badge and a
      *This is mine* action that clears it after the API confirms
- [ ] *Revoke device* confirms first, naming every agent it will revoke; on
      confirm the agents show revoked; cancel changes nothing; a failed call
      shows an error and changes nothing
- [ ] Keyboard reachable, visible focus, the dialog traps and returns focus
- [ ] Both themes; no horizontal scroll at 390 px and at 1440 px
- [ ] Tests: component tests for grouping, last seen, the badge, revoke
      confirm/cancel/error; one Playwright flow revoking a seeded device
- [ ] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0

## Dependencies

- LAI-590 (server half) — the endpoints this screen calls.
- LAI-586 (LAIKA-843) — D-119 / session fields; LAI-587 for the one-line name.

## Role, machine, effort

- Role: SHELL. Machine: **Belka** (`host-belka`). Cross-vendor review.
- Effort: **M**. Confidence: **medium-high** — one tab, one dialog, the
  patterns exist in the Agents tab (LAI-537).

## Tests and UI evidence

- Vitest component tests under `server/web/test/`; one Playwright spec.
- Screenshots in the PR: light and dark, 1440 px and 390 px, of a recognised
  device, an unrecognised one, and the revoke confirmation.

## Rollout

Ships after LAI-590 is live. No flag: the tab is the owner's own view. Rollback
is a revert; the server endpoints are harmless unused.

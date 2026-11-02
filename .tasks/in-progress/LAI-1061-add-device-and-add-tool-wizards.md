---
id: LAI-1061
title: 'Developer access V3 slice D4: the Add device and Add tool wizards, and honest per-tool verification'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1050, LAI-1054, LAI-1056]
discovered-from: LAI-1042
status: in-progress
started: 2026-11-02T05:47:54+05:30
---

## Why

Slice D4 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B, §E.1–E.3, §F.3,
§F.4, §F.6, §H, §J slice D, §K, §M). LAI-1054 put the V3 Devices tab on
master with *Add device* and *Add tool* still opening the classic
registration wizard. This slice replaces that, in `v3` and `preview` only,
with a device pairing wizard (LAI-1050's endpoints) and a tool setup wizard
(LAI-1056's exchange and verification endpoints). The browser never holds a
secret: the device redeems its own credential.

Stacked on LAI-1056 (PR #211, in review); the PR's base is that branch until
it merges. The CLI half (`laika device pair`, `laika tool add`,
`install.sh --no-credential`) is LAI-1060, built in parallel; this slice
only shows the commands the plan's CLI contract (§F) names.

## Acceptance criteria

- [ ] **Add device**: local or cloud and a friendly name, no tool asked.
      Creates a pairing request; shows the fresh-install bootstrap from the
      board's own `cli.source` (clone at the board's commit,
      `install.sh --no-credential`, `laika device pair --code …`) or the
      existing-install form; never `npx`.
- [ ] A live wait on `GET /devices/pairing-requests/:id`, polling with
      backoff, announced through the throttled live region.
- [ ] Once claimed: fingerprint, OS, CLI version and claim time, *Approve
      only if this matches your terminal*, Approve / Deny echoing the
      fingerprint shown. *Device paired* only once the server reports
      `completed` — never on a click.
- [ ] Expired, already-claimed (tell the person to deny), `public_url_unset`,
      `429`, `too_many_open_pairings`, `device_name_taken` and other errors
      each say what happened and what to do.
- [ ] Pair an existing imported device, by explicit choice (`device_id`).
- [ ] **Add tool**: a paired device, then a tool from a catalog held in the
      web (plan §E.6's recommended alternative) with an honest mode per tool
      — automatic / MCP only / manual / unverified, per §M — and no
      hard-coded count. `POST /devices/:id/tools`; the exact
      `laika tool add … --exchange …` command the server returns, no secret.
- [ ] Checks from `GET /agents/:id/verification`: device paired, credential
      installed, the tool's own request, session hooks and claims only where
      the tool has them, each saying what evidence is missing. Tool-specific
      notes (Claude Code restart, Codex `/hooks` trust, Omnigent credential
      only, Antigravity manual).
- [ ] Status words per plan §H — Needs setup / Connected / Ready / Idle /
      Offline, *Version unknown* — and *Ready* only when the tool's required
      capabilities are evidenced. Another tool's request never ticks this one.
- [ ] `409 agent_duplicates_need_resolution` routes to the device's
      conflicts section. Checkpoint consent offered at the end, default off,
      for tools that have checkpoints. After the first tool, the primary next
      action is *Set up a project*.
- [ ] Wiring: Devices *+ Add device* / *+ Add tool*, Overview's journey,
      Advanced's *Upgrade connection* (`?add=tool&tool=`), and the legacy
      `?tab=connect&agent=` alias open these wizards in v3/preview. A tool
      row's *Reconnect* uses `POST /agents/:id/reconnect` and the same
      command and checks on a paired device; classic is untouched.
- [ ] Keyboard only, focus moves and returns, dialogs trap focus, both
      themes, 390 px; loading / error / 403 / session-expired / 409 / expired
      states.
- [ ] Tests: never *paired* before completion; fingerprint echo sent; no
      secret in DOM, URL or storage; commands carry no secret and no `npx`;
      *Ready* only with evidence; per-tool isolation; classic untouched; a11y.
- [ ] Screenshots light and dark, desktop and 390 px (first run, pairing
      wait, fingerprint approve, add-tool command, checks partial, ready) in
      `.polly/evidence/LAI-1061/`.

## Notes

- SHELL only, `server/web/` only. Not touched: `cli/`, Advanced and Activity
  (LAI-1058), the master-red test fixes (LAI-1059), classic Connect/Agents.
- Named cross-area edit (D-033): the `NO_BROWSER_CALLER` entries in
  `server/web/test/api/endpoint-coverage.test.ts` this slice makes stale —
  the pairing-request, `devices/*/tools`, `tool-setup/*`,
  `agents/*/reconnect` and `agents/*/verification` lines. That file is in
  `server/web/` and SHELL's anyway; named because LAI-1050 and LAI-1056
  wrote them.
- Belka: one test file at a time, single worker; CI is the full gate.
- Id: LAI-1060 was taken by the CLI slice minutes before this filing; this
  branch's first local commits said LAI-1060 and were renamed before any
  push.

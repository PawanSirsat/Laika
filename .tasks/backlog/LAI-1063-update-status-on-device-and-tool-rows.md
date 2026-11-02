---
id: LAI-1063
title: 'Developer access V3 slice E3: update status on device and tool rows, What''s new, Copy update command'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1043, LAI-1051, LAI-1054, LAI-1056, LAI-1061]
discovered-from: LAI-1042
status: backlog
---

## Why

Slice E3 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §H, §F.5, §E.6, §E.7,
§J slice E, §K). The board serves its compatibility answer (LAI-1043: build
commit, protocol, `cli.min_protocol_for`, `cli.source.commit`,
`release_notes`), each tool's self-reported client report through
`GET /agents/:id/verification` (LAI-1056), and `laika update` exists
(LAI-1051). The Devices tab still says *Version unknown* on every row.

Stacked on LAI-1061 (PR #215, in review): it adds the web's verification
client and `cli.source` reader, which this reuses rather than duplicating.
None of LAI-1061's files are edited except the tool row and device card in
`DevicesTab.tsx`. `server/` is untouched (LAI-1062 is fixing the feature
flags there).

## Acceptance criteria

- [ ] `v3` and `preview` only; classic unchanged; no separate Updates tab.
- [ ] Each active tool row shows a local-integration update status,
      separate from its connection status, in words with a reason: *Up to
      date*, *Update available* (what it does now keeps working), *Update
      required for <feature>* (only when a feature the board has switched on
      needs a newer protocol than the tool reported), *Version unknown* (no
      report — never *outdated*), *Could not check* (compatibility or
      verification fetch failed) with *Retry*.
- [ ] Compared only against the board's own `cli.source.commit`,
      `protocol` and `cli.min_protocol_for` — never "newest GitHub".
- [ ] The device card summarises its tools' update statuses.
- [ ] *What's new* from `release_notes.whats_new`; *Copy update command*:
      `laika update --check` then `laika update`, with `--allow-http` only
      when the board is plain http off loopback, and why; no secret in it.
- [ ] Post-update guidance: re-run `laika doctor`; the row refreshes when a
      new report arrives (polled, throttled live region).
- [ ] Board update shown only to org owner/admin, only when the data says
      the board is behind a helper; omitted otherwise.
- [ ] Presence off: no report time is shown.
- [ ] Keyboard, both themes, 390 px, colour never the only signal.
- [ ] Tests: each status from fixture combos; never *outdated* without a
      report; feature-specific *required*; copy command holds no secret;
      classic untouched. Screenshots light + dark, desktop + 390 px, per
      status, in `.polly/evidence/LAI-1063/`.

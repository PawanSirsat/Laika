---
id: LAI-1076
title: 'Developer access V3 is the default: LAIKA_DEVELOPER_ACCESS defaults to v3, and the web falls back to v3'
area: server
assignee: polly
priority: p1
depends-on: []
started: 2026-11-02T00:00:00Z
discovered-from: LAI-1075
status: in-progress
---

Owner decision, 2026-11-02: Developer access V3 becomes the default **in
code**. Dispatched by the owner through Polly as one PR spanning the server
env parsing, the web fallback and the docs (named files below, D-033).

## Scope (named files)

- `server/src/env.ts`, `server/src/app.ts` — the default of
  `LAIKA_DEVELOPER_ACCESS`.
- `server/web/src/api/developer-compat.ts` — the fallback when the
  compatibility answer is unreadable, fails or times out.
- The tests that pin the default, in `server/test/` and `server/web/test/`.
- `docs/SPEC.md` §11.7 — the `LAIKA_DEVELOPER_ACCESS` row only.
- `docs/acceptance/LAI-1075-developer-access-v3-handoff.md` — its rollout
  section.
- `docs/AGENTS-ROLLOUT.md`, only if it names the flag.

The classic screens stay: deleting them is a later cleanup once V3 has run in
production.

## Acceptance criteria

- [ ] `readEnv` with `LAIKA_DEVELOPER_ACCESS` unset or empty gives `v3`;
      `classic`, `preview` and `v3` are still accepted; anything else still
      fails boot naming the variable and the three values.
- [ ] `createApp` with no `developerAccess` serves `v3` in
      `features.developer_access`.
- [ ] The web reads an unreadable, failed or timed-out compatibility answer
      as `v3`.
- [ ] The tests that pinned `classic` as the default now pin `v3`, and each
      explicit `classic`/`preview` case still passes.
- [ ] SPEC §11.7's row says the default is `v3` and that `classic` is the
      rollback.
- [ ] The handoff doc's rollout says rollback is
      `LAIKA_DEVELOPER_ACCESS=classic` and a restart.
- [ ] The PR notes that device pairing needs `LAIKA_PUBLIC_URL`, and what the
      deploy would need to supply it.

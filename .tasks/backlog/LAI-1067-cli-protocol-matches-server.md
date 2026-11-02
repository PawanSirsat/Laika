---
id: LAI-1067
title: 'Nothing fails when the server moves PROTOCOL.current and cli/src/protocol.ts stays behind'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-1062, LAI-1064]
discovered-from: LAI-1064
status: backlog
---

LAI-1062 moved `server/src/services/developer-compat.ts`'s `PROTOCOL.current`
to 2 and LAI-1064 moved `cli/src/protocol.ts`'s `PROTOCOL` to match, but only
because someone noticed: no test ties the two. Had LAI-1064 not been filed, a
board at protocol 2 would have made `laika doctor` report *"Update required
for device_pairing, tool_setup_exchange, client_reports"* on the newest
checkout. The next bump will leave the CLI behind silently again.

## Acceptance

- [ ] A test in `cli/test/` imports the server's `developer-compat.ts` by
      path (as `device-pair-tool-add.test.ts` already imports
      `server/src/auth/device-signature.ts`) and asserts the CLI's `PROTOCOL`
      equals the server's `PROTOCOL.current` — values from both sides, never a
      literal number.
- [ ] It also asserts the import is the real module (e.g. `PROTOCOL.current`
      is a number and `compatibility` is a function), so a wrong path cannot
      pass it.
- [ ] Mutation: bump either side alone and that test goes red; restore and
      it is green.
- [ ] cli typecheck, eslint and prettier exit 0; PR into `master`, CI green.

## Notes

- Start only once LAI-1062 and LAI-1064 are both on `master` (they merge
  together, #216 + #219); before that the two numbers disagree on `master`.
- `cli/`'s tsconfig stops at its own root, so the import is a dynamic
  `import(pathToFileURL(...))`, typed by a local interface.

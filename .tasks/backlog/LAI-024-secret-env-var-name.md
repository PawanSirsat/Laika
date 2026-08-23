---
id: LAI-024
title: Settle the server secret's name — SERVER_SECRET or LAIKA_SECRET
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-008
status: backlog
---

## Goal

Two names exist for one value and neither is wrong yet, because nothing reads it.

- **SPEC §11.7** calls it `SERVER_SECRET`, auto-generated to `$DATA_DIR/secret`
  on first boot.
- **LAI-008** names `LAIKA_SECRET` twice in its acceptance criteria, and
  `docker-compose.yml` now sets that.
- `server/src/env.ts` reads **neither**, and says so explicitly: the variables
  arrive with the tasks that need them (LAI-005 and later).

The container currently accepts either and exports both, so whichever LAI-005
reaches for will be present. That is a deliberate bridge, not a design — two
spellings for one secret is the kind of thing that produces a support thread
about why the value "isn't being picked up".

Note the same fork was already resolved once in the other direction:
`env.ts` accepts `LAIKA_DB_PATH` (LAI-008's name) *and* `DATA_DIR` (SPEC's),
with the Laika-prefixed one taking precedence. Whatever is chosen here should
match that precedent rather than contradict it.

## Acceptance criteria

- [ ] One name is chosen and `docs/SPEC.md` §11.7 states it.
- [ ] If the choice is not `SERVER_SECRET`, SPEC §12 is updated too — it refers
      to "a key derived from `SERVER_SECRET`".
- [ ] Whether the other spelling stays a supported alias is stated explicitly,
      not left implied.
- [ ] Follow-up tasks are filed for the places that need to change: `area: server`
      for `env.ts` when LAI-005 reads it, `area: docker` for the entrypoint,
      compose and `docker/README.md`.

## Notes / context

Found while writing `docker/entrypoint.sh` for LAI-008, which has to refuse to
start without the secret and therefore has to know what it is called.

Nothing is blocked. The bridge in the entrypoint means either spelling works
today, and the code that will actually consume the value does not exist yet.

Documentation only — no code and no dependencies.

---
id: LAI-202
title: Settle the server secret's name — SERVER_SECRET or LAIKA_SECRET
area: docs
assignee: pm
priority: p3
depends-on: []
discovered-from: LAI-008
status: done
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

---

## PM note — 2026-08-24

**This task absorbed LAI-027**, which I filed five minutes later about the same
thing. Yours was first and survives; mine is closed in `done/`.

Carrying its recommendation across so it is not lost: prefer **`LAIKA_SECRET`**,
for consistency with `LAIKA_DB_PATH` and because an unprefixed `SERVER_SECRET` in
a shared compose file or systemd unit collides with whatever else is on the box.

The counter-argument, which should be weighed rather than ignored: SPEC §11.7
also lists `PORT`, `DATA_DIR` and `PUBLIC_URL` unprefixed, so the prefix is not
currently a rule. **Whichever way this goes, apply it to all five variables or
none** — a half-prefixed env surface is worse than either consistent choice.

`area: docs`, so this is PM's to land. The mismatch is mine: I wrote §11.7 with
one name and LAI-008/LAI-009 with the other.

## Added by PM — 2026-08-24: state the minimum length in SPEC §12

LAI-024 shipped a check refusing to start when `SERVER_SECRET` is shorter than 32
characters, with the value redacted from the error. Nothing asked for it.

SPEC §12 says the AES-256-GCM key is *derived from* `SERVER_SECRET` but names no
floor, so today the guarantee exists only because one builder was careful — and a
later refactor could remove it without failing anything.

- [ ] SPEC §12 states the minimum length and that a shorter value is a hard
      startup failure, not a warning.
- [ ] The error redacts the value. Verified in LAI-024; keep it that way.

## Added by PM — 2026-08-24: `LAIKA_PUBLIC_DIR` is undocumented

LAI-204 added `LAIKA_PUBLIC_DIR` (overrides where the built SPA is served from,
defaults to `server/public`). SPEC §11.7 does not list it.

- [ ] §11.7 documents `LAIKA_PUBLIC_DIR`, including that it is primarily a test
      and packaging affordance rather than something a deployment normally sets.
- [ ] While there: the table is the deployment contract, so anything the server
      reads from the environment belongs in it. Check `server/src/env.ts` against
      §11.7 and reconcile in **both** directions.

Note it uses the `LAIKA_` prefix, as does `LAIKA_DB_PATH`. That is now three
prefixed variables against four unprefixed ones in §11.7 — evidence for settling
the naming question above rather than letting the split widen further.

---

## Closed — PM, 2026-08-24

**Settled by D-018, in the same edit as LAI-102.** The two could not be separated:
§11.7's table cannot be written without knowing what the variables are called.

**Answer: `LAIKA_SECRET`, and the rule generalises.** Anything Laika-specific
carries the prefix; `PORT`, `HOST` and `NODE_ENV` do not, because they are
universal conventions. So `DATA_DIR` → `LAIKA_DATA_DIR`, `PUBLIC_URL` →
`LAIKA_PUBLIC_URL`, `DISABLE_INVITE_ONLY` → `LAIKA_DISABLE_INVITE_ONLY`.

Your task insisted on "all five variables or none", and that constraint is what
produced a rule rather than a one-off. The rationale that decided it is collision
safety, not tidiness: `DATA_DIR` and `SERVER_SECRET` are generic enough to
already mean something else in a shared compose file or systemd unit.

`LAIKA_PUBLIC_DIR`'s missing documentation, also folded in here, is now in §11.7 —
along with a statement that the table **is** the deployment contract, since it had
drifted in both directions.

Implementation: **LAI-032** (server) and **LAI-033** (docker), both p1.

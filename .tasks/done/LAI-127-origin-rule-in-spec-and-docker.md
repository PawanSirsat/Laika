---
id: LAI-127
title: The origin rule and LAIKA_PUBLIC_URL's real requirement are undocumented
area: docker
assignee: builder-b
priority: p2
depends-on: [LAI-090]
discovered-from: LAI-090
status: done
started: 2026-08-25T06:11:14Z
finished: 2026-08-25T06:35:19Z
reviewed: 2026-08-26T10:00:00+05:30
---

## Goal

LAI-090 fixed the code. Three of its acceptance criteria land in files
Builder-A may not edit, so they travel here.

**D-018 already makes `LAIKA_PUBLIC_URL` required. Nothing says it must equal the
address people actually type**, and that gap is what cost the owner a session.

## Acceptance criteria

- [x] **`docs/DECISIONS.md` records the loopback decision** — folded into §6.1's prose, which is where a reader looks for it. The reasoning is Builder-A's, adopted verbatim.
      The decision as built: `localhost`, `127.0.0.1` and `::1` are trusted
      together when the configured URL is one of them. The reasoning, which
      should survive into the entry:
      - the origin check is a **CSRF** defence — it stops a page on another
        *site* driving this API with the user's cookie. A page served from
        `http://127.0.0.1:3000` is served by **this instance**; nobody else can
        bind that port on that machine. An attacker who can serve from the
        operator's loopback already runs code on the box.
      - the failure mode was severe and silent: locked out of your own instance,
        with the message pointing at your password.
      - it deliberately does **not** widen to LAN addresses, hostnames or proxy
        origins, and adds nothing when the configured URL is a real hostname.
- [x] **SPEC §6.1 states the origin rule** and what a mismatch returns (AC5):
      `403`, code `forbidden`, `details.reason = "origin_mismatch"` carrying
      `configured_url` and `origin`. Worth stating alongside it that **only
      `/api/v1/auth/*` is origin-checked** — the REST routes and the SSE stream
      are not, and their CSRF story is the `SameSite=Lax` cookie. A proxy that
      rewrites `Origin` therefore breaks sign-in and nothing else, which is worth
      a reader knowing before they debug the wrong thing.
- [x] **`docker/README.md` says what `LAIKA_PUBLIC_URL` must match** and what
      breaks if it does not (AC6). `docker/` is **Builder-B's**, so this
      criterion may need to travel again — split it if that is cleaner.

## Notes / context

There is a fourth thing worth writing down somewhere, and I do not think it
belongs in the spec: **better-auth disables its origin check under
`NODE_ENV=test`**.

```js
skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
  ? options.advanced.disableOriginCheck
  : isTest() ? true : false
```

The suite therefore ran with a weaker security posture than production, and **no
test at any level could have caught this bug** — every request was accepted
regardless of `Origin`. LAI-090 pins `disableOriginCheck: false` so the posture is
identical everywhere. If `docs/CONVENTIONS.md` grows a "things the test
environment must not weaken" note, that is the first entry.

## Reassigned — PM, 2026-08-25

**The two docs halves are done; the `docker/README.md` half is not mine to
write.** `docker/` belongs to Builder-B (CLAUDE.md §1), so this task is
reassigned to that area with only its last criterion outstanding.

§6.1 now carries the whole rule — which paths are checked, why loopback
spellings are one host, what a mismatch returns, and the three distinguishable
outcomes. **Lift the constraint from there rather than restating it**: the README
needs to say what `LAIKA_PUBLIC_URL` must match and what breaks if it does not,
which is one paragraph pointing at §6.1, not a second copy that can drift.

---

## The last criterion (builder-b, 2026-08-25T06:35:19Z)

`docker/README.md` gains **It must match the address people actually type**, and
the `LAIKA_PUBLIC_URL` table row now says sign-in is checked against it rather
than only describing the value.

**Lifted from §6.1, not restated.** Per the reassignment note, the section gives
the operational consequence — configure one address, open the board at another,
sign-in is refused while everything else keeps working — and links to
[SPEC §6.1] for the rule itself. It says so out loud, because the reason matters
more than the link: *two statements of one rule drift, and the one in the README
is the one nobody updates.*

## Verified against a running instance rather than transcribed

The instance is configured `LAIKA_PUBLIC_URL=http://localhost:3370`:

| Request | Result |
| --- | --- |
| right credentials, `Origin: http://127.0.0.1:3370` | **200** — the loopback spellings really are one host (LAI-090) |
| right credentials, `Origin: https://evil.example.com` | **403** `forbidden` |

The `403` body carries exactly what §6.1 promises — `reason:
"origin_mismatch"`, `configured_url`, `origin` — and a message naming both
addresses and both remedies. **The README quotes that message in the form the
server actually sends**, with a plausible deployment URL substituted for my dev
port, so an operator can match what they are looking at against what is written.

I checked the behaviour before describing it because the whole failure this task
documents is someone believing a plausible description of a system that does
something else.

## Also confirmed while in the file

`NODE_ENV=production` is set in **both** `Dockerfile` and `docker-compose.yml`.
That matters more than it looks: better-auth's rate limiting is production-only
(LAI-096's measured table, and LAI-220 today), so the shipped image does **not**
have the gap a bare `docker run` without it would. Nothing to change; worth
knowing it was checked.

## Not done, deliberately

The task's Notes suggest `docs/CONVENTIONS.md` could grow a *"things the test
environment must not weaken"* note, with better-auth's `skipOriginCheck` as its
first entry. `docs/` is PM's (CLAUDE.md §1) and it is not a criterion here, so it
stays a suggestion. It is a good one — the same environment-gated blind spot
produced LAI-220 today, where a bug was **unreachable by every way we normally
check** because the behaviour only exists under `NODE_ENV=production`.

## Review — PM, 2026-08-26

**Accepted.** `docker/README.md` now says what `LAIKA_PUBLIC_URL` must match and
what breaks when it does not — pointing at §6.1 rather than restating it, so the
two cannot drift.

This is the one that would have saved the owner an hour: they opened their own
instance on `127.0.0.1`, were told their password was wrong, and had no way to
know the two were connected.

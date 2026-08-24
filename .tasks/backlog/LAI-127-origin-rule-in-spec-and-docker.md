---
id: LAI-127
title: The origin rule and LAIKA_PUBLIC_URL's real requirement are undocumented
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-090]
discovered-from: LAI-090
status: backlog
---

## Goal

LAI-090 fixed the code. Three of its acceptance criteria land in files
Builder-A may not edit, so they travel here.

**D-018 already makes `LAIKA_PUBLIC_URL` required. Nothing says it must equal the
address people actually type**, and that gap is what cost the owner a session.

## Acceptance criteria

- [ ] **`docs/DECISIONS.md` records the loopback decision** (LAI-090 AC2).
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
- [ ] **SPEC §6.1 states the origin rule** and what a mismatch returns (AC5):
      `403`, code `forbidden`, `details.reason = "origin_mismatch"` carrying
      `configured_url` and `origin`. Worth stating alongside it that **only
      `/api/v1/auth/*` is origin-checked** — the REST routes and the SSE stream
      are not, and their CSRF story is the `SameSite=Lax` cookie. A proxy that
      rewrites `Origin` therefore breaks sign-in and nothing else, which is worth
      a reader knowing before they debug the wrong thing.
- [ ] **`docker/README.md` says what `LAIKA_PUBLIC_URL` must match** and what
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

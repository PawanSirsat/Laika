---
id: LAI-103
title: Re-verify the CSP against the built SPA once it exists
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-023]
discovered-from: LAI-023
status: done
finished: 2026-08-24T05:01:57+05:30
reviewed: 2026-08-24T05:20:00+05:30
started: 2026-08-24T04:52:14+05:30
---

## Goal

LAI-023 shipped a Content-Security-Policy with `script-src 'self'` and no
`'unsafe-inline'`. It was verified against the only document the server serves
today — the committed fallback page — because no SPA build existed. Vite's output
is what the policy has to survive in production, and nobody has checked it against
that.

A CSP that breaks the app is discovered by a blank screen, usually after deploy.

## Acceptance criteria

- [x] The built SPA loads with **no CSP violations** in the browser console —
      checked against a real `pnpm build` output, not asserted.
- [x] `script-src` still carries no `'unsafe-inline'` and no `'unsafe-eval'`.
      If Vite's output needs either, say precisely which chunk and why, and use
      hashes or a nonce instead.
- [x] `style-src`'s `'unsafe-inline'` allowance is either justified against the
      real output or removed — it exists today only for the fallback page's
      `<style>` block.
- [x] `connect-src 'self'` still covers the SSE stream (§11.5) and every fetch
      the SPA makes.
- [x] A test or a documented manual check that will catch a future regression,
      rather than a one-off inspection.

## Notes / context

Filed from LAI-023, whose AC3 asked for exactly this verification and could not
get it: the SPA does not exist, and under D-016 `server/web/` is Builder-B's, so
this is not Builder-A's to finish.

The policy lives in `server/src/http/middleware/security-headers.ts` as
`CONTENT_SECURITY_POLICY`, which is Builder-A's file — so if the policy itself
needs changing, that half is a `area: server` task and this one should say what to
change and why rather than editing it.

Vite's dev server and its production build differ here: dev injects inline
scripts for HMR, production generally does not. Check the **built** output, and
note whether `pnpm dev` needs a relaxed policy — if it does, that is a
development-only branch and should be visibly marked as such.

No new dependencies.

---

## Implementation notes for review (Builder-B)

Checked against a real `pnpm build`, served by the real server, loaded in a real
browser. Nothing here is asserted from reading the bundle.

### AC1 — no CSP violations against the built SPA

Built the SPA, served `server/public/` through `node dist/index.js` in
`NODE_ENV=production` (which does send the policy — confirmed on both the
document and a JS asset), and loaded it under Playwright.

**Console: 0 errors, 0 warnings.** The page rendered — heading and both
paragraphs present in the accessibility snapshot — so the module script executed
under `script-src 'self'` rather than being blocked into a blank page.

### AC2 — `script-src` needs neither `'unsafe-inline'` nor `'unsafe-eval'`

The built `index.html` contains **0** inline `<script>` blocks, **0** inline
`on*` handlers and **0** inline `<style>` blocks; the emitted JavaScript
contains **0** occurrences of `eval(` or `new Function(`. Nothing to hash and no
nonce needed.

### AC3 — `style-src 'unsafe-inline'` is not needed by the SPA

Served the same build with the directive tightened to `style-src 'self'`. The
page rendered fully, console clean apart from a `404 /favicon.ico` (a missing
file, not a CSP violation — see below).

So the allowance is now carried entirely by `fallback.html`'s single `<style>`
block, and that does not need it either. Computed the hash and **verified it**:

```
style-src 'self' 'sha256-SvAMs7ooQNphe1Tc5XfBY/P1X9abH8eLukft4pFWmDE='
```

Served the fallback under exactly that policy — 0 console errors, and
`getComputedStyle(document.body)` returned the stylesheet's own values
(`background rgb(251, 251, 250)`, the custom font stack, `margin 0`) rather than
browser defaults, which is what distinguishes "applied" from "tag present but
dropped".

The policy file is Builder-A's, so this task says what to change rather than
changing it → **LAI-205** filed, carrying the verified hash and a recommendation
to compute it at boot from `FALLBACK_DOCUMENT` instead of pasting a literal that
silently stops matching when the file is edited.

### AC4 — `connect-src 'self'` covers what the SPA does

Exercised from the page, with a negative control so the result is not vacuous:

| Call | Result |
| --- | --- |
| `fetch('/api/v1/health')` | **200** — allowed |
| `new EventSource('/api/v1/events')` | **404** from the server, *not* a CSP block — the browser was permitted to connect; the endpoint does not exist yet |
| `fetch('https://example.com/')` | **blocked**, with an explicit `connect-src 'self'` violation in the console |

The third line is the one that matters: it proves the directive is actually
enforcing. Same-origin SSE is permitted; the endpoint arrives with §11.5.

### AC5 — regression guard

`server/web/test/csp-compatibility.test.ts`, wired into `pnpm test` via the
package's `test` script. Six cases across the three directives that constrain
this package.

Two things worth noting about how it is built:

- **Zero new dependencies.** Node 22.18 runs TypeScript natively, so it uses
  `node:test` and Vite's programmatic `build()` — both already present. The task
  said no new dependencies.
- **It builds its own output into a temp directory** rather than reading
  `server/public/`. Reading gitignored build output is exactly the failure I
  filed as LAI-204 an hour earlier — green in CI, red for anyone who has run
  `pnpm build`. This one cannot drift that way.

**Confirmed it can fail.** Injected an inline `<script>`, an `on*` handler, an
inline `<style>` and a `https://fonts.gstatic.com` font URL: 4 of 6 cases went
red, naming each problem. Restored: 6/6 green. A guard that cannot fail is
decoration.

### The dev-server question the task raised

`pnpm dev` needs **no** relaxed policy, and none should be added.

Vite does inject an inline React Refresh script in development — confirmed, one
inline `<script>` block in the dev document. But that document is served by
**Vite**, which sends no CSP header at all (verified). Only proxied `/api`
responses carry the policy, and a header on a JSON response does not govern the
HTML document. There is no dev/prod CSP divergence to mark.

### Also fixed / noted

- Documented the contract in a new `server/web/README.md` — the directives that
  constrain this package, why the test builds its own output, and the dev-server
  finding — so the next person does not re-derive it.
- **`/favicon.ico` 404s.** Surfaced by the strict-CSP run; not a CSP issue and
  not in this task's criteria. It belongs with the app shell (LAI-019) rather
  than a task of its own, and is noted in my log.
- The server now refuses to boot in production without `SERVER_SECRET`
  (LAI-027 resolved to the SPEC §11.7 name). That makes the alias bridge in
  `docker/entrypoint.sh` load-bearing rather than speculative — it exports
  `SERVER_SECRET` when only `LAIKA_SECRET` is set, so the compose file from
  LAI-008 still boots. No change needed; recording that it was checked.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`pnpm test`: `@laika/web` 6/6; server 265 passed, 1 failed — the pre-existing
LAI-204 failure in Builder-A's area, unrelated to this task.

## Review — PM, 2026-08-24

**Accepted.** 6 tests, 3 suites, all passing — and they run from the root
`pnpm test`, so `@laika/web` is now in the gate rather than beside it.

**This discharges LAI-023's AC3**, which I deferred as unmeetable because the SPA
did not exist. It is now met the way the criterion actually asked: *verified
against the built SPA, not asserted*. The checks map one-to-one onto the policy —
no inline `<script>` and no inline `on*` handlers for `script-src 'self'`, no
`eval`/`new Function` for the absent `unsafe-eval`, no external origin, and fonts
from our own assets.

**`node --test` instead of adding vitest** was the right call. LAI-103 named no
dependencies, and Node's built-in runner needs none — reaching for a devDependency
here would have needed a task that says so.

### You corrected me, and the correction should be on the record

In the LAI-023 review I wrote that keeping `style-src 'unsafe-inline'` was
"honest — Vite emits inline styles and pretending otherwise would mean a policy
that has to be loosened later". **That was an assumption about Vite in general,
not a fact about this build.** LAI-205 shows the built output contains no
`<style>` block at all, verified by serving it under `style-src 'self'` in a real
browser with zero violations.

So I accepted a looser security policy than the evidence required, on a general
belief, in the same review where I praised deferring the question until the
evidence existed. The right move would have been to say the allowance was
*unverified* rather than *honest*.

**LAI-205 raised to p1.** It is a security tightening that is already proven
safe, it is small, and a `csp-compatibility` test now fails if the SPA ever
regresses into needing the allowance back — so the risk of tightening is bounded.

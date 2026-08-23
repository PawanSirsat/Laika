---
id: LAI-103
title: Re-verify the CSP against the built SPA once it exists
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-023]
discovered-from: LAI-023
status: in-progress
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

- [ ] The built SPA loads with **no CSP violations** in the browser console —
      checked against a real `pnpm build` output, not asserted.
- [ ] `script-src` still carries no `'unsafe-inline'` and no `'unsafe-eval'`.
      If Vite's output needs either, say precisely which chunk and why, and use
      hashes or a nonce instead.
- [ ] `style-src`'s `'unsafe-inline'` allowance is either justified against the
      real output or removed — it exists today only for the fallback page's
      `<style>` block.
- [ ] `connect-src 'self'` still covers the SSE stream (§11.5) and every fetch
      the SPA makes.
- [ ] A test or a documented manual check that will catch a future regression,
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

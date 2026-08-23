---
id: LAI-205
title: Drop 'unsafe-inline' from style-src — the SPA does not need it
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-103
status: backlog
---

## Goal

`CONTENT_SECURITY_POLICY` in `server/src/http/middleware/security-headers.ts`
carries `style-src 'self' 'unsafe-inline'`. Its own comment says the allowance
exists for the committed fallback document (LAI-016) and should tighten "when
the real SPA lands … it is not something to guess at before Vite's output
exists."

Vite's output now exists, and LAI-103 checked it. **The SPA does not need the
allowance.** Verified by serving the real `pnpm build` output with
`style-src 'self'` and loading it in a browser: the page rendered fully with
zero CSP violations. The built `index.html` contains no `<style>` block, no
inline `on*` handler and no inline `<script>`; `server/web` now has a test
(`test/csp-compatibility.test.ts`) that fails if any of that changes.

So the only thing still requiring `'unsafe-inline'` is `fallback.html`'s single
`<style>` block — and that does not need it either.

## What to change, and why

`'unsafe-inline'` on `style-src` is not harmless. It re-enables the injection
class that CSP exists to stop for styles: exfiltration via attribute selectors
and `background: url(...)`, and UI redressing by restyling the page. Keeping it
for one static document is a poor trade once that document can be hashed.

**Verified working:** `style-src 'self' 'sha256-SvAMs7ooQNphe1Tc5XfBY/P1X9abH8eLukft4pFWmDE='`

Served `fallback.html` under exactly that policy: zero console errors, and
`getComputedStyle(document.body)` returned the stylesheet's own values
(`background rgb(251, 251, 250)`, the custom font stack, `margin 0`) rather than
browser defaults — so the block was applied, not dropped.

**Prefer computing the hash at boot over pasting the literal.** A hardcoded hash
silently stops matching the moment someone edits `fallback.html`, and the
symptom is an unstyled fallback page that nobody looks at until a deploy goes
wrong. The server already resolves `FALLBACK_DOCUMENT` (`src/paths.ts`) and can
read it once at startup, extract the `<style>` contents, and build the directive
— which cannot drift by construction.

If the literal is used instead, a test must assert the hash matches the current
file, or this becomes a latent breakage.

## Acceptance criteria

- [ ] `style-src` no longer contains `'unsafe-inline'`.
- [ ] The fallback document still renders **styled** — asserted on a computed
      style the stylesheet sets, not on the `<style>` tag being present in the
      DOM. A dropped block leaves the tag and removes the effect.
- [ ] The built SPA still loads with no CSP violations.
- [ ] The hash cannot silently drift from `fallback.html`: either computed at
      boot, or a test fails when the file changes.

## Notes / context

Found completing LAI-103, whose AC3 asked for exactly this call. The policy file
is Builder-A's under D-016, so LAI-103 says what to change and why rather than
changing it.

`script-src` needs no work — it already has neither `'unsafe-inline'` nor
`'unsafe-eval'`, and the build contains no `eval` or `new Function`.

No new dependencies.

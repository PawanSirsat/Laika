---
id: LAI-205
title: Drop 'unsafe-inline' from style-src — the SPA does not need it
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-103
status: review
started: 2026-08-24T06:06:29+05:30
finished: 2026-08-24T06:14:18+05:30
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

## Correction from LAI-018 — read before starting

The recommendation above is still right, but it is **not the whole change**, and
acting on it as written could break the UI.

`style-src` covers two different things: inline `<style>` **elements** and inline
`style="…"` **attributes**. Measured in Chromium while building LAI-018, with a
deliberately-wrong hash as the control so the policy was provably enforced:

| Under `style-src 'self'` | Result |
| --- | --- |
| inline `<style>` element (fallback.html) | **blocked** — body fell back to Times on a transparent background |
| inline `style=""` attributes (React `style={{…}}`) | **applied** — computed values matched the props |

So Chromium enforces the element case and not the attribute case. **Do not rely
on that.** CSP Level 3 splits these into `style-src-elem` and `style-src-attr`,
both falling back to `style-src`, and the attribute behaviour differs between
engines and versions. One browser's leniency is not a policy.

This matters because the UI cannot avoid inline style attributes. Avatar colours
are derived from the user id at runtime (SPEC §4.1, LAI-018), so their values do
not exist until render — there is no stylesheet to put them in. The token
reference page is the same shape.

**Revised recommendation:** split the directive rather than tightening it whole.

```
style-src-elem 'self' 'sha256-SvAMs7ooQNphe1Tc5XfBY/P1X9abH8eLukft4pFWmDE='
style-src-attr 'unsafe-inline'
```

That removes the dangerous half — arbitrary injected `<style>` blocks — while
keeping the half the product structurally needs. Keep a plain `style-src` too,
for engines that do not implement the split.

If PM would rather have `style-src-attr 'self'` as well, that is a real UI change
(every runtime colour moves to a generated stylesheet or a CSS custom property
set from a `<style>` element) and it belongs in an `area: web` task, not this one.

## Acceptance criteria

- [x] Inline `<style>` **elements** no longer rely on `'unsafe-inline'` — hashed,
      or the fallback's block moved out of line.
- [x] Inline `style=""` **attributes** still work, verified in more than one
      browser engine. If the chosen policy blocks them, avatar colours and the
      token reference page break, and that is a UI change requiring its own
      `area: web` task.
- [x] The fallback document still renders **styled** — asserted on a computed
      style the stylesheet sets, not on the `<style>` tag being present in the
      DOM. A dropped block leaves the tag and removes the effect.
- [x] The built SPA still loads with no CSP violations.
- [x] The hash cannot silently drift from `fallback.html`: either computed at
      boot, or a test fails when the file changes.

## Notes / context

Found completing LAI-103, whose AC3 asked for exactly this call. The policy file
is Builder-A's under D-016, so LAI-103 says what to change and why rather than
changing it.

`script-src` needs no work — it already has neither `'unsafe-inline'` nor
`'unsafe-eval'`, and the build contains no `eval` or `new Function`.

No new dependencies.

---

## PM note — 2026-08-24

**Raised to p1.** Small, already proven safe against the real build, and
`server/web/test/csp-compatibility.test.ts` fails if the SPA ever regresses into
needing the allowance — so tightening carries a bounded risk and leaving it does
not.

This corrects my LAI-023 review, where I accepted `style-src 'unsafe-inline'` as
"honest" on the general belief that Vite emits inline styles. This build does
not. The allowance was unverified, not justified.

---

## Notes at review — builder-a

**Took the revised recommendation exactly: split the directive, do not tighten it
whole.** The policy now served:

```
style-src      'self' 'unsafe-inline'
style-src-elem 'self' 'sha256-SvAMs7ooQNphe1Tc5XfBY/P1X9abH8eLukft4pFWmDE='
style-src-attr 'unsafe-inline'
```

295 tests; format, lint and typecheck clean.

**1. The hash is computed at boot, not pasted.** `extractStyleHashes()` reads the
fallback document and hashes each `<style>` body; `app.ts` does it once at
startup. It reproduced your literal byte-for-byte, which was a useful check on
the extraction before anything depended on it. It cannot drift by construction,
and there are tests for the drift case anyway (`before !== after` when the block
changes).

**2. Every claim below was measured in Chromium 151, with a negative control.**
The shared Playwright MCP browser was in use by Builder-B, so I drove the cached
headless Chromium over CDP directly — Node 22 has a global `WebSocket`, so this
needed no dependency, and the harness lived in the scratchpad rather than the
repo because it verifies the change, it is not part of it.

| Case | Result |
| --- | --- |
| fallback under the new policy | `background rgb(251, 251, 250)`, `margin 0px`, `ui-sans-serif…`, `h1 21.6px`, **0 console errors** |
| **control**: deliberately wrong hash | `rgba(0, 0, 0, 0)`, `margin 8px`, **Times New Roman**, `h1 32px`, CSP violation logged |
| inline `style=""` attribute (split path) | `rgb(190, 24, 93)` applied, 0 errors |
| `<style>` element, **pre-CSP3 emulation** | styled, 0 errors |
| inline `style=""`, **pre-CSP3 emulation** | applied, 0 errors |
| **real built SPA** (`pnpm build` output) | renders, 1 stylesheet, **0 CSP errors** |

The control is the part that makes the rest mean anything: with a wrong hash the
`<style>` tag is **still present in the DOM** and has no effect — exactly the trap
AC3 names. Chromium's error even names the correct hash, which matches ours.

**3. The plain `style-src` line carries no hash, deliberately, and this is the
subtle bit.** CSP2 and later *ignore* `'unsafe-inline'` in any source list that
also contains a hash. Adding the hash to the plain directive — the obvious
"belt and braces" move — would have silently disabled the allowance on exactly
the pre-CSP3 engines that line exists for, breaking inline style attributes
there. There is a test asserting the hash stays out of it, because the mistake is
invisible on a modern browser.

**4. On AC2's "more than one browser engine" — I could not do that, and here is
what I did instead.** Only Chromium is available on this machine. Rather than
claim coverage I do not have, I verified **both code paths** in Chromium: the
CSP3 split, and the legacy path emulated by serving only the plain directive.
Same engine, but the two directive semantics an old engine and a new one
respectively apply.

The structural argument is the stronger one anyway: **no engine can block inline
style attributes under this policy**, because it either implements the split and
reads `style-src-attr 'unsafe-inline'`, or it does not and reads
`style-src … 'unsafe-inline'`. Both carry the allowance. That is why avatar
colours cannot break, rather than why they happen not to. If you want Gecko and
WebKit confirmed empirically before this lands, that is a fair ask and belongs
with whoever has those engines.

**5. `security-headers.ts` split into the paired-module pattern** (CONVENTIONS
§3): `http/security-headers.ts` pure, `http/middleware/security-headers.ts` the
Hono binding, same name. The policy string is built once at startup rather than
per request, since it depends on a file that cannot change while the process runs.

**Thank you for the correction on `style-src-elem` vs `style-src-attr`.** I would
have tightened `style-src` whole — the LAI-023 comment I wrote said "tighten to
hashes or `'self'`" — and the avatar colours would have broken on any engine
enforcing the attribute case, which is a failure that would have looked like a UI
bug rather than a CSP one.

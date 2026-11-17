---
id: LAI-1309
title: 'Small fixes: the two tests that keep master red, the CSP style hash read from an HTML comment, and a comment still naming Netlify'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1306
status: in-progress
started: 2026-11-17T13:48:38Z
---

## Goal

Owner, 2026-11-17: "yes start the small pr". Three defects found while releasing #350, attachments
and the Ksage split, fixed together because each is small and two of them cost a release every
time they fire.

## Acceptance criteria

- [ ] `server/web/test/browser/availability.test.ts:107` ("the pill says it in words and a glyph;
      Save sends one PUT of the edit") waits for the availability read to land before it reads the
      pill. It read "Reading your availability…" on master runs 44073558010, 44082070357 and
      44092507851. The wait is on the condition the assertion needs (the pill's loaded text, or
      the read's response), not a sleep, and the assertion itself is unchanged.
- [ ] `server/web/test/browser/slim-list.test.ts` "while the read is slow the description holds its
      place, and nothing moves when it lands" (LAI-795) no longer catches the web fonts settling as
      a layout shift (it saw the title move 0.87 px on master run 44082070357). Wait for
      `document.fonts.ready` (or the fonts the panel uses) before the first measurement; do **not**
      add a tolerance, which would let a real shift through.
- [ ] `extractStyleHashes` in `server/src/http/security-headers.ts` ignores HTML comments, so the
      server's CSP stops carrying `'sha256-SvAMs7oo…'` for a `<style>` that exists only in a
      comment of `index.html`. A test with a comment mentioning `<style>` and `</style>` proves it,
      and a real `<style>` element is still hashed. The web-serve drift guard (LAI-1308) still
      passes: the server's CSP for the built `index.html` now equals the nginx one exactly.
- [ ] `server/src/services/attachments.ts` ~line 547: the comment saying Ksage's SPA is on
      Netlify is corrected (Ksage now serves SPA and API on one domain; the any-origin match stays
      justified because a deployment can still be reached at more than one address, e.g. during a
      domain move). Comment only; behaviour unchanged.
- [ ] Each fixed test is shown to fail when its fix is reverted (the CSP test), or to have failed
      for the stated reason (the two browser tests: quote the CI log line).
- [ ] CI gate green on the PR: test, lint, format each exit 0.

## Notes / context

- This branch also carries CHIEF's accept of LAI-1300, LAI-1301, LAI-1306 and LAI-1308, and PR #356's
  two record files (LAI-1308's task and log). Merging this PR merges #356.
- The other flaky tests (agents-tab, review-dialog, setup before `try` hanging a shard) stay in
  LAI-1307.

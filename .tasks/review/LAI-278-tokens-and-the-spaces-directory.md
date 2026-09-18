---
id: LAI-278
title: Tokens and the Spaces directory to the design; joining a public space
area: web
assignee: shell
status: review
priority: p1
depends-on: []
discovered-from: LAI-277
started: 2026-09-18T20:40:00Z
finished: 2026-09-18T20:52:00Z
---

## Why

The last two in-app screens of the owner's page-by-page pass. Prototype lines
931–1069 (Tokens) and 1332+ (the directory).

**Tokens** had six unlabelled columns of dates and words, and neither of the two
panels the design closes with: the scope reference and the CLI quick start.

**The directory called them Projects.** The sidebar says SPACES, the tabs sit
inside a space, and this — the screen that lists them — was the last place using
the other word. And it listed public spaces with no way in: `POST
/projects/:slug/join` has been served all along with no caller (LAI-236).

## What

- Tokens: the design's column headers; a **scope reference**; a CLI quick start.
- The directory: `Spaces` throughout, and a **PUBLIC IN THIS ORG** section with
  Join, wiring `joinProject`.
- Both `NO_BROWSER_CALLER` entries — `*/metrics` in LAI-275 and `*/join` here —
  are now deleted, which is the guard proving the closures.

## Acceptance criteria

- [x] The token table has the design's headers.
- [x] The scope reference documents **Laika's** scopes, not the mockup's.
- [x] The CLI block reads its host from the address bar.
- [x] Nothing in the directory says "project" to a reader.
- [x] Public spaces the reader is not in are listed with a Join that calls the
      endpoint and re-reads the list.
- [x] `endpoint-coverage.test.ts` green with the join exemption deleted.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**The design's scope reference is fiction and was not copied.** It lists
`read:tasks`, `write:tasks`, `agent:session` and `admin:org`; `TOKEN_SCOPES` in
`db/enums.ts` has **two** — `full` and `read_only`. Documenting the mockup's four
would have described permissions that do not exist, which is the *"do not
reproduce the prototype's artifacts"* rule with a security edge on it.

**The CLI block reads `window.location.origin`.** The mockup hardcodes
`laika.kvelld.internal`; a self-hosted board is not that and must never be told
it is (§5.1).

**Membership is read from `me.memberships`, not the summary's `members`.** That
array is capped for drawing faces, so testing it would make a space you are
already in look joinable the moment it grew past the cap.

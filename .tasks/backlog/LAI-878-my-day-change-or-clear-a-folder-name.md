---
id: LAI-878
title: "My day: change or clear a block's folder name and branch before confirming"
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-866
status: backlog
---

## Goal

Before confirming, the person can rename or clear the name a block carries
for its work folder, and its branch, from My day. SPEC §13.4 already says
they can: *"The name and branch reach owners and admins only on an entry the
person confirmed, which they can change or clear before then."* Clearing or
renaming the name also takes away a project that only the name gave the
block.

## What is there today (read at `9250fc3e`)

- The Inspector shows the name and no control for it
  (`server/web/src/routes/screens/my-day/Inspector.tsx:446-457`). The server
  takes the change already: `PATCH` with `folder` and `branch`.
- `PATCH {folder: null}` clears the name and its branch and nothing else
  (`server/src/services/time-drafts.ts:827-829`, applied at `:919`). The block
  keeps the project the name matched, so that time still reaches Solidtime as
  the project's.

## The rule (CHIEF)

**Clearing or renaming the name clears a project that came from the name
match. A project the person picked themselves stays.**

## Acceptance criteria

- [ ] **Browser test, both themes (`setTheme`).** For a block with a folder
      name, the Inspector offers rename and clear for the name, and for the
      branch when there is one. Renaming and clearing reach the server and
      show at once. Fails today.
- [ ] **Server test: clearing the name.** A block under `acme` only because
      its folder is named `Acme`: after `PATCH {folder: null}` it is untied,
      with no project. Today it is still under `acme`. Run it red first.
- [ ] **Server test: renaming the name.** The same block renamed to `Other`
      is untied too.
- [ ] **Server test: a project the person picked survives.** A block whose
      project the person set with `PATCH {project}`: after
      `PATCH {folder: null}` it keeps that project.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Areas:** `web` (`server/web/src/routes/screens/my-day/`,
  `server/web/src/api/time.ts`, `server/web/test/browser/`) and `server`
  (`server/src/services/time-drafts.ts`, its tests). No new dependencies.
- **Where the project came from.** A draft does not record today whether
  its project came from the name match or from the person. Choose how to
  know (for example a column with its migration), and say here why.
- **SPEC** §6.4 *The person's hands* says what `PATCH` does. If the rule
  above changes that paragraph's meaning, stop and ask Belka on the card; no
  SPEC edit is granted here.
- Use `Acme` and `acme` in fixtures, never a real client's name.

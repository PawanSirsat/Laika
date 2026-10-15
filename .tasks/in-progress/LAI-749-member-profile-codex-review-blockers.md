---
id: LAI-749
title: 'Member profile: three blockers from the Codex review — trigger verifier, rating attempt scope, slow structural test'
area: server
assignee: chief
priority: p1
depends-on: [LAI-746]
discovered-from: LAI-746
started: 2026-10-15T09:26:28Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4), on
`build-profile-v1` after `c9a3e0f`. An independent review of
`e45a2f9...c9a3e0f` returned CHANGES REQUIRED with three blocking findings;
LAI-743 and LAI-746 are in review with frozen criteria, so the fixes are this
task. Nothing else changes.

## Acceptance criteria

- [ ] **1. The boot step verifies what a trigger does, not a substring.**
      `ensureActivityTriggers` rejects a trigger that holds the right name and
      the right message text but does not abort — for
      `member_ratings_is_append_only_no_replace` and every other append-only
      trigger it keeps. A test installs such a trigger (message text kept,
      effect removed) and must see it refused; shown red before the fix. The
      comments say what the check actually checks.
- [ ] **2. A rating attempt belongs to one member.** The key is reused only
      for the same member, score and note: failed save → close → another
      member's profile without unmounting → same score and note → a new key,
      not a `409`. A browser test drives exactly that sequence; shown red
      before the fix.
- [ ] **3. The structural privacy test reads each file once**, without a
      synchronous double walk, and stays exactly as strict; not by raising a
      timeout. Shown slow or failing before.
- [ ] Gate after the last edit: `pnpm test`, `pnpm lint`, `pnpm format` each
      exit 0 from the worktree root.

## Notes / context

- Findings: `server/src/db/migrate.ts` (~129, ~172) and
  `server/test/db/migrate.test.ts` (~542); `profile-derive.ts` (~71) and
  `ProfileScreen.tsx` (~99, ~203); `server/test/services/profiles.test.ts`
  (~623). D-055: flakes are defects.

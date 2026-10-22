---
id: LAI-872
title: 'A developer cannot find the switch that shares their local activity — it lives only in the Connect wizard''s Optional step'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner reported (2026-10-22) that developers "have no access to turn on the
activity log". By design (D-079) it takes two switches: the organisation's
Developer insights (owner/admin, Organisation → Overview) and the person's own
Share local activity (`PUT /me/activity-sharing`, every role). The personal
switch exists only inside the Connect wizard's Optional section
(`server/web/src/routes/screens/connect/ShareActivity.tsx`,
`ConnectScreen.tsx` ~965), so it is hard to find. **No policy change.**

## Acceptance criteria

- [ ] The Developer access page (`/developer`) shows a "Share local activity"
      section outside the wizard, reusing the existing `ShareActivity`
      component and its endpoints (`GET/PUT /me/activity-sharing`) — no new
      endpoint, no second implementation.
- [ ] When the organisation switch is off, the section says so in one line;
      for an owner or admin it links straight to Organisation → Overview's
      Developer insights switch; for others it names who can turn it on.
- [ ] When it is on, every signed-in role can flip their own switch there.
- [ ] The wizard keeps working as today.
- [ ] Tests for both org states and for owner vs member wording.
- [ ] Light and dark, laptop and phone. Gate: `pnpm test`, `pnpm lint`,
      `pnpm format` each exit 0.

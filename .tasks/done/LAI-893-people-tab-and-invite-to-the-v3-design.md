---
id: LAI-893
title: "Organisation: the People tab and the invite dialog as the v3 design draws them, and the header line spaced"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: done
started: 2026-10-22T16:53:09Z
finished: 2026-10-22T17:12:40Z
accepted: 2026-10-22T17:12:40Z
---

## Goal

Organisation → People as the owner's updated "Laika App v3" design: a table
of people — avatar with a presence dot, name with YOU, email, role (Owner as
text, a control for anyone else), spaces, agents, last active, Tokens and
Deactivate — under a seat line (*50 members · 6 admins · 3 pending invites*),
a search, role filters with counts, a sort, and a bar of bulk actions for the
rows ticked; a Pending filter listing the invites; and *Invite people* as a
modal: EMAILS (several, comma-separated, or none for a link), ROLE as a
segment, the expiry note, Cancel and *Create link* / *Send invite* / *Send N
invites*. The header line under the organisation's name separates the owner,
the created date and the headcount so they read as three facts.

## Acceptance criteria

- [x] The People card's seat line counts active members, admins and pending
      invites from the responses; the filters All / Owner / Admin / Member
      (and Viewer when there is one) / Pending carry counts; the search
      matches name or email; Sort cycles Last active → Name → Role; the own
      row is first and deactivated people last.
- [x] Each row: avatar with a green dot when online, name linking to the
      profile where the reader may open it, YOU and DEACTIVATED chips, email;
      Owner as text, otherwise the role dropdown for a manager; spaces and
      agents from `GET /capacity` (a dash when it is unavailable, *Presence is
      off* when presence is), last active as *Active now*, *18m ago*, *2h
      ago*, *Yesterday*, *6d ago* or *Never*; Tokens opens that person's
      tokens on Security; Deactivate asks first; Reactivate on a deactivated
      row.
- [x] Ticking rows shows a bar: *N selected*, Make Admin, Make Member,
      Deactivate (asks once), Clear — one PATCH per person, in order; the
      header box ticks every editable row shown.
- [x] Pending lists each invite with its role, who invited it and when, its
      expiry, *not emailed* when so, and Revoke; *No pending invites* when none.
- [x] *Invite people* (header button, the empty search's button) opens a
      modal: EMAILS textarea, ROLE segment, the note, Cancel and a button that
      reads *Create link* with no address, *Send invite* with one and *Send N
      invites* with more; one POST per address, or one with no address; the
      accept links shown once with Done, as before.
- [x] The header line is three spaced facts: *Owner · Name*, *Created …*,
      *N people*.
- [x] A reader who may not manage the organisation sees the table with no
      controls, no boxes and no Pending filter.
- [x] Every organisation browser test green; a new one covers the tab.
- [x] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction in the temporary worktree
  `Laika-org-people` on `LAI-893-people-tab-v3`. Files under
  `server/web/src/routes/screens/organisation/` and their tests;
  `docs/design/Laika App v3.dc.html` refreshed from the project (the People
  section changed after LAI-888's import). No new dependencies.
- Left out, with no endpoint: *Resend* and *Copy link* on a pending invite —
  the server keeps only a hash of a link.

## Record

- `server/web/src/routes/screens/organisation/PeopleTab.tsx`,
  `InviteDialog.tsx`, `people-derive.ts` are new; `use-organisation.ts`
  reads `GET /capacity` softly and keeps the screen's data while it reloads;
  `OrganisationScreen.tsx` hands the tab its state and opens the dialog;
  `organisation.css` carries the table, the bulk bar, the pending list and
  the dialog, tokens only.
- Three decisions beyond the design: an owner's row is an owner's to change
  (an admin reads *Owner* as text, as the design draws it, and is offered
  nothing — the server's §3.1 rule, mirrored); a deactivated person's role is
  text beside Reactivate; a Viewer segment appears only when someone is one.
- Two defects found by the tests and fixed: reloading the organisation
  blanked the screen to *loading*, which unmounted the invite dialog before
  its links showed — now a reload keeps what is on screen; and the dimming of
  a deactivated row reached its Reactivate button once the actions moved to
  a cell of their own.
- `organisation-roles.test.ts`: three tests re-aimed — the admin-sees-Owner
  case asserts the text and no control; the own-row case counts the two
  active others' dropdowns; the refusal case has an owner demote an admin the
  stub refuses, since an admin is no longer offered an owner.
- Left out, with no endpoint: *Resend* and *Copy link* on a pending invite.


---
id: LAI-1182
title: 'Organisation settings: the HR connection card (Clan) and the Holidays list (D-149)'
area: web
assignee: chief
priority: p1
depends-on: [LAI-1181]
status: in-progress
started: 2026-11-13T12:01:12Z
---

## Goal

The web half of D-149's connection, on the Organisation screen's Overview →
Workspace settings (`OrganisationScreen.tsx`, beside `TimeModeFact` and
`BreakScheduleFact`): an **HR system** card where an owner or admin connects
Clan, sees how syncing is going, runs it now, and maps people; and a
**Holidays** list everyone can read and owners/admins can add to.

## Acceptance criteria

- [ ] `src/api/hr.ts` mirrors LAI-1181's `HrSourceView` and holiday shapes
      (doc header "Mirrors `services/hr-sync.ts` / `routes/hr.ts`"), every
      path written out whole (`/org/hr`, `/org/hr/connect`,
      `/org/hr/connect/verify`, `/org/hr/sync`, `/org/hr/people`,
      `/org/holidays`); `view-type-drift` PAIRS for each view and nested shape
      (name nested shapes on both sides).
- [ ] **HR system card** (shown to `org.hr.configure` holders only, via
      `useGates`), modelled on `GithubWebhookSection.tsx`:
  - off: one line on what it does ("Holidays and leave from Clan, every 30
    minutes. Laika keeps the sign-in token, never the password.") and
    **Connect Clan** opening a form: company URL (placeholder
    `https://yourcompany.clan.biz`), email, password; on `pending_2fa` a code
    field and the method; errors in words (`clan_login_failed`,
    `clan_unreachable`, `two_factor_expired`).
  - connected: "Connected as {account_email} · token …{last4}, renews by
    {date}" with a warning tone ≤ 30 days; last sync "N min ago" with the
    counts (holidays, leave days, people matched N of M) or the error in words
    (`token_rejected` → "Clan refused the token — connect again"); **Sync
    now** (busy state without a label swap — the `loading-sweep` guard);
    **Disconnect** with a confirm saying synced days stay.
  - People: matched count, then the unmatched and owner-mapped people with a
    member picker per row and "Not on Laika"; saving sends `PUT
    /org/hr/people`.
- [ ] **Holidays** list for every member: this year and next, by day, label,
      a "Clan" tag on synced rows and "Some people" when not everyone's;
      owners/admins (`org.time.set`) add (day + label) and remove manual
      rows; Clan rows have no remove.
- [ ] Both themes, 1440 and 390 with no sideways scroll, tokens only, every
      size a `--text-*` step ≥ 12 px; the `tokens`, `states`, `type-floor`,
      `loading-sweep`, `endpoint-coverage`, `view-type-drift`,
      `screen-header` guards green.
- [ ] Browser tests (stubbed `/org/hr*`, `/org/holidays`): off → connect →
      connected; 2FA path; each error worded; Sync now posts once and shows
      the new counts; people mapping sends the right body; member sees the
      Holidays list read-only and no HR card; both themes × 1440/390.

## Notes

- Copy is plain and owner-facing. No Clan colours; tokens only.
- Built on LAI-1181's contract; merge its branch before the drift guards.

---
id: LAI-1182
title: 'Organisation settings: the HR connection card (Clan) and the Holidays list (D-149)'
area: web
assignee: chief
priority: p1
depends-on: [LAI-1181]
status: done
finished: 2026-11-13T17:00:50Z
accepted: 2026-11-13T17:35:00Z
started: 2026-11-13T12:01:12Z
---

## Goal

The web half of D-149's connection, on the Organisation screen's Overview →
Workspace settings (`OrganisationScreen.tsx`, beside `TimeModeFact` and
`BreakScheduleFact`): an **HR system** card where an owner or admin connects
Clan, sees how syncing is going, runs it now, and maps people; and a
**Holidays** list everyone can read and owners/admins can add to.

## Acceptance criteria

- [x] `src/api/hr.ts` mirrors LAI-1181's `HrSourceView` and holiday shapes
      (doc header "Mirrors `services/hr-sync.ts` / `routes/hr.ts`"), every
      path written out whole (`/org/hr`, `/org/hr/connect`,
      `/org/hr/connect/verify`, `/org/hr/sync`, `/org/hr/people`,
      `/org/holidays`); `view-type-drift` PAIRS for each view and nested shape
      (name nested shapes on both sides).
- [x] **HR system card** on **Organisation → Integrations, beside the GitHub
      webhook card** (CHIEF, 2026-11-13; it was Overview) — shown to
      `org.hr.configure` holders only, via `useGates`, modelled on
      `GithubWebhookSection.tsx`:
  - off: one line on what it does ("Holidays and leave from Clan, every 30
    minutes. Laika keeps the sign-in token, never the password.") and
    **Connect Clan** opening a form that offers both ways (CHIEF's final
    contract, docs head `1f8c7f0f`), signing in first: **Sign in with the
    account** — Clan address (placeholder `https://codesage.clan.biz`, the
    bare origin accepted), email, password, then on `pending_2fa` a code
    field and the method — or **Paste a token** — Clan address, Token
    (password-type, never pre-filled or echoed), Expires on (optional); the
    line "Use a dedicated, read-only Clan account (for example Forge) — never
    your own login. Laika keeps only a sign-in key, never the password.";
    `POST /org/hr/connect` with `{ base_url, email, password }` or
    `{ base_url, token, expires_on? }`; errors in words by `details.reason`
    (`clan_login_failed`, `clan_token_refused`, `clan_unreachable`,
    `two_factor_expired`, and every other reason the server names).
  - connected: "Connected as {account_name} ({account_email}) · token
    …{last4}", with "renews by {date}" only when the end is known and a
    warning tone ≤ 30 days; a warning when `sees_everyone` is false ("This
    token can only see one person’s leave — it needs an HR or admin role in
    Clan.") and when `sees_departments` is false ("People’s departments are
    hidden from this token, so holidays meant for some departments can’t be
    matched."); last sync "N min ago" with the
    counts (holidays, leave days, people matched N of M) or the error in words
    (`token_rejected` → "Clan refused the token — connect again"); **Sync
    now** (busy state without a label swap — the `loading-sweep` guard);
    **Disconnect** with a confirm saying synced days stay.
  - People: matched count, then the unmatched and owner-mapped people with a
    member picker per row and "Not on Laika"; saving sends `PUT
    /org/hr/people`.
- [x] **Holidays** list for every member, on **Overview → Workspace settings,
      beside Time and Breaks**: this year and next, by day, label, a "Clan"
      tag on synced rows, and whom each covers — "Clan staff" for a synced
      one with no scope (the server's `everyone` means everyone in Clan),
      "Some people" for a scoped one, "Everyone" for a manual one;
      owners/admins (`org.time.set`) add (day + label) and remove manual
      rows; Clan rows have no remove.
- [x] Both themes, 1440 and 390 with no sideways scroll, tokens only, every
      size a `--text-*` step ≥ 12 px; the `tokens`, `states`, `type-floor`,
      `loading-sweep`, `endpoint-coverage`, `view-type-drift`,
      `screen-header` guards green.
- [x] Browser tests (stubbed `/org/hr*`, `/org/holidays`): off → connect →
      connected; 2FA path; each error worded; Sync now posts once and shows
      the new counts; people mapping sends the right body; member sees the
      Holidays list read-only and no HR card; both themes × 1440/390.

## Notes

- Copy is plain and owner-facing. No Clan colours; tokens only.
- Built on LAI-1181's contract; merge its branch before the drift guards.

## Build notes (LAI-1182 builder, 2026-11-13)

- Built on `LAI-1181-clan-hr-sync` at `f27fe431`, merged into this branch;
  the eight HR views are paired in `view-type-drift.test.ts`.
- **One assertion is red on this branch by design (CLAUDE.md §4.4), and it is
  CORE's file.** `server/test/tooling/response-type-coverage.test.ts` →
  *names nothing that is already paired or no longer served*:
  `HrSourceView`, `HrSyncErrorView`, `HrSyncResultView`, `HrTwoFactorView`,
  `HrPersonView`, `HrPersonUserView`, `HolidayView`, `HolidayListView` each
  "is paired now — remove it from UNPAIRED"; and with it *reports how much of
  the surface is actually guarded*: `expected 190 to be 182`. Both go green
  when LAI-1181 drops the eight `UNPAIRED` lines it added, which it can only do
  once these pairs exist.
- Placement after CHIEF's correction: the HR system is a card on
  Integrations; Holidays is a fact on Overview → Workspace settings.
- `view-type-drift` is green since LAI-1181's `0ef42dbf` (both ways to
  connect, `account_name`, `sees_everyone`, `sees_departments`) was merged.
  The `response-type-coverage` red above is the only one left.
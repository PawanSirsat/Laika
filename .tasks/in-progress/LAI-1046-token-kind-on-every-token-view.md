---
id: LAI-1046
title: 'Every token view says whether it is a personal token or an agent credential, and the admin lists group by it'
area: server
assignee: polly
priority: p2
depends-on: []
discovered-from: LAI-1042
status: in-progress
started: 2026-11-02T03:05:00Z
---

## Goal

Developer Access V3 slice B2 (`docs/proposals/LAI-1042-developer-access-v3-plan.md`
§A12, §A13, §B.6, §B.7, §E.4, §J slice B2, §K "Token kinds").

`TokenView` has no `kind` and no `agent_id`, and `selectTokens` filters on
`user_id` alone, so a registered agent's credential shows up unlabelled in
Developer access → Tokens, Organisation → Security and the profile's
"Their tokens". This adds `kind` (`personal` | `agent`), `agent_id` and
`agent_label` (`<harness> · <device>`, never the private registered name,
D-120/D-121) to every `TokenView`, plus an optional `?kind=` filter on both
list endpoints. The fields are additive and the filter is optional, so an old
client is unchanged.

## §4.4: one branch, three owners

One PR, so no drift guard is ever red. Named cross-area edits:

- **CHIEF (`docs/`)**: SPEC §4.9 — one paragraph on the view's kind fields;
  SPEC §6.4 — the two `GET … /tokens` lines gain `?kind=`.
- **CORE (`server/src/`, `server/test/`)**: `services/tokens.ts` (view, filter,
  label join), `http/routes/tokens.ts` (`?kind=` parsing), the routes test.
- **SHELL (`server/web/`)**: `api/tokens.ts` (type, `kind` on the two list
  calls, label helper), `components/TokenRow.tsx`, `routes/screens/tokens/TokensScreen.tsx`
  (personal only; the "Only you see this" copy),
  `routes/screens/organisation/OrganisationScreen.tsx` and
  `routes/screens/profile/AdminPanel.tsx` (group by kind; agent-revoke impact
  copy), their tests.

## Acceptance criteria

- [x] `kind`, `agent_id` and `agent_label` on every `TokenView`: `GET /tokens`,
      `POST /tokens`, `GET /users/:id/tokens`, and the token views an agent's
      register / rotate / read return. A legacy row (no `agent_id`) reads
      `kind: personal`, `agent_id: null`, `agent_label: null`, every other
      field unchanged.
- [x] `agent_label` is `<harness> · <device>` (`No device` when blank) and is
      never the agent's registered `display_name`, for the owner or an admin.
      Tested with a display name that differs from both.
- [x] `?kind=personal|agent` on both list endpoints; absent returns all, as
      today; any other value is `400` (corrected from `422` while in
      progress: a bad query value is `400` here, as invites' `include_used`).
      Paging under a filter is keyset-correct.
- [x] Developer access → Tokens lists personal tokens only. The name hint no
      longer says "Only you see this."
- [x] Organisation → Security and the profile admin "Their tokens" group by
      kind and name agent credentials as Tool · Device.
- [ ] `token.revoke_any` still revokes an agent credential; its confirmation
      says exactly what stops (the plan's §E.4 choice: keep revoke-any, state
      the impact). No change to who may do what.
- [x] `view-type-drift` green (client mirrors the three fields).
- [ ] CI green on the PR.

## Notes

- L6 (an agent token reading its owner's token and agent lists, plan §A14) is
  **not** in scope: filed separately.
- PR #204; CI green on `7f1095ae` (run 41352751810). L6 filed as LAI-1049
  (LAI-1047/1048 were taken by other builders). Revoke choice: plan §E.4 —
  keep `token.revoke_any` as a token revoke, state the impact.

## Review round 1 (PR #204)

- **B1 (blocking):** the impact copy promised a reconnect that does not exist
  today (rotate refuses a revoked token `409 token_revoked`; re-register is
  `409 agent_exists_for_harness_device`). Say what is true now; point at
  Slice C for the real reconnect.
- N1: SPEC §4.9 — `agent_id` to admins falls under the profile-oversight
  exception. N2: vacuous assertion in the routes test. N3: profile revoke
  button's aria-label. N4: truncated list must not claim "only live
  credential". N5: pluralise, compute the label once.

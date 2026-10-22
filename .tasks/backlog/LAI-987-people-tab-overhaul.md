---
id: LAI-987
title: 'Organisation → People is hard to operate: no search or filters, no confirmations, invites are clumsy, no transfer'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-981, LAI-982, LAI-984, LAI-970]
discovered-from:
status: backlog
---

## Acceptance criteria (audit A4, B3, B5, B6, B7, B8)

- [ ] People: search, chips for role / active–deactivated / space, counts,
      last sign-in column; same design language as the Spaces page (LAI-978).
- [ ] Role picker without *Owner*; owner sees **Transfer ownership** (typed
      confirmation). Confirmations on role change, invite revoke, deactivate
      (with offboarding dialog from LAI-988 when present) and Undo where safe.
- [ ] Invite form: space + space-role picker; **bulk** (paste emails, per-row
      result); expiry choice; **Copy link**; **Re-issue** on expired/lost.
- [ ] Organisation name editable on Overview (holders only).
- [ ] Every gate from the server's permissions (LAI-970). Light/dark,
      1440/390, browser tests. Gate exit 0 with servers merged.

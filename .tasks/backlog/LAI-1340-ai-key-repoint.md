---
id: LAI-1340
title: 'The AI provider key can be repointed: changing ai_base_url keeps the stored key, so it can be sent to a server of the editor''s choosing'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1312
status: backlog
---

## Goal

Found in CHIEF's review of LAI-1312 (PR #361), where the SMTP key had the same shape and was
fixed with `key_required`. Board card LAIKA-1088.

`PATCH /org` accepts `ai_base_url` without `ai_api_key`, and `services/orgs.ts`
`nextAiSettings` keeps `aiApiKeyEnc` while the base URL changes. So an editor holding
`org.settings.edit`, which a token may hold, can point `ai_base_url` at a server of their own.
The next Meeting review then sends the stored key there as its bearer header.

## Acceptance criteria

- [ ] A changed `ai_base_url` or `ai_provider` without a new `ai_api_key` is refused
      `422 { field: 'ai_api_key', reason: 'key_required' }` while a key is stored. Unchanged,
      it keeps the key as today.
- [ ] A test proves a repointed URL is refused and nothing is sent to it.
- [ ] A decision, recorded in the task or as a D-entry: should setting the AI provider be
      session only, as `org.email.configure` is (D-153)?

## Notes

- **Out of scope:** the internal-address and banner-grab class shared by `ai_base_url` and
  the SMTP host. CHIEF listed it as later.

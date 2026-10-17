---
id: LAI-753
title: 'GitHub webhook: no path sets its secret, a push stores almost nothing, and three comments say GitHub retries'
area: server
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-751
started: 2026-10-17T09:28:56Z
status: review
finished: 2026-10-17T11:02:53Z
---

## Goal

The GitHub webhook is not usable today and its comments are wrong. Found by
the heatmap research (`/tmp/laika-heatmap-research/REPORT.md`, Part A item 4
and Part B9) while planning LAI-751. It blocks the review gate's
"CI-confirmed" evidence (strategy P0 #8). Not part of LAI-751.

## Acceptance criteria

- [x] A product path (API and screen, owners and admins) sets and rotates
      `orgs.github_webhook_secret_enc`. Today none exists, so every delivery
      is refused `401` (`server/src/http/routes/webhooks.ts`).
- [x] A `push` records what a reader needs: today it stores at most one row
      with repo and branch — no commit ids, count or author — and a push to
      the default branch stores nothing.
- [x] The three comments claiming GitHub retries failed deliveries are
      corrected (`server/src/services/webhooks.ts`,
      `server/src/http/routes/webhooks.ts`). GitHub's documentation says it
      does not redeliver automatically; every push to `master` restarts
      production, so deliveries during a restart are lost unless redelivered
      by hand.

## Notes / context

- Filed by LAI-751 from the orchestrator's contract,
  `/tmp/laika-activity/CONTRACT.md`, section "LAI-753".
- D-050 refused mapping commit authors to Laika users; any attribution this
  task adds needs a decision first.

## Built (2026-10-17, chief, branch `build-github-confirm`, with LAI-766)

Made together with LAI-766 on the owner's direct instruction (board card
LAIKA-559), one builder, one branch, cut from `master` `c511c602`. Not
pushed, not merged. The decision record is **D-083** (it covers both tasks).

**The secret** — `POST /api/v1/org/github-webhook` makes a 32-byte hex secret,
stores it with `encryptSecret(…, 'github_webhook_secret')` and answers
`201 { configured, payload_url, secret }`: the only time it is served. Calling
it again rotates; the old secret is refused `401` at once.
`DELETE /api/v1/org/github-webhook` clears it (`204`). `GET /org` carries
`github_webhook: { configured, payload_url }` for whoever may *Configure
webhooks*, absent for anyone else. `server/src/services/orgs.ts`,
`server/src/http/routes/orgs.ts`, `server/src/app.ts` (passes
`LAIKA_PUBLIC_URL`).

**The screen** — a *GitHub webhook* card on Organisation
(`server/web/src/routes/screens/organisation/GithubWebhookSection.tsx`):
payload URL with its own Copy, content type, the six events to tick, the
secret shown once with the shared `CopyButton` and a *Done* that forgets it,
*Set secret* / *Rotate secret* / *Clear* (rotate and clear ask first), and one
line saying GitHub does not retry a failed delivery.

**The push** — one `webhook.commit` row with `{ repo, branch, default_branch,
count, shas (first 50), forced }`, against the task the branch names, else
against the one project whose `repo` is this repository (so a push to the
default branch is stored). No author, per D-050. The task panel's *Changes*
tab reads it (`pushSummary` in `server/web/src/api/activity.ts`): *3 commits
to main (default branch) · 1a2b3c4, …*.

**The comments** — corrected in `server/src/services/webhooks.ts` (the
`MAX_TRACKED` comment and `DeliveryLog`'s) and
`server/src/http/routes/webhooks.ts` (the dedupe comment and the
acknowledge-and-ignore comment). **Four sites, not three**: the services file
had two. SPEC §10.1 now says GitHub does not retry.

### Decisions taken while building

- **Laika makes the secret; it does not accept one.** A pasted secret is a
  person choosing a weak one, and the person copies it into GitHub either way.
- **Configure webhooks is now session only** (§3.1, `SESSION_ONLY_ACTIONS`).
  Whoever holds the secret can sign deliveries that confirm an agent's proof
  (LAI-766), so an agent's token must not mint one and vouch for itself.
  It reuses §3.1's existing *Configure webhooks* row (`webhook.configure`,
  owner and admin) rather than borrowing *Org settings*.
- **The payload URL** is `LAIKA_PUBLIC_URL` + `/webhooks/github` (outside
  `/api/v1`, §10); `null` when the server has none, and the screen then builds
  it from the address it was opened at.
- **A push to a repository no project tracks writes no activity row**
  (there is no project to put it on) but its commits are still remembered for
  LAI-766's proof. A deleted branch or a tag push stores nothing.
- **No audit row for setting or rotating the secret**: §4.8 has no verb for
  it, as for `developer_insights`, and a new verb is three owners (CLAUDE.md
  §4.4). Recorded in D-083's *does not decide*.

### Verified

- `server/test/http/routes/github-proof.test.ts` — *the webhook secret
  (LAI-753)* (5 tests) and *a push stores what a reader needs (LAI-753)*
  (3 tests); `server/test/http/routes/webhooks.test.ts`'s push-to-`main`
  test now asserts the row is stored.
- `server/web/test/browser/github-confirm.test.ts` — *the GitHub webhook card
  (LAI-753)*: on a non-secure page (as the live board is), set, copy once and
  read the clipboard back, Done hides it, rotate asks and shows the new one,
  decline sends nothing, clear asks and clears, a member sees no card.
- `server/web/test/api/activity.test.ts` — `pushSummary`.
- Each new test was turned red by a mutation of the code it covers and the
  tree restored (diff hash identical before and after): see the log.

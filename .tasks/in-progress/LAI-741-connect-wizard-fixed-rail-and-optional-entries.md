---
id: LAI-741
title: 'Connect wizard: a fixed rail, the optional sections folded in, and the LAI-740 review follow-ups'
area: web
assignee: chief
priority: p1
depends-on: [LAI-740]
discovered-from: LAI-740
started: 2026-10-12T12:10:04Z
status: in-progress
---

## Goal

The owner, 2026-10-12, **made on the owner's direct instruction**: a follow-up
to LAI-740 (the Connect wizard, now live), in
`server/web/src/routes/screens/connect/` (`ConnectScreen.tsx`, `connect.css`,
`connect-wizard.ts`) and their tests.

**The owner's rule, unchanged from LAI-740:** the setup-content wording, the
agent list, token handling, minting and the live check stay exactly as they
are. The text of the three folded-in sections is unchanged too.

## Acceptance criteria

- [ ] **A. Fixed rail.** On desktop the page does not scroll: the top bar and
      the step rail stay put and the right card is the scroll container — its
      eyebrow and title scroll with the content, its *Back / Continue* footer
      stays pinned at the bottom of the card. The screen fits the viewport
      under the app shell with no double scrollbars, at 1366×768 and
      1920×1080, sidebar open. At 390px the rail stacks above the card and the
      page scrolls normally.
- [ ] **B. Nothing outside the rail and the card.** *For the project lead*,
      *What an agent can do here* and *Invite a teammate* move into the rail as
      a separate *Optional* group under the four steps — *Share with your
      project*, *What agents can do*, *Invite a teammate* — same row style with
      an icon instead of a number, never locked, never counted in *STEP n OF
      4*. Each opens its content in the card (eyebrow *Optional*), whose footer
      offers *Back to steps* to the step the reader was on. Step 4, once
      connected, offers *Share with your project* as a next action.
- [ ] **C1.** *Use a token I already have* moves focus to *Continue* rather
      than dropping it to `body`.
- [ ] **C2.** The minted-token box is an alert only on the mint, not on every
      return to step 2.
- [ ] **C3.** *Command copied* on the rail is set only when a main block's copy
      actually succeeded — not by a failed clipboard, not by *Other ways*.
- [ ] **C4.** Where an agent has both paths, a line under the automatic block —
      *Prefer to do it by hand? Switch to By hand* — flips the toggle.
- [ ] **C5.** A note that introduces a block sits above it again, as before
      LAI-740; follow-up notes stay below.
- [ ] **C6.** Wrapped shell lines keep wrapping with a hanging indent, and the
      copied text is byte-identical.
- [ ] **C7.** `connect.test.ts` compares the rendered prompt to the setup
      block's exact text; `agent-logos.test.ts` compares the NOTICE.md slugs to
      the logos as sets, not counts.
- [ ] Each new browser test shown red without its change. Full gate from the
      repo root — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0.
- [ ] Screenshots, light and dark, at 1366×768 and 390, in
      `/tmp/laika-connect-wizard-2-shots/`.

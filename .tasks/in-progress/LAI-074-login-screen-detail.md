---
id: LAI-074
title: Login screen — match design 5a
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-062]
discovered-from:
status: in-progress
started: 2026-08-25T02:30:00+05:30
---

## Goal

Match screen **`5a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`
— the detailed source for this screen, and the only one. The prototype
compresses login into a single nav entry.

## Acceptance criteria

- [ ] One centred card on `var(--page)`: `var(--card)`, `1px solid var(--bd)`,
      radius **14px**, `var(--shadow)`, padding `26px 26px 22px`.
- [ ] Laika mark — 30px, radius 9px, `var(--tx)` ground with the stroke in
      `var(--card)` — beside the wordmark at 17px/800, letter-spacing `-.02em`.
- [ ] Headline **"Sign in to your instance"**, 19px/800, `-.022em`.
- [ ] **The instance host is shown**, mono 10.5px in `var(--tx2)` with a green
      padlock. This is self-hosted software and people run several instances —
      the design calls it out for that reason. **Use the real host, not
      `laika.kvelld.internal`**, which is a fixture.
- [ ] Fields 38px tall, radius 9px, `1px solid var(--bd2)`, ground `var(--page)`;
      labels 10.5px/700 in `var(--tx2)`.
- [ ] Password has a **Show/Hide** toggle at 10.5px/700 in `var(--tx3)`, and the
      value renders in JetBrains Mono.
- [ ] **"Keep me signed in on this device"** checkbox, 15px box, radius 4px.
- [ ] Primary **Sign in**: 40px, radius 10px, `var(--acc)`, white, 13.5px/700.
- [ ] Footer: *"No account? Only an Owner or Admin can invite you. Ask them for a
      link."* — 11px/500 `var(--tx3)`. It is the honest consequence of D-004.
- [ ] Both themes.

## Do NOT reproduce

- **"Forgot?"** — no password-reset endpoint exists (SPEC §6.4).
- **"OR" divider and "Email me a sign-in link"** — magic-link auth is not
  specified and needs SMTP.

Both are already listed in `docs/design/README.md` as artifacts. They are the
most prominent things on the mockup's card, so leaving them out will look like an
omission — it is not.

## Notes / context

**Take the layout and the type scale, not the markup.** The mockup is inline-styled
output from a foreign runtime.

LAI-062 first: this screen must not render the app nav.

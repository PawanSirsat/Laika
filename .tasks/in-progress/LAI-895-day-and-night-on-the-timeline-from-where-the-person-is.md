---
id: LAI-895
title: 'My day: the Timeline axis tells day from night — a sun or a moon by the hour, the strip tinted, blending at dawn and dusk — from where the person is, which they set themselves'
area: web
assignee: chief
priority: p1
depends-on: [LAI-894]
discovered-from: LAI-888
status: in-progress
started: 2026-10-22T19:01:37Z
---

## Goal

The owner, 2026-10-23, with the design's axis (*☀ 3 PM · ☀ 4 PM · 5:05 PM ·
☾ 6 PM · ☾ 7 PM*): *"also add this effect on top, day / night, so we can
differentiate; also we can set this thing in profile, like where that employee
belongs to, because for India it's different and for others it's different —
think about this and implement that."*

The design (`docs/design/Laika App v3.html`, the owner's export) draws the
axis strip cream by day and lavender by night, blending over an hour at dusk,
a sun or a moon before each hour, and a faint night tint down the lanes.
Its fixture has a fixed dusk; the product computes sunrise and sunset for the
day from **where the person is**.

## Design

- **Where you are** is the person's own setting, beside *Draft my time* on
  My day (the profile page is owners and admins only — a member could not
  reach a setting there). It is a place from a short list, keyed by its IANA
  zone (`Asia/Kolkata` — New Delhi, India; `Africa/Johannesburg`; …), stored
  as `place` on `user_time_settings` (§4.46), set by `PUT /me/time-settings
  { place }` under `time_settings.set_own`, read back in `GET
  /me/time-settings` and so in every day view's `settings`. Unset, the day's
  own zone picks the place when the list has it.
- **Sunrise and sunset** are computed on the client for the day and the
  place (the NOAA sunrise equation, no dependency), in the day's own zone.
  Dawn and dusk are the hour centred on each; the strip blends across them.
- **Nothing is time.** The sky is paint behind the hours; no figure, no
  count, nothing stored but the place.

## Acceptance criteria

- [ ] Server: `user_time_settings.place` (text, null), migration generated;
      `PUT /me/time-settings` takes `{ draft_my_time? , place? }` — at least
      one, `place` an IANA-shaped id of at most 64 characters or `null`;
      `GET /me/time-settings` answers `place`; a session only, the person's
      own, as today. Tests: set, clear, refused shapes, the view carries it.
      SPEC §4.46 and §6's `/me/time-settings` paragraph say so (named
      cross-area edits, D-033).
- [ ] `routes/screens/my-day/daylight.ts`: `sunTimes(day, lat, lng, tz)` →
      sunrise and sunset as minutes after the day's midnight in `tz`, or
      none in polar day or night; unit tests against New Delhi and London on
      a known date, within a few minutes.
- [ ] `routes/screens/places.ts`: the list — zone, city, country, latitude,
      longitude — and `placeOf(key)`; a test that every key is a valid zone
      the runtime knows.
- [ ] The Timeline: sky phases behind the axis (night, dawn, day, dusk,
      night) from the day's sun times, the lanes under them faintly tinted
      by night; a sun before a daytime hour and a moon before a night one,
      in their own tokens; five tokens in both themes, listed in the token
      inventory. Nothing where no place is known.
- [ ] *Where you are* on My day: a dropdown of the places, the current one
      shown, a change writes `PUT /me/time-settings { place }` and the day
      re-reads; read-only for an owner or admin looking at someone's day.
- [ ] Browser tests with the pinned clock: the phases and the glyphs for a
      place; none without one; the control writes and the sky follows.
- [ ] D-106 recorded. Gate: `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

---
id: LAI-1308
title: 'A web-serve stage: the built web app served by nginx with the server''s security headers, so a deployment can run the frontend as its own resource on the same domain'
area: docker
assignee: chief
priority: p1
depends-on: []
status: done
accepted: 2026-11-17T13:48:17Z
started: 2026-11-17T13:40:00Z
finished: 2026-11-17T13:24:52Z
---

## Goal

Owner, 2026-11-17: separate the Ksage project on Coolify into its parts — "why are you adding all
in one resource … yes do it split". The frontend becomes its own Coolify resource, `ksage-web`,
on the **same domain** as the backend: Traefik sends `/api`, `/mcp` and `/webhooks` to
`ksage-laika` (strip-prefix off) and everything else to `ksage-web`, so the browser still sees one
origin and sign-in, cookies and CSP behave exactly as today (§11.2, §13.1, LAI-090).

This task adds the image for that resource: a stage `web-serve` in `docker/Dockerfile`, built
from the existing `web` stage, that serves `/out` with nginx. The default target stays `runtime`,
so the AWS build and every existing deployment are unchanged.

## Acceptance criteria

- [x] `docker/Dockerfile` gains `FROM <pinned nginx unprivileged image> AS web-serve`, placed
      **before** `runtime` so `runtime` stays the last stage and the default build target; it copies
      `--from=web /out` and a config template from `docker/web/`; listens on 8080 as a non-root
      user; `HEALTHCHECK` on `/healthz`.
- [x] The nginx config: SPA fallback (`try_files $uri /index.html`); `/assets/` immutable for a
      year; `index.html` no-cache; `/api`, `/mcp`, `/webhooks` (and anything under them) answer 404
      rather than the SPA document, so a routing mistake is loud; `server_tokens off`; gzip for
      text types.
- [x] Every response carries the server's headers, values identical to
      `server/src/http/middleware/security-headers.ts` and `buildContentSecurityPolicy`:
      `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
      `X-Permitted-Cross-Domain-Policies`, `Cross-Origin-Opener-Policy`,
      `Cross-Origin-Resource-Policy`, and `Strict-Transport-Security` (the proxy terminates TLS).
      The attachment store's origin comes from an env var (`LAIKA_STORAGE_ORIGIN`, substituted at
      start by nginx's template mechanism) and is added to `img-src` and `connect-src` exactly as
      the server does when attachments are on; unset, the CSP is the server's attachments-off CSP.
- [x] A drift guard test asserts the template's CSP equals `buildContentSecurityPolicy([], …)` for
      both the on and off cases and that the header set matches the middleware's, so the two can
      never diverge silently. It also asserts the built `index.html` carries no inline `<style>` or
      `<script>` (the static CSP has no hashes; the server's would).
- [x] `docker/README.md` and `docs/OPERATIONS.md` describe running the frontend as its own
      resource on one domain (path routing, strip-prefix off, `LAIKA_STORAGE_ORIGIN`).
- [x] CI gate green on the PR (test, lint, format each exit 0).

## Notes / context

- Coolify builds with `dockerfile_target_build: web-serve`; the backend app keeps the default.
- No new npm dependency. The nginx base image is pinned by version and digest.
- SPEC §11.7 lists only what the **server** reads; `LAIKA_STORAGE_ORIGIN` is read by nginx in the
  web-serve image, so it is documented in docker/README.md, not §11.7 (say so there).

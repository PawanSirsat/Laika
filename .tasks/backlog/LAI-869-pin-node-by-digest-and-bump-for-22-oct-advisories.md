---
id: LAI-869
title: 'Pin Node 22.23.4 by digest; bump vite, vitest, the MCP SDK and hono (22 Oct security advisories)'
area: docker
assignee: strelka
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

The production image runs Node 22.23.4 **because it is pinned**, not by luck.
The CI gate runs the same Node. `pnpm audit --prod` reports no critical or
high advisory. Any lower advisory left with no fix in its line is listed here,
with the reason it cannot be reached.

## What is there today (read at `28cf1877`)

- **Production is not exposed today, but only by luck.** It runs Node
  22.23.4 only because the floating tag `node:22-bookworm-slim` happened to be
  rebuilt 64 minutes before the deploy.
  - CI / Deploy run 39655041366 (head `28cf1877`) shows it at log line 625:
    `FROM docker.io/library/node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
  - That digest is Docker Hub's `22.23.4-bookworm-slim`, as today's audit
    found.
  - `docker/Dockerfile:18` is `ARG NODE_VERSION=22`. The two `FROM` lines that
    name an image, `:24` (`deps`) and `:92` (`runtime`), are
    `FROM node:${NODE_VERSION}-bookworm-slim` with no digest.
  - The other three `FROM` lines (`:46`, `:61`, `:82`) are `FROM deps`, a
    stage, not an image.
- **The gate runs a different Node.** `.nvmrc` is `22`, and the gate reads it
  (`.github/workflows/deploy.yml:41`, `node-version-file: .nvmrc`). The same
  run's gate printed `node: v22.23.3` (log line 1809).
- **The image is built and deployed only on `master`**
  (`deploy.yml:56` and `:90`, `if: github.ref == 'refs/heads/master'`). A
  branch runs the gate alone.
- **`pnpm audit --prod`: 1 critical, 7 high, 17 moderate, 2 low.**
  - **Critical:** `proxy-addr` 2.0.7 (GHSA-jqcg-44mw-7w3h, fixed in 2.0.8),
    through `server > @modelcontextprotocol/sdk > express`. It is not
    reachable, because Laika serves with hono.
  - **`@modelcontextprotocol/sdk` 1.30.0**, pinned exactly at
    `server/package.json:31`, has 3 high advisories (fixed in 1.31.0 and
    1.32.0) and 2 moderate ones. One may be a DoS that signed-in `/mcp`
    callers could reach. That is **unverified**.
  - **`fast-uri` 3.1.6**: 2 high and 1 moderate. **`ip-address` 10.7.0**: 2
    moderate. Both come in through the MCP SDK.
  - **`source-map-js` 1.2.1**: 1 high, through
    `server > better-auth > vitest > vite > postcss`.
  - **`vite` 8.2.2**: 1 high, 4 moderate and 1 low, all dev-server
    advisories, fixed in 8.2.4.
    - In the lockfile it is `pnpm-lock.yaml:2542`, declared in
      `server/web/package.json:42` (`^8.2.2`).
    - It counts as `--prod` because `better-auth` brings `vitest` and `vite`
      in (`server > better-auth > vitest > vite`).
  - **`@vitest/mocker` 4.1.11**: 2 moderate (`pnpm-lock.yaml:1200`), fixed in
    4.1.12. It is test-only, also reached through `better-auth > vitest`.
    `vitest` is declared at `package.json:30` and `server/package.json:27`
    (`^4.1.11`).
  - **`hono` 4.13.3** (`server/package.json:35`): 5 moderate advisories, in
    APIs Laika does not use. The last is fixed in 4.13.11.
  - **`esbuild` 0.18.20**: 1 moderate, fixed only in 0.25. It comes in
    through `better-auth > drizzle-kit > @esbuild-kit/esm-loader >
    @esbuild-kit/core-utils`, and has no fix in its line.
  - **`cli` 0.1.0** (GHSA-6cpc-mj5c-m9rq, low) is a false positive: a
    registry package shares the workspace folder's name.
- **Engines.** Every `package.json` says `"node": ">=22"`, and `.npmrc` has
  `engine-strict=true`. The CLI refuses Node below 22.18 when it runs
  TypeScript (`cli/bin/laika:79-91`).

## Acceptance criteria

Each criterion fails today, except the two marked otherwise: the local
`docker run` check, and the release check.

- [ ] **Every `FROM` that names an image carries a digest.** Both `:24` and
      `:92` read
      `node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`,
      the multi-architecture index digest.
      - `ARG NODE_VERSION` becomes `22.23.4`, or goes.
      - The `FROM deps` stage lines stay as they are.
      - Today 0 of the 2 image lines carry `@sha256:`.
- [ ] **`.nvmrc` is `22.23.4`.** The gate's log on this task's branch shows
      `node: v22.23.4`. Today it shows `v22.23.3`.
- [ ] **The image runs 22.23.4.** A local build of `docker/Dockerfile`, then
      `docker run --rm <that image> node -p process.version`, prints
      `v22.23.4`. Record both commands and their output here.
      - This is a **confirmation that pairs with the pin**, not a criterion
        that fails today. Today's floating tag happens to give 22.23.4 too.
        The pin is what makes it stay true; the first criterion is the one
        that fails today.
- [ ] **No critical or high advisory.** `pnpm audit --prod --json` reports
      0 critical and 0 high. Today it reports 1 and 7.
      - Every advisory left at any level that has no fix in its line is
        listed here with the reason it is unreachable. That means at least
        `esbuild` 0.18.20 and the `cli` false positive.
- [ ] **The versions resolve as named.**
      - `vite` is `^8.2.4` in `server/web/package.json`, and `pnpm why vite`
        resolves 8.2.4 or later everywhere.
      - `vitest` is `^4.1.12` in `package.json` and `server/package.json`,
        and `pnpm why @vitest/mocker` resolves 4.1.12 or later.
      - `@modelcontextprotocol/sdk` is the latest 1.x with no high or
        critical advisory. It stays **pinned exactly**, as it is on purpose.
      - `hono` is `^4.13.11` or later.
      - These resolve to at least:
        - `proxy-addr` 2.0.8;
        - `fast-uri` 3.1.8;
        - `ip-address` 10.7.1;
        - `brace-expansion` 5.0.12;
        - `source-map-js` 1.2.2.

        Use a parent bump first. Use a `pnpm.overrides` entry in the root
        `package.json` only where a parent bump cannot reach the version,
        and record each override here with its reason.
- [ ] **`/mcp` still works after the SDK bump.**
      `server/test/mcp/parity.test.ts` and `cli/test/plugin-mcp.test.ts` stay
      green unedited. If the SDK changed behaviour they rely on, stop and
      record it here; do not loosen them.
- [ ] **Gate:** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0 on
      Node 22.23.4.
- [ ] **After Belka merges and releases**, the master run's build log shows
      `FROM …node:22.23.4-bookworm-slim@sha256:de170b39…`, and the deploy's
      health check comes back on the new image.
      - A branch never builds the image (`deploy.yml:56`), so this is checked
        on the release, not on the PR.
      - **Belka ticks this box** after the master run, and records the run
        id. Strelka cannot: it never pushes `master`. Strelka submits for
        review with this one box open, which is expected.

## Notes

- Board card **LAIKA-680**, the security card.
- Builds on **Strelka** (D-097; board tag `host-strelka`). Strelka never
  pushes `master`; the release is Belka's.
- **Files, one by one.** This is the whole crossing; no other file is
  granted:
  - `docker/Dockerfile`
  - `.nvmrc`
  - `server/package.json`
  - `server/web/package.json`
  - `package.json` (the root)
  - `pnpm-lock.yaml`
- No new dependency. Only versions of existing ones change, plus overrides.
- **Out of scope:**
  - **Do not raise `engines`.** With `engine-strict=true`, a higher floor
    stops `pnpm install` on any laptop still below 22.23.4. The owner upgrades
    Belka's Node first. A follow-up then raises `engines`, and the 22.18
    check in `cli/bin/laika:79-91`.
  - **A digest pin freezes the base image's Debian security updates.** A
    follow-up adds Dependabot or Renovate to move it. That is new config, and
    it needs its own task.
  - **`esbuild` 0.18.20 has no fix in its line.** It is reached only through
    `drizzle-kit`, the migration generator. That is a devDependency
    (`server/package.json:24`), and `server/src` names it only in comments,
    never imports it. Audit sees it in `--prod` only because `better-auth`
    lists it. List it, as the fourth criterion says.

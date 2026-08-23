# server/web/ — the Laika SPA

React 19 + TypeScript + Vite. Owned by **Builder-B** (D-016); the rest of
`server/` is Builder-A's. The boundary is API versus UI, not directory depth —
nothing here touches `server/src/`.

```bash
pnpm --filter @laika/web dev     # Vite on :5173, proxying the API to :3000
pnpm build                       # from the repo root → server/public/
pnpm --filter @laika/web test    # CSP regression guard
```

`pnpm dev` from the repo root starts this and the server together. Run the
server too (`pnpm --filter @laika/server dev`) or the proxied routes 502.

## Build output

`vite build` writes to `../public` — `server/public/`, which the server serves
statically and `.gitignore` excludes. **Nothing is ever committed there**
(LAI-016). When it is empty the server serves `src/static/fallback.html`
instead, which is why a checkout with no build still shows a page.

## Content-Security-Policy

The server sends a strict CSP on every response
(`server/src/http/middleware/security-headers.ts`). Two directives constrain
what may be written here:

| Directive | What it forbids in this package |
| --- | --- |
| `script-src 'self'` | inline `<script>`, `on*=` attributes, `eval`, `new Function` |
| `font-src 'self'` | loading fonts from any other origin |

`test/csp-compatibility.test.ts` enforces both. It builds its own output into a
temp directory rather than reading `server/public/`, so its result never depends
on whether someone has run a build — deliberately, because a test that reads
gitignored build output passes in CI and fails locally on identical source
(LAI-204).

Verified under LAI-103, in a browser against a real build: the SPA loads with
**zero** CSP violations and makes **zero** external network requests — the
document, the JS, the CSS and both fonts all come from our own origin.

**`pnpm dev` needs no relaxed policy.** Vite injects an inline React Refresh
script in development, which `script-src 'self'` would block — but the dev
document is served by Vite, which sets no CSP at all. Only proxied `/api`
responses carry one, and a header on a JSON response does not govern the HTML
document. So there is no development-only branch to maintain, and none should be
added.

If a change genuinely requires loosening the policy, that file is Builder-A's:
say what to change and why in a task with `area: server` rather than editing it
(see LAI-205).

## Fonts

Plus Jakarta Sans and JetBrains Mono, self-hosted via `@fontsource-variable/*`,
imported in `src/index.css`. The variable builds cover 200–800 and 100–800, so
the design's 400–800 and 500–700 both sit inside range.

Never load these from Google. A self-hosted board that calls a CDN on every page
load contradicts SPEC §13.4, and the test above fails if a remote font URL
appears in the emitted CSS.

## Not here yet

Design tokens and theming land in **LAI-018**, the app shell, sidebar and
routing in **LAI-019**, shared state/empty/loading components in **LAI-020**,
form primitives in **LAI-021**. `src/App.tsx` is a placeholder until then, and
holds no mockup data on purpose — CLAUDE.md §5.1 makes fixtures a defect even
when they look right.

Style comes from `docs/design/`, markup does not: those files are a foreign
template dialect rendered by another tool, and the prototype carries known
artifacts that must not be reproduced. Read `docs/design/README.md` first.

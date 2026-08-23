import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The SPA is served as static files by the same Node process that serves the
 * API (SPEC §11.4), so the build lands in `server/public/` — the directory
 * `server/src/http/static.ts` reads and `.gitignore` excludes (LAI-016).
 * Nothing is ever committed there.
 */
const OUT_DIR = '../public';

/** Where `pnpm --filter @laika/server dev` listens. */
const API_ORIGIN = 'http://localhost:3000';

/**
 * Paths the server owns. Everything else falls through to the SPA, which
 * mirrors the server's own fallback rule so dev and production disagree as
 * little as possible.
 */
const SERVER_PATHS = ['/api', '/mcp', '/webhooks'];

export default defineConfig({
  plugins: [react()],

  build: {
    outDir: OUT_DIR,
    // outDir sits outside the Vite root, so Vite refuses to clear it unless
    // told to. Safe here precisely because nothing is committed into it.
    emptyOutDir: true,
    sourcemap: true,
    // Fonts are the only assets so far and they must stay separate files:
    // inlining a variable woff2 as base64 would bloat the CSS and defeat
    // caching. 0 disables inlining outright.
    assetsInlineLimit: 0,
  },

  server: {
    port: 5173,
    proxy: Object.fromEntries(
      SERVER_PATHS.map((path) => [
        path,
        {
          target: API_ORIGIN,
          changeOrigin: true,
          // /api/v1/events is SSE (D-003). Vite's proxy buffers by default,
          // which would hold events until the response ends — and it never
          // does. This is the dev-server twin of the Caddy note in LAI-008.
          ws: false,
        },
      ]),
    ),
  },
});

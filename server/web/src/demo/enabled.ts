/**
 * Whether demo data may be rendered (D-032).
 *
 * The condition is that demo data must be **incapable of reaching a production
 * build** — a self-hoster must never see sprints that are not theirs. That is
 * not the same as "never visible", though, and the first cut conflated them:
 * with the guard keyed on `PROD` alone, a production build of the app showed
 * none of the design the owner asked to see, because the fixtures were stripped.
 *
 * So it is an **opt-in**, not a mode. A normal `pnpm build` contains no demo
 * data at all and the bundle test proves it. Building with
 * `VITE_LAIKA_DEMO=1` produces a deliberately-marked demo bundle for showing
 * the design.
 *
 * `import.meta.env` values are substituted at build time, so the default build
 * still reduces every call site to dead code the minifier removes.
 */
export const DEMO_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_LAIKA_DEMO === '1';

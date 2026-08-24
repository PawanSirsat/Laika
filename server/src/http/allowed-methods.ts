import { type Hono } from 'hono';

/**
 * Which HTTP methods a path actually has a route for.
 *
 * Hono answers a method mismatch with **404**, exactly as it answers an unknown
 * path — so `POST /api/v1/health` and `GET /api/v1/nonsense` are indistinguishable
 * to a client, and §6.3's `method_not_allowed` would be a code nothing could ever
 * produce.
 *
 * The router does know the difference, and asking it is not guessing. Matching a
 * path against each method returns the handler chain that would run: chain-wide
 * middleware matches every method equally, so any method whose chain is *longer*
 * than the shortest is one with a route of its own. Comparing across methods for
 * the same path means the number of registered middleware does not matter.
 *
 * Returns `[]` when no method has a route — a genuinely unknown path, which is a
 * 404 and not a 405.
 */
const PROBE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function allowedMethodsFor(app: Hono<never>, path: string): string[] {
  const depths = PROBE_METHODS.map((method) => {
    const [handlers] = app.router.match(method, path);
    return [method, handlers.length] as const;
  });

  const shallowest = Math.min(...depths.map(([, depth]) => depth));

  // Every method identical means nothing is registered here beyond the chain.
  return depths.filter(([, depth]) => depth > shallowest).map(([method]) => method);
}

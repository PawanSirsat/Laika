import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { allowedMethodsFor } from '../../src/http/allowed-methods.ts';

/** A chain of middleware, like the real app's — the counts must survive it. */
function appWithChain(): Hono<never> {
  const app = new Hono<never>();
  for (let i = 0; i < 6; i++) {
    app.use('*', async (_c, next) => {
      await next();
    });
  }
  return app;
}

describe('allowedMethodsFor', () => {
  it('reports the methods a path actually has routes for', () => {
    const app = appWithChain();
    app.get('/api/v1/thing', (c) => c.json({}));
    app.post('/api/v1/thing', (c) => c.json({}));

    expect(allowedMethodsFor(app, '/api/v1/thing').sort()).toEqual(['GET', 'POST']);
  });

  it('reports nothing for a path with no routes at all', () => {
    const app = appWithChain();
    app.get('/api/v1/thing', (c) => c.json({}));

    // The distinction the whole helper exists for: unknown path is a 404, not a 405.
    expect(allowedMethodsFor(app, '/api/v1/nonsense')).toEqual([]);
  });

  it('is unaffected by how much middleware the chain carries', () => {
    // Counting handlers only works because the comparison is across methods for
    // one path, not against a fixed number.
    const bare = new Hono<never>();
    bare.get('/x', (c) => c.json({}));

    const heavy = appWithChain();
    heavy.get('/x', (c) => c.json({}));

    expect(allowedMethodsFor(bare, '/x')).toEqual(allowedMethodsFor(heavy, '/x'));
  });

  it('handles a path-scoped middleware without inventing methods', () => {
    const app = new Hono<never>();
    app.use('/api/*', async (_c, next) => {
      await next();
    });
    app.get('/api/v1/thing', (c) => c.json({}));

    expect(allowedMethodsFor(app, '/api/v1/thing')).toEqual(['GET']);
    expect(allowedMethodsFor(app, '/api/v1/other')).toEqual([]);
  });

  it('sees routes mounted through a sub-app', () => {
    const app = appWithChain();
    const sub = new Hono();
    sub.get('/', (c) => c.json({}));
    sub.delete('/', (c) => c.json({}));
    app.route('/api/v1/tokens', sub);

    expect(allowedMethodsFor(app, '/api/v1/tokens').sort()).toEqual(['DELETE', 'GET']);
  });
});

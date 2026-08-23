import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { FALLBACK_DOCUMENT } from '../../src/paths.ts';
import {
  CONTENT_SECURITY_POLICY,
  HSTS_VALUE,
  isHttps,
} from '../../src/http/middleware/security-headers.ts';
import { testApp } from '../helpers/app.ts';

/** Every response must carry these, whatever produced it (SPEC §13.1). */
const ALWAYS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-permitted-cross-domain-policies': 'none',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

describe('security headers on every kind of response', () => {
  it('sets them on an API success', async () => {
    const { app } = testApp();
    const res = await app.request('/api/v1/health');

    expect(res.status).toBe(200);
    for (const [header, value] of Object.entries(ALWAYS)) {
      expect(res.headers.get(header), header).toBe(value);
    }
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });

  it('sets them on the SPA fallback document', async () => {
    // The document a browser actually renders — the one that matters for CSP.
    const { app } = testApp();
    const res = await app.request('/board/LAI-1');

    expect(res.status).toBe(200);
    for (const [header, value] of Object.entries(ALWAYS)) {
      expect(res.headers.get(header), header).toBe(value);
    }
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });

  it('sets them on a 404 error response', async () => {
    const { app } = testApp();
    const res = await app.request('/api/v1/nope');

    expect(res.status).toBe(404);
    for (const [header, value] of Object.entries(ALWAYS)) {
      expect(res.headers.get(header), header).toBe(value);
    }
  });

  it('sets them on a 500, where a leak would matter most', async () => {
    const { app } = testApp();
    const boom = new Hono();
    boom.get('/', () => {
      throw new Error('kaboom');
    });
    app.route('/api/v1/boom', boom);

    const res = await app.request('/api/v1/boom');

    expect(res.status).toBe(500);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });
});

describe('Content-Security-Policy (SPEC §13.1)', () => {
  it('permits no inline script', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('locks down the directives an injected document would reach for', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  });

  /**
   * AC3 asks for the policy to be verified against the built SPA. That build does
   * not exist yet (LAI-007, and now Builder-B's under D-016), so this verifies it
   * against the document this server *does* serve today — which is the same
   * question, asked of the only artefact available.
   */
  it('is satisfied by the document actually served', () => {
    const html = readFileSync(FALLBACK_DOCUMENT, 'utf8');

    // No inline script and no script at all: nothing for `script-src 'self'` to
    // block, and nothing that would need a hash or a nonce.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);

    // It does carry inline styles, which is why `style-src` allows them and
    // `script-src` does not. If this stops being true the allowance can go.
    expect(html).toMatch(/<style/i);
    expect(CONTENT_SECURITY_POLICY).toMatch(/style-src[^;]*unsafe-inline/);
  });
});

describe('HSTS is conditional (AC2)', () => {
  it('is absent over plain HTTP', async () => {
    const { app } = testApp();
    const res = await app.request('http://localhost/api/v1/health');

    // Sent here it would be ignored by the browser anyway, and on localhost it
    // pins the developer's browser to HTTPS for two years.
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('is present over HTTPS', async () => {
    const { app } = testApp();
    const res = await app.request('https://laika.example.com/api/v1/health');

    expect(res.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
  });

  it('trusts X-Forwarded-Proto, which is how it arrives behind a proxy', async () => {
    const { app } = testApp();
    const res = await app.request('http://localhost/api/v1/health', {
      headers: { 'X-Forwarded-Proto': 'https' },
    });

    expect(res.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
  });

  it('reads only the first hop of a multi-hop X-Forwarded-Proto', () => {
    expect(isHttps('http://x/', 'https, http')).toBe(true);
    expect(isHttps('http://x/', 'http, https')).toBe(false);
    expect(isHttps('http://x/', 'HTTPS')).toBe(true);
    expect(isHttps('http://x/', '')).toBe(false);
    expect(isHttps('https://x/', undefined)).toBe(true);
    expect(isHttps('http://x/', undefined)).toBe(false);
  });

  it('carries a max-age long enough to be meaningful', () => {
    const maxAge = Number(/max-age=(\d+)/.exec(HSTS_VALUE)?.[1]);
    // A short max-age is close to no HSTS at all.
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(HSTS_VALUE).toContain('includeSubDomains');
  });
});

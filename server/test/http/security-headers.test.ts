import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { FALLBACK_DOCUMENT } from '../../src/paths.ts';
import {
  buildContentSecurityPolicy,
  extractStyleHashes,
  HSTS_VALUE,
  isHttps,
} from '../../src/http/security-headers.ts';
import { testApp } from '../helpers/app.ts';

/** The policy the app actually serves, derived from the real fallback document. */
const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(
  extractStyleHashes(readFileSync(FALLBACK_DOCUMENT, 'utf8')),
);

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

  it('the built SPA needs no inline anything', () => {
    // Verified against the real Vite output by LAI-103; asserted here against the
    // document this server serves when no build is present.
    const html = readFileSync(FALLBACK_DOCUMENT, 'utf8');

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('style-src is split, not loosened (LAI-205)', () => {
  it('allows no inline <style> element except the hashed one', () => {
    // The dangerous half: an injected <style> can exfiltrate through attribute
    // selectors and background: url(...), and can redress the UI.
    expect(CONTENT_SECURITY_POLICY).toMatch(/style-src-elem 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/style-src-elem[^;]*unsafe-inline/);
  });

  it('keeps inline style attributes working', () => {
    // Avatar colours are derived from the user id at runtime (SPEC §4.1), so the
    // values do not exist until render and no stylesheet can hold them.
    expect(CONTENT_SECURITY_POLICY).toMatch(/style-src-attr 'unsafe-inline'/);
  });

  it('leaves engines without the CSP3 split no worse than before', () => {
    // Firefox < 128 and Safari < 15.4 read the plain directive.
    const plain = /(?:^|; )style-src ([^;]*)/.exec(CONTENT_SECURITY_POLICY)?.[1];

    expect(plain).toBeDefined();
    expect(plain).toContain("'unsafe-inline'");
  });

  it('keeps the hash OUT of the plain directive, which would disable the fallback', () => {
    // CSP2+ ignores 'unsafe-inline' in any source list that also contains a hash.
    // Putting the hash here would silently block inline style attributes on
    // exactly the old engines this line exists to serve.
    const plain = /(?:^|; )style-src ([^;]*)/.exec(CONTENT_SECURITY_POLICY)?.[1];

    expect(plain).not.toContain('sha256-');
  });

  it('hashes the fallback document as it is on disk, so it cannot drift', () => {
    const hashes = extractStyleHashes(readFileSync(FALLBACK_DOCUMENT, 'utf8'));

    expect(hashes).toHaveLength(1);
    expect(CONTENT_SECURITY_POLICY).toContain(hashes[0]);
  });

  it('rehashes when the document changes', () => {
    // The failure a hardcoded literal produces: edit the file, the hash stops
    // matching, and the fallback page renders unstyled with nothing saying why.
    const before = extractStyleHashes('<style>body{color:red}</style>');
    const after = extractStyleHashes('<style>body{color:blue}</style>');

    expect(before).not.toEqual(after);
    expect(buildContentSecurityPolicy(before)).not.toBe(buildContentSecurityPolicy(after));
  });

  it('handles a document with several style blocks, and one with none', () => {
    expect(extractStyleHashes('<style>a{}</style><style>b{}</style>')).toHaveLength(2);
    expect(extractStyleHashes('<p>no styles here</p>')).toEqual([]);
    expect(buildContentSecurityPolicy([])).toContain("style-src-elem 'self'");
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

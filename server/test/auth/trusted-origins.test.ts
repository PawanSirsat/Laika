import { describe, expect, it } from 'vitest';
import { isLoopbackHost, trustedOriginsFor } from '../../src/auth/trusted-origins.ts';

/**
 * LAI-090. The owner could not sign in to their own instance because
 * `LAIKA_PUBLIC_URL` said `localhost` and they had typed `127.0.0.1`.
 */

describe('isLoopbackHost', () => {
  it('recognises every spelling of this machine', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('does not treat a real host as loopback', () => {
    // The whole point is that this stays narrow: a LAN address and a public
    // hostname are genuinely different machines from the browser's point of view.
    for (const host of ['192.168.1.9', '10.0.0.4', 'laika.example.com', 'localhost.evil.com']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('is not fooled by a hostname that merely contains 127', () => {
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('a127.0.0.1')).toBe(false);
  });
});

describe('trustedOriginsFor', () => {
  it('trusts every loopback spelling on the configured port', () => {
    // This is the fix. `http://127.0.0.1:3000` used to be a 403.
    expect(trustedOriginsFor('http://localhost:3000')).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
    ]);
  });

  it('works whichever loopback spelling the operator configured', () => {
    expect(trustedOriginsFor('http://127.0.0.1:3000')).toEqual(
      trustedOriginsFor('http://localhost:3000'),
    );
  });

  it('keeps the scheme and the port', () => {
    expect(trustedOriginsFor('https://localhost:8443')).toEqual([
      'https://localhost:8443',
      'https://127.0.0.1:8443',
      'https://[::1]:8443',
    ]);
    // A default port is absent from `URL.port`, and must stay absent from the
    // origin — `http://localhost:80` does not match a browser's `Origin`.
    expect(trustedOriginsFor('http://localhost')).toEqual([
      'http://localhost',
      'http://127.0.0.1',
      'http://[::1]',
    ]);
  });

  it('adds nothing for a real hostname — this is not a blanket widening', () => {
    // An instance published at a domain must not silently start trusting
    // loopback: the CSRF check is the point, and only the message was the defect.
    expect(trustedOriginsFor('https://laika.example.com')).toEqual(['https://laika.example.com']);
    expect(trustedOriginsFor('http://192.168.1.9:3000')).toEqual(['http://192.168.1.9:3000']);
  });

  it('never returns a wildcard', () => {
    for (const url of ['http://localhost:3000', 'https://laika.example.com', 'not a url']) {
      expect(trustedOriginsFor(url)).not.toContain('*');
    }
  });

  it('drops a path, since an origin has none', () => {
    expect(trustedOriginsFor('https://laika.example.com/laika/')).toEqual([
      'https://laika.example.com',
    ]);
  });

  it('passes an unparseable value straight through rather than widening', () => {
    // `env.ts` validates the URL, so this is unreachable in practice. Inventing
    // a fallback here would hide a misconfiguration behind a *wider* trust set,
    // which is the wrong direction to fail in.
    expect(trustedOriginsFor('not a url')).toEqual(['not a url']);
  });
});

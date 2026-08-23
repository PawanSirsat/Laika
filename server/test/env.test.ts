import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../src/env.ts';

/** Long enough to pass the length check; these cases are not about the secret. */
const SECRET = { SERVER_SECRET: 'a-test-secret-long-enough-to-be-accepted' };

describe('readEnv', () => {
  it('defaults to port 3000 on 0.0.0.0 in production', () => {
    expect(readEnv({ ...SECRET })).toMatchObject({ port: 3000, host: '0.0.0.0', nodeEnv: 'production' });
  });

  it('reads PORT, HOST and NODE_ENV', () => {
    expect(readEnv({ PORT: '8080', HOST: '127.0.0.1', NODE_ENV: 'development' })).toMatchObject({
      port: 8080,
      host: '127.0.0.1',
      nodeEnv: 'development',
    });
  });

  it('treats an empty value as unset', () => {
    expect(readEnv({ ...SECRET, PORT: '', HOST: '', NODE_ENV: '' })).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'production',
    });
  });

  it('rejects a PORT that is not a plain integer', () => {
    // Number() would happily accept every one of these.
    for (const value of ['0x1f', ' 80 ', '80.5', '-1', 'http', '1e3']) {
      expect(() => readEnv({ PORT: value }), value).toThrow(EnvError);
    }
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() => readEnv({ ...SECRET, PORT: '0' })).toThrow(EnvError);
    expect(() => readEnv({ ...SECRET, PORT: '65536' })).toThrow(EnvError);
    expect(readEnv({ ...SECRET, PORT: '65535' }).port).toBe(65535);
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() => readEnv({ NODE_ENV: 'staging' })).toThrow(EnvError);
  });

  it('names the variable and the value in the message', () => {
    expect(() => readEnv({ PORT: 'banana' })).toThrow(/PORT.*banana/);
  });
});

describe('database path (SPEC §11.7, LAI-003)', () => {
  it('prefers an explicit LAIKA_DB_PATH', () => {
    expect(readEnv({ ...SECRET, LAIKA_DB_PATH: '/srv/custom.db' }).dbPath).toBe('/srv/custom.db');
  });

  it('derives the path from DATA_DIR when no explicit path is given', () => {
    expect(readEnv({ ...SECRET, DATA_DIR: '/mnt/vol' }).dbPath).toBe('/mnt/vol/laika.db');
  });

  it('lets LAIKA_DB_PATH win over DATA_DIR', () => {
    expect(readEnv({ ...SECRET, DATA_DIR: '/mnt/vol', LAIKA_DB_PATH: '/srv/custom.db' }).dbPath).toBe(
      '/srv/custom.db',
    );
  });

  it('defaults to /data/laika.db in production', () => {
    expect(readEnv({ ...SECRET, NODE_ENV: 'production' }).dbPath).toBe('/data/laika.db');
  });

  it('never falls back to ./data in production, even when /data is unwritable', () => {
    // The fallback would put the database outside the volume that gets backed up,
    // so in production the documented path is used whether or not it is writable
    // — a loud failure at boot beats a database nobody is backing up.
    expect(readEnv({ ...SECRET, NODE_ENV: 'production' }).dbPath).toBe('/data/laika.db');
  });

  it('falls back to ./data/laika.db in development when /data is not writable', () => {
    const path = readEnv({ ...SECRET, NODE_ENV: 'development' }).dbPath;

    // On a machine that does have a writable /data this is the documented
    // default instead; either is correct, and both are absolute.
    expect(path.endsWith('/laika.db')).toBe(true);
    expect(isAbsolute(path)).toBe(true);
  });

  it('resolves a relative LAIKA_DB_PATH to an absolute one', () => {
    expect(isAbsolute(readEnv({ ...SECRET, LAIKA_DB_PATH: 'tmp/x.db' }).dbPath)).toBe(true);
  });
});

describe('SERVER_SECRET (SPEC §11.7, §12 — LAI-005)', () => {
  it('refuses to start in production without one', () => {
    // It signs session cookies and derives the key that encrypts the org's API
    // keys; a missing value is a full compromise, not a degraded mode.
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow(/SERVER_SECRET/);
  });

  it('refuses a short secret even when one is supplied', () => {
    expect(() => readEnv({ NODE_ENV: 'production', SERVER_SECRET: 'short' })).toThrow(EnvError);
  });

  it('never puts the secret in the error message', () => {
    try {
      readEnv({ NODE_ENV: 'production', SERVER_SECRET: 'short' });
    } catch (err) {
      expect((err as Error).message).not.toContain('short');
      expect((err as Error).message).toContain('<redacted>');
    }
  });

  it('falls back to a fixed development secret outside production', () => {
    // So `pnpm dev` and the tests start without ceremony.
    expect(readEnv({ NODE_ENV: 'development' }).serverSecret).not.toBe('');
    expect(readEnv({ NODE_ENV: 'test' }).serverSecret).not.toBe('');
  });

  it('accepts a long enough secret', () => {
    const secret = 'a-real-secret-that-is-certainly-long-enough';
    expect(readEnv({ NODE_ENV: 'production', SERVER_SECRET: secret }).serverSecret).toBe(secret);
  });
});

describe('cookie security (SPEC §6.1)', () => {
  it('marks cookies Secure for an https PUBLIC_URL', () => {
    expect(readEnv({ ...SECRET, PUBLIC_URL: 'https://laika.example.com' }).secureCookies).toBe(true);
  });

  it('leaves them insecure on localhost, where https is not available', () => {
    // A Secure cookie over plain http is silently dropped, which would make
    // local development impossible rather than merely less safe.
    expect(readEnv({ ...SECRET, PUBLIC_URL: 'http://localhost:3000' }).secureCookies).toBe(false);
    expect(readEnv({ ...SECRET, PUBLIC_URL: 'http://127.0.0.1:3000' }).secureCookies).toBe(false);
  });

  it('treats any other http origin as needing Secure', () => {
    expect(readEnv({ ...SECRET, PUBLIC_URL: 'http://laika.example.com' }).secureCookies).toBe(true);
  });
});

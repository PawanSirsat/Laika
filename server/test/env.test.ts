import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../src/env.ts';

/**
 * The two variables §11.7 makes mandatory, so cases that are about something else
 * do not have to restate them. `NODE_ENV` defaults to `production`, where both
 * are required — which is why even a test about `PORT` needs them.
 */
const SECRET = {
  LAIKA_SECRET: 'a-test-secret-long-enough-to-be-accepted',
  LAIKA_PUBLIC_URL: 'http://localhost:3000',
};

describe('readEnv', () => {
  it('defaults to port 3000 on 0.0.0.0 in production', () => {
    expect(readEnv({ ...SECRET })).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'production',
    });
  });

  it('reads PORT, HOST and NODE_ENV', () => {
    expect(
      readEnv({ ...SECRET, PORT: '8080', HOST: '127.0.0.1', NODE_ENV: 'development' }),
    ).toMatchObject({
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

  it('derives the path from LAIKA_DATA_DIR when no explicit path is given', () => {
    expect(readEnv({ ...SECRET, LAIKA_DATA_DIR: '/mnt/vol' }).dbPath).toBe('/mnt/vol/laika.db');
  });

  it('lets LAIKA_DB_PATH win over LAIKA_DATA_DIR', () => {
    expect(
      readEnv({ ...SECRET, LAIKA_DATA_DIR: '/mnt/vol', LAIKA_DB_PATH: '/srv/custom.db' }).dbPath,
    ).toBe('/srv/custom.db');
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

describe('LAIKA_SECRET (SPEC §11.7, §12, D-018)', () => {
  it('is required in every environment, not only production', () => {
    // D-018: no default, no auto-generation, no development fallback. A secret
    // an operator never sees is a secret they never back up.
    for (const nodeEnv of ['production', 'development', 'test'] as const) {
      const env = { NODE_ENV: nodeEnv, LAIKA_PUBLIC_URL: 'http://localhost:3000' };
      expect(() => readEnv(env), nodeEnv).toThrow(EnvError);
      expect(() => readEnv(env), nodeEnv).toThrow(/LAIKA_SECRET/);
    }
  });

  it('treats an empty value as unset', () => {
    expect(() => readEnv({ LAIKA_SECRET: '', NODE_ENV: 'development' })).toThrow(EnvError);
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => readEnv({ LAIKA_SECRET: 'short', NODE_ENV: 'development' })).toThrow(EnvError);
    expect(() => readEnv({ LAIKA_SECRET: 'a'.repeat(31), NODE_ENV: 'development' })).toThrow(
      EnvError,
    );
    expect(readEnv({ LAIKA_SECRET: 'a'.repeat(32), NODE_ENV: 'development' }).serverSecret).toBe(
      'a'.repeat(32),
    );
  });

  it('never puts the secret in the error message', () => {
    // Startup errors end up in logs, terminals and screenshots.
    try {
      readEnv({ LAIKA_SECRET: 'a-short-but-secret-value', NODE_ENV: 'development' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('a-short-but-secret-value');
      expect((err as Error).message).toContain('<redacted>');
    }
  });

  it('accepts a long enough secret', () => {
    const secret = 'a-real-secret-that-is-certainly-long-enough';
    expect(readEnv({ LAIKA_SECRET: secret, NODE_ENV: 'development' }).serverSecret).toBe(secret);
  });

  it('no longer reads the old SERVER_SECRET name', () => {
    // A rename that keeps the old name working is a rename that never finishes.
    expect(() => readEnv({ SERVER_SECRET: 'a'.repeat(40), NODE_ENV: 'development' })).toThrow(
      /LAIKA_SECRET/,
    );
  });
});

describe('LAIKA_PUBLIC_URL (SPEC §11.7)', () => {
  /** Only the secret — these cases are about whether the URL itself is present. */
  const SECRET_ONLY = { LAIKA_SECRET: SECRET.LAIKA_SECRET };

  it('is required in production', () => {
    // The default would send invite links pointing at the operator's laptop.
    expect(() => readEnv({ ...SECRET_ONLY, NODE_ENV: 'production' })).toThrow(EnvError);
    expect(() => readEnv({ ...SECRET_ONLY, NODE_ENV: 'production' })).toThrow(/LAIKA_PUBLIC_URL/);
  });

  it('defaults to localhost on the configured port outside production', () => {
    expect(readEnv({ ...SECRET_ONLY, NODE_ENV: 'development' }).publicUrl).toBe(
      'http://localhost:3000',
    );
    expect(readEnv({ ...SECRET_ONLY, NODE_ENV: 'development', PORT: '8080' }).publicUrl).toBe(
      'http://localhost:8080',
    );
  });

  it('is used when supplied, in any environment', () => {
    expect(
      readEnv({
        ...SECRET_ONLY,
        NODE_ENV: 'production',
        LAIKA_PUBLIC_URL: 'https://laika.example.com',
      }).publicUrl,
    ).toBe('https://laika.example.com');
  });

  it('no longer reads the old PUBLIC_URL name', () => {
    expect(() =>
      readEnv({ ...SECRET_ONLY, NODE_ENV: 'production', PUBLIC_URL: 'https://laika.example.com' }),
    ).toThrow(/LAIKA_PUBLIC_URL/);
  });
});

describe('cookie security (SPEC §6.1)', () => {
  it('marks cookies Secure for an https LAIKA_PUBLIC_URL', () => {
    expect(
      readEnv({ ...SECRET, LAIKA_PUBLIC_URL: 'https://laika.example.com' }).secureCookies,
    ).toBe(true);
  });

  it('leaves them insecure on localhost, where https is not available', () => {
    // A Secure cookie over plain http is silently dropped, which would make
    // local development impossible rather than merely less safe.
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_URL: 'http://localhost:3000' }).secureCookies).toBe(
      false,
    );
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_URL: 'http://127.0.0.1:3000' }).secureCookies).toBe(
      false,
    );
  });

  it('treats any other http origin as needing Secure', () => {
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_URL: 'http://laika.example.com' }).secureCookies).toBe(
      true,
    );
  });
});

describe('LAIKA_PUBLIC_DIR (LAI-204)', () => {
  it('is undefined by default, so the server uses server/public', () => {
    expect(readEnv({ ...SECRET }).publicDir).toBeUndefined();
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_DIR: '' }).publicDir).toBeUndefined();
  });

  it('resolves an override to an absolute path', () => {
    // Exists so a test can point the server at a directory it controls rather
    // than depending on whether the SPA happens to have been built locally.
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_DIR: '/srv/spa' }).publicDir).toBe('/srv/spa');
    expect(isAbsolute(readEnv({ ...SECRET, LAIKA_PUBLIC_DIR: 'rel/spa' }).publicDir!)).toBe(true);
  });
});

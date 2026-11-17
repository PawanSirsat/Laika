import { isAbsolute } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../src/env.ts';
import {
  checkpointSettings,
  configureCheckpoints,
  DEFAULT_CHECKPOINT_SETTINGS,
} from '../src/services/checkpoints.ts';

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

  it('leaves them insecure on any plain-http origin, whatever the host (LAI-811)', () => {
    // This used to say every non-localhost http origin needs Secure. A browser
    // drops a Secure cookie set over plain http, so on `http://<IP>` — which is
    // production — nobody could have signed in, had better-auth read the flag.
    for (const url of [
      'http://203.0.113.7:3000',
      'http://203.0.113.7',
      'http://laika.example.com',
      'http://[2001:db8::1]:3000',
    ]) {
      expect(readEnv({ ...SECRET, LAIKA_PUBLIC_URL: url }).secureCookies, url).toBe(false);
    }
  });

  it('marks them Secure for https on a bare address too', () => {
    expect(readEnv({ ...SECRET, LAIKA_PUBLIC_URL: 'https://203.0.113.7' }).secureCookies).toBe(
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

describe('LAIKA_CLAIM_*_SECONDS (§11.7, §9.1.1, LAI-541)', () => {
  it('defaults to the proposal’s 30 s / 90 s / 5 min / 30 s', () => {
    expect(readEnv({ ...SECRET }).claims).toEqual({
      heartbeatMs: 30_000,
      suspectMs: 90_000,
      expireMs: 300_000,
      scanMs: 30_000,
    });
  });

  it('takes each from its own variable, per deployment', () => {
    expect(
      readEnv({
        ...SECRET,
        LAIKA_CLAIM_HEARTBEAT_SECONDS: '10',
        LAIKA_CLAIM_SUSPECT_SECONDS: '40',
        LAIKA_CLAIM_EXPIRE_SECONDS: '900',
        LAIKA_CLAIM_SCAN_SECONDS: '5',
      }).claims,
    ).toEqual({ heartbeatMs: 10_000, suspectMs: 40_000, expireMs: 900_000, scanMs: 5_000 });
  });

  it('refuses a value that is not whole seconds, naming the variable', () => {
    for (const value of ['0', '-1', '1.5', '1e3', ' 30', '86401', 'soon']) {
      expect(() => readEnv({ ...SECRET, LAIKA_CLAIM_SCAN_SECONDS: value }), value).toThrow(
        /LAIKA_CLAIM_SCAN_SECONDS/,
      );
    }
  });

  it('refuses an expiry no longer than the heartbeat: every claim would lapse between beats', () => {
    expect(() =>
      readEnv({ ...SECRET, LAIKA_CLAIM_HEARTBEAT_SECONDS: '60', LAIKA_CLAIM_EXPIRE_SECONDS: '60' }),
    ).toThrow(/LAIKA_CLAIM_EXPIRE_SECONDS/);
  });
});

describe('LAIKA_CHECKPOINT_* (§11.7, §9.1.1, D-115 item 9, LAI-1015)', () => {
  afterEach(() => {
    configureCheckpoints(DEFAULT_CHECKPOINT_SETTINGS);
  });

  it('defaults to the service’s own 10 min and 90 days', () => {
    expect(readEnv({ ...SECRET }).checkpoints).toEqual({
      pendingNoticeMs: DEFAULT_CHECKPOINT_SETTINGS.pendingNoticeMs,
      retentionMs: DEFAULT_CHECKPOINT_SETTINGS.retentionMs,
    });
    // The save warning (LAI-1016) is not an env variable: it keeps its default.
    expect(DEFAULT_CHECKPOINT_SETTINGS).toEqual({
      pendingNoticeMs: 600_000,
      retentionMs: 90 * 86_400_000,
      saveWarningMs: 300_000,
    });
  });

  it('takes the pending notice from its variable, and it reaches checkpointSettings()', () => {
    const env = readEnv({ ...SECRET, LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS: '900' });
    configureCheckpoints(env.checkpoints);
    expect(checkpointSettings()).toEqual({
      pendingNoticeMs: 900_000,
      retentionMs: DEFAULT_CHECKPOINT_SETTINGS.retentionMs,
      saveWarningMs: DEFAULT_CHECKPOINT_SETTINGS.saveWarningMs,
    });
  });

  it('takes the retention from its variable, and it reaches checkpointSettings()', () => {
    const env = readEnv({ ...SECRET, LAIKA_CHECKPOINT_RETENTION_DAYS: '30' });
    configureCheckpoints(env.checkpoints);
    expect(checkpointSettings()).toEqual({
      pendingNoticeMs: DEFAULT_CHECKPOINT_SETTINGS.pendingNoticeMs,
      retentionMs: 30 * 86_400_000,
      saveWarningMs: DEFAULT_CHECKPOINT_SETTINGS.saveWarningMs,
    });
  });

  it('refuses a malformed value with an EnvError naming the variable', () => {
    const cases: [string, string][] = [
      ['LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS', '0'],
      ['LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS', '10m'],
      ['LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS', '86401'],
      ['LAIKA_CHECKPOINT_RETENTION_DAYS', '0'],
      ['LAIKA_CHECKPOINT_RETENTION_DAYS', '1.5'],
      ['LAIKA_CHECKPOINT_RETENTION_DAYS', '3651'],
    ];
    for (const [variable, value] of cases) {
      let thrown: unknown;
      try {
        readEnv({ ...SECRET, [variable]: value });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${variable}=${value}`).toBeInstanceOf(EnvError);
      expect((thrown as EnvError).message).toBe(
        `Invalid ${variable}: ${JSON.stringify(value)}. Expected a whole number of ${
          variable.endsWith('_DAYS') ? 'days between 1 and 3650' : 'seconds between 1 and 86400'
        }.`,
      );
    }
  });
});

describe('LAIKA_BUILD_COMMIT, LAIKA_DEVELOPER_ACCESS, LAIKA_CLI_SOURCE_URL (§11.7, LAI-1043)', () => {
  it('defaults to no commit, v3 (LAI-1076), and this repository', () => {
    expect(readEnv({ ...SECRET })).toMatchObject({
      buildCommit: null,
      developerAccess: 'v3',
      cliSourceUrl: 'https://github.com/PawanSirsat/Laika.git',
    });
    // Empty is unset: a Docker build without the arg sets ENV to "".
    expect(
      readEnv({ ...SECRET, LAIKA_BUILD_COMMIT: '', LAIKA_DEVELOPER_ACCESS: '' }),
    ).toMatchObject({ buildCommit: null, developerAccess: 'v3' });
  });

  it('keeps a short or full lowercase hex commit', () => {
    const full = 'cea011d6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8';
    expect(readEnv({ ...SECRET, LAIKA_BUILD_COMMIT: 'cea011d' }).buildCommit).toBe('cea011d');
    expect(readEnv({ ...SECRET, LAIKA_BUILD_COMMIT: full }).buildCommit).toBe(full);
  });

  it('refuses a commit that is not 7–40 lowercase hex digits', () => {
    for (const bad of [
      'abc12',
      'CEA011D6',
      'cea011d6 ',
      'v1.2.3',
      'a'.repeat(41),
      '${{ github.sha }}',
    ]) {
      expect(() => readEnv({ ...SECRET, LAIKA_BUILD_COMMIT: bad }), bad).toThrow(
        /^Invalid LAIKA_BUILD_COMMIT: .*Expected a git commit id: 7 to 40 lowercase hex digits\.$/,
      );
    }
  });

  it('accepts each Developer access mode', () => {
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      expect(readEnv({ ...SECRET, LAIKA_DEVELOPER_ACCESS: mode }).developerAccess).toBe(mode);
    }
  });

  it('fails boot on any other Developer access value, naming the three', () => {
    for (const bad of ['V3', 'new', 'true', ' classic', 'v2']) {
      let caught: unknown;
      try {
        readEnv({ ...SECRET, LAIKA_DEVELOPER_ACCESS: bad });
      } catch (err) {
        caught = err;
      }
      expect(caught, bad).toBeInstanceOf(EnvError);
      expect((caught as EnvError).message).toBe(
        `Invalid LAIKA_DEVELOPER_ACCESS: ${JSON.stringify(bad)}. Expected one of 'classic', 'preview', 'v3'.`,
      );
    }
  });

  it('takes an https source URL', () => {
    expect(
      readEnv({ ...SECRET, LAIKA_CLI_SOURCE_URL: 'https://git.example.test/laika.git' })
        .cliSourceUrl,
    ).toBe('https://git.example.test/laika.git');
  });

  it('refuses a source URL that is not https or carries credentials, a query or a fragment, and never echoes it', () => {
    for (const bad of [
      'http://git.example.test/laika.git',
      'git@github.com:PawanSirsat/Laika.git',
      'https://user:lai_supersecret@git.example.test/laika.git',
      'https://lai_supersecret@git.example.test/laika.git',
      'https://git.example.test/laika.git?token=lai_supersecret',
      'https://git.example.test/laika.git#lai_supersecret',
      'https://git.example.test/laika.git?',
    ]) {
      let caught: unknown;
      try {
        readEnv({ ...SECRET, LAIKA_CLI_SOURCE_URL: bad });
      } catch (err) {
        caught = err;
      }
      expect(caught, bad).toBeInstanceOf(EnvError);
      const message = (caught as EnvError).message;
      expect(message).toMatch(
        /^Invalid LAIKA_CLI_SOURCE_URL: "<redacted>"\. Expected an https:\/\//,
      );
      expect(message).not.toContain('supersecret');
    }
  });
});

describe('LAIKA_S3_* and LAIKA_ATTACHMENT_MAX_BYTES (§11.7, D-150, LAI-1300)', () => {
  const STORE = {
    LAIKA_S3_ENDPOINT: 'https://files.example.test',
    LAIKA_S3_REGION: 'garage',
    LAIKA_S3_BUCKET: 'laika-attachments',
    LAIKA_S3_ACCESS_KEY_ID: 'GK0123456789abcdef01234567',
    LAIKA_S3_SECRET_ACCESS_KEY: 'fixture-store-secret-never-real-0123456789',
  };

  function refusal(env: NodeJS.ProcessEnv): string {
    let caught: unknown;
    try {
      readEnv(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvError);
    return (caught as EnvError).message;
  }

  it('is off — null — when none of the five store variables is set', () => {
    expect(readEnv({ ...SECRET }).attachments).toBeNull();
    // Empty is unset, as for every other variable.
    expect(
      readEnv({ ...SECRET, LAIKA_S3_ENDPOINT: '', LAIKA_S3_SECRET_ACCESS_KEY: '' }).attachments,
    ).toBeNull();
  });

  it('is on with all five, and defaults the size to 25 MiB', () => {
    expect(readEnv({ ...SECRET, ...STORE }).attachments).toEqual({
      store: {
        endpoint: 'https://files.example.test',
        region: 'garage',
        bucket: 'laika-attachments',
        accessKeyId: 'GK0123456789abcdef01234567',
        secretAccessKey: 'fixture-store-secret-never-real-0123456789',
      },
      maxBytes: 26_214_400,
    });
  });

  it('keeps the endpoint as an origin, port and all, and takes http only on loopback', () => {
    const endpoint = (value: string) =>
      readEnv({ ...SECRET, ...STORE, LAIKA_S3_ENDPOINT: value }).attachments?.store.endpoint;
    expect(endpoint('https://files.example.test:3900/')).toBe('https://files.example.test:3900');
    expect(endpoint('http://localhost:3900')).toBe('http://localhost:3900');
    expect(endpoint('http://127.0.0.1:3900')).toBe('http://127.0.0.1:3900');
    for (const bad of [
      'http://files.example.test',
      'https://files.example.test/laika-attachments',
      'https://GKkey:fixture-store-secret@files.example.test',
      'https://files.example.test?x=1',
      'ftp://files.example.test',
      'files.example.test',
    ]) {
      const message = refusal({ ...SECRET, ...STORE, LAIKA_S3_ENDPOINT: bad });
      expect(message, bad).toMatch(/^Invalid LAIKA_S3_ENDPOINT: "<redacted>"\. Expected an https:/);
      expect(message).not.toContain('fixture-store-secret');
    }
  });

  it('fails boot when some but not all are set, naming every one missing', () => {
    const { LAIKA_S3_BUCKET: _b, LAIKA_S3_REGION: _r, ...partial } = STORE;
    const message = refusal({ ...SECRET, ...partial });
    expect(message).toMatch(/^Invalid LAIKA_S3_REGION: "<unset>"\./);
    expect(message).toContain('LAIKA_S3_REGION, LAIKA_S3_BUCKET are missing');

    const only = refusal({
      ...SECRET,
      LAIKA_S3_SECRET_ACCESS_KEY: STORE.LAIKA_S3_SECRET_ACCESS_KEY,
    });
    expect(only).toMatch(/^Invalid LAIKA_S3_ENDPOINT: "<unset>"\./);
    // The one that is set is a secret, and the message never carries it.
    expect(only).not.toContain(STORE.LAIKA_S3_SECRET_ACCESS_KEY);
  });

  it('refuses a malformed region, bucket, key id or secret — never echoing the two credentials', () => {
    expect(refusal({ ...SECRET, ...STORE, LAIKA_S3_REGION: 'us/east' })).toMatch(
      /^Invalid LAIKA_S3_REGION: "us\/east"/,
    );
    expect(refusal({ ...SECRET, ...STORE, LAIKA_S3_BUCKET: 'Laika_Files' })).toMatch(
      /^Invalid LAIKA_S3_BUCKET: "Laika_Files"/,
    );
    const key = refusal({ ...SECRET, ...STORE, LAIKA_S3_ACCESS_KEY_ID: 'GK/fixture key' });
    expect(key).toMatch(/^Invalid LAIKA_S3_ACCESS_KEY_ID: "<redacted>"/);
    expect(key).not.toContain('fixture key');
    const secret = refusal({
      ...SECRET,
      ...STORE,
      LAIKA_S3_SECRET_ACCESS_KEY: 'two words-fixture',
    });
    expect(secret).toMatch(/^Invalid LAIKA_S3_SECRET_ACCESS_KEY: "<redacted>"/);
    expect(secret).not.toContain('words-fixture');
  });

  it('takes the size from its variable, 1 to 5 GiB, and judges it even when off', () => {
    expect(
      readEnv({ ...SECRET, ...STORE, LAIKA_ATTACHMENT_MAX_BYTES: '1048576' }).attachments?.maxBytes,
    ).toBe(1_048_576);
    expect(
      readEnv({ ...SECRET, ...STORE, LAIKA_ATTACHMENT_MAX_BYTES: '5368709120' }).attachments
        ?.maxBytes,
    ).toBe(5_368_709_120);
    for (const bad of ['0', '5368709121', '25MB', '1e6', '-1']) {
      expect(refusal({ ...SECRET, ...STORE, LAIKA_ATTACHMENT_MAX_BYTES: bad }), bad).toMatch(
        /^Invalid LAIKA_ATTACHMENT_MAX_BYTES: /,
      );
    }
    expect(refusal({ ...SECRET, LAIKA_ATTACHMENT_MAX_BYTES: 'lots' })).toMatch(
      /^Invalid LAIKA_ATTACHMENT_MAX_BYTES: "lots"/,
    );
  });
});

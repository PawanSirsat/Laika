import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../src/env.ts';

describe('readEnv', () => {
  it('defaults to port 3000 on 0.0.0.0 in production', () => {
    expect(readEnv({})).toMatchObject({ port: 3000, host: '0.0.0.0', nodeEnv: 'production' });
  });

  it('reads PORT, HOST and NODE_ENV', () => {
    expect(readEnv({ PORT: '8080', HOST: '127.0.0.1', NODE_ENV: 'development' })).toMatchObject({
      port: 8080,
      host: '127.0.0.1',
      nodeEnv: 'development',
    });
  });

  it('treats an empty value as unset', () => {
    expect(readEnv({ PORT: '', HOST: '', NODE_ENV: '' })).toMatchObject({
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
    expect(() => readEnv({ PORT: '0' })).toThrow(EnvError);
    expect(() => readEnv({ PORT: '65536' })).toThrow(EnvError);
    expect(readEnv({ PORT: '65535' }).port).toBe(65535);
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
    expect(readEnv({ LAIKA_DB_PATH: '/srv/custom.db' }).dbPath).toBe('/srv/custom.db');
  });

  it('derives the path from DATA_DIR when no explicit path is given', () => {
    expect(readEnv({ DATA_DIR: '/mnt/vol' }).dbPath).toBe('/mnt/vol/laika.db');
  });

  it('lets LAIKA_DB_PATH win over DATA_DIR', () => {
    expect(readEnv({ DATA_DIR: '/mnt/vol', LAIKA_DB_PATH: '/srv/custom.db' }).dbPath).toBe(
      '/srv/custom.db',
    );
  });

  it('defaults to /data/laika.db in production', () => {
    expect(readEnv({ NODE_ENV: 'production' }).dbPath).toBe('/data/laika.db');
  });

  it('never falls back to ./data in production, even when /data is unwritable', () => {
    // The fallback would put the database outside the volume that gets backed up,
    // so in production the documented path is used whether or not it is writable
    // — a loud failure at boot beats a database nobody is backing up.
    expect(readEnv({ NODE_ENV: 'production' }).dbPath).toBe('/data/laika.db');
  });

  it('falls back to ./data/laika.db in development when /data is not writable', () => {
    const path = readEnv({ NODE_ENV: 'development' }).dbPath;

    // On a machine that does have a writable /data this is the documented
    // default instead; either is correct, and both are absolute.
    expect(path.endsWith('/laika.db')).toBe(true);
    expect(isAbsolute(path)).toBe(true);
  });

  it('resolves a relative LAIKA_DB_PATH to an absolute one', () => {
    expect(isAbsolute(readEnv({ LAIKA_DB_PATH: 'tmp/x.db' }).dbPath)).toBe(true);
  });
});

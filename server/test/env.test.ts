import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../src/env.ts';

describe('readEnv', () => {
  it('defaults to port 3000 on 0.0.0.0 in production', () => {
    expect(readEnv({})).toEqual({ port: 3000, host: '0.0.0.0', nodeEnv: 'production' });
  });

  it('reads PORT, HOST and NODE_ENV', () => {
    expect(readEnv({ PORT: '8080', HOST: '127.0.0.1', NODE_ENV: 'development' })).toEqual({
      port: 8080,
      host: '127.0.0.1',
      nodeEnv: 'development',
    });
  });

  it('treats an empty value as unset', () => {
    expect(readEnv({ PORT: '', HOST: '', NODE_ENV: '' })).toEqual({
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

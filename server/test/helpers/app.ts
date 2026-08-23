import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type CreateAppOptions } from '../../src/app.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { FALLBACK_DOCUMENT } from '../../src/paths.ts';

export const TEST_VERSION = '9.9.9-test';

export interface CapturedLog {
  logger: Logger;
  records: Record<string, unknown>[];
  find(event: string): Record<string, unknown> | undefined;
}

/** A logger that keeps its output in memory so tests can assert on it. */
export function captureLog(): CapturedLog {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger((line) => {
    records.push(JSON.parse(line) as Record<string, unknown>);
  });

  return {
    logger,
    records,
    find: (event) => records.find((r) => r['event'] === event),
  };
}

/**
 * Build an app for testing.
 *
 * `publicDir` defaults to a directory that does not exist. That is deliberate:
 * it makes every test independent of whether the machine running it happens to
 * have a built SPA sitting in `server/public/`, which is exactly the clean-clone
 * condition LAI-002 asks the fallback to be proven under.
 */
export function testApp(overrides: Partial<CreateAppOptions> = {}) {
  const log = captureLog();

  const app = createApp({
    version: TEST_VERSION,
    logger: log.logger,
    publicDir: join(tmpdir(), 'laika-nonexistent-public-dir'),
    fallbackDocument: FALLBACK_DOCUMENT,
    ...overrides,
  });

  return { app, log };
}

/** A real temporary directory, cleaned up by the caller. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'laika-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

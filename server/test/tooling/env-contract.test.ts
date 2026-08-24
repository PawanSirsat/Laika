import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../../src/env.ts';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * The server and the container must agree about the environment.
 *
 * `docker compose up` was broken for about 35 minutes when LAI-032 made
 * `LAIKA_PUBLIC_URL` required and `docker-compose.yml` had never set it. The
 * whole gate stayed green: `pnpm test` does not build the image, and the image
 * build is not in CI. It surfaced because someone ran the container's
 * environment by hand — luck, not process.
 *
 * This reads **both real sources** rather than a hand-maintained list, because a
 * list would drift exactly the way the contract did. The server side is
 * discovered by *running* `readEnv`, not by parsing it: what the code actually
 * reads and actually rejects, not what it appears to.
 *
 * `docker/` is Builder-B's under D-016. This reads it and never writes it.
 */

const COMPOSE = join(SERVER_ROOT, '..', 'docker', 'docker-compose.yml');

/**
 * Variables compose sets but the server never reads.
 *
 * A list to shrink. An entry here means an operator can set something that does
 * nothing, which is its own kind of bug — see LAI-105 for the mirror case in
 * SPEC §11.7.
 */
const COMPOSE_ONLY_ALLOWED = new Map<string, string>([]);

/** A value plausible enough for each variable's own validation to accept. */
function sampleFor(name: string): string {
  if (name === 'PORT') return '3000';
  if (name === 'NODE_ENV') return 'production';
  if (name === 'HOST') return '0.0.0.0';
  if (name.includes('SECRET')) return 'a'.repeat(48);
  if (name.includes('URL')) return 'https://laika.example.test';
  if (name.includes('PATH') || name.includes('DIR')) return '/data/sample';
  return 'sample';
}

/**
 * Every variable `readEnv` touches, recorded by handing it a Proxy instead of a
 * plain object. No parsing, so a variable added to `env.ts` is picked up the
 * moment it is read.
 */
function variablesTheServerReads(): Set<string> {
  const reads = new Set<string>();

  const probe = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') return undefined;
        reads.add(key);
        return sampleFor(key);
      },
      has: () => true,
    },
  );

  readEnv(probe);

  return reads;
}

/**
 * Every variable the server **refuses to start without** in production.
 *
 * Discovered by starting from nothing and adding whatever the last failure named
 * until it boots — so the required set is whatever the code enforces, including
 * a variable added tomorrow by someone who never opens this file.
 */
function variablesRequiredInProduction(): Set<string> {
  const required = new Set<string>();
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      readEnv(env);
      return required;
    } catch (err) {
      if (!(err instanceof EnvError)) throw err;

      const named = /Invalid ([A-Z_]+):/.exec(err.message)?.[1];
      if (named === undefined || required.has(named)) {
        // Either the message shape changed or our sample value is not good
        // enough — both are bugs in this test, and both must be loud.
        throw new Error(
          `Could not satisfy readEnv while discovering required variables. Last error: ${err.message}`,
        );
      }

      required.add(named);
      env[named] = sampleFor(named);
    }
  }

  throw new Error('readEnv still failing after 20 variables — giving up rather than looping');
}

/** The keys of docker-compose.yml's `environment:` block. */
function variablesComposeSets(): Set<string> {
  const yaml = readFileSync(COMPOSE, 'utf8');
  const lines = yaml.split('\n');

  const start = lines.findIndex((l) => /^\s*environment:\s*$/.test(l));
  if (start === -1) {
    throw new Error(`No "environment:" block found in ${COMPOSE} — has the file changed shape?`);
  }

  const indent = (lines[start] ?? '').search(/\S/);
  const found = new Set<string>();

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Dedent back to the block's level or beyond ends the block.
    if (line.search(/\S/) <= indent) break;

    const key = /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(line)?.[1];
    if (key !== undefined) found.add(key);
  }

  if (found.size === 0) {
    throw new Error(`Parsed no variables from ${COMPOSE} — the check would pass vacuously`);
  }

  return found;
}

describe('env contract: server ↔ container', () => {
  it('sets, in compose, every variable the server requires in production', () => {
    const required = variablesRequiredInProduction();
    const compose = variablesComposeSets();

    const missing = [...required]
      .filter((name) => !compose.has(name))
      .map(
        (name) =>
          `${name} — the server refuses to start without it, and docker/docker-compose.yml does not set it. The container will exit on boot.`,
      );

    expect(missing).toEqual([]);
  });

  it('sets nothing in compose that the server never reads', () => {
    const reads = variablesTheServerReads();
    const compose = variablesComposeSets();

    const unread = [...compose]
      .filter((name) => !reads.has(name) && !COMPOSE_ONLY_ALLOWED.has(name))
      .map(
        (name) =>
          `${name} — docker/docker-compose.yml sets it and server/src/env.ts never reads it. Either wire it up or drop it; an operator setting a variable that does nothing is its own bug.`,
      );

    expect(unread).toEqual([]);
  });

  it('discovers the required set by running readEnv, not by parsing it', () => {
    // Guards the discovery itself: if this returned nothing, both checks above
    // would pass vacuously forever.
    const required = variablesRequiredInProduction();

    expect(required.size).toBeGreaterThan(0);
    expect([...required]).toContain('LAIKA_SECRET');
  });

  it('records reads through a Proxy, so a new variable needs no edit here', () => {
    const reads = variablesTheServerReads();

    expect(reads).toContain('LAIKA_SECRET');
    expect(reads).toContain('PORT');
    expect(reads.size).toBeGreaterThan(5);
  });

  it('keeps the compose-only exemption list honest', () => {
    const compose = variablesComposeSets();

    const stale = [...COMPOSE_ONLY_ALLOWED.keys()]
      .filter((name) => !compose.has(name))
      .map((name) => `${name} — exempted but compose no longer sets it; remove the entry`);

    expect(stale).toEqual([]);
  });
});

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
const SPEC = join(SERVER_ROOT, '..', 'docs', 'SPEC.md');

/**
 * Variables compose sets but the server never reads.
 *
 * A list to shrink. An entry here means an operator can set something that does
 * nothing, which is its own kind of bug — see LAI-105 for the mirror case in
 * SPEC §11.7.
 */
const COMPOSE_ONLY_ALLOWED = new Map<string, string>([]);

/**
 * Variables SPEC §11.7 documents that the server does not read.
 *
 * §11.7 is explicit: "anything in it must be read". An entry here is a
 * *temporary* record of a row awaiting removal, not a permanent excuse — an
 * operator who sets a documented variable and gets silence has been misled by
 * the deployment contract itself.
 *
 * Empty, and it should stay that way. Its one entry —
 * `LAIKA_DISABLE_INVITE_ONLY` — came off when LAI-109 removed the §11.7 row,
 * which is exactly what the staleness guard below is for.
 */
const DOCUMENTED_BUT_UNREAD = new Map<string, string>([]);

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

/** One probe run. Records every key touched; `suppressed` keys read as unset. */
function probeReads(suppressed: ReadonlySet<string>, into: Set<string>): void {
  const probe = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') return undefined;
        into.add(key);
        return suppressed.has(key) ? undefined : sampleFor(key);
      },
      has: () => true,
    },
  );

  try {
    readEnv(probe);
  } catch {
    // Suppressing a required variable throws — the reads up to that point were
    // still recorded, which is all this pass is after.
  }
}

/**
 * Every variable `readEnv` touches, found by running it rather than parsing it.
 *
 * **One pass is not enough**, and this is the subtle part. Precedence chains
 * return early: `resolveDbPath` reads `LAIKA_DB_PATH` first and returns, so a
 * single probe that supplies every variable never reaches `LAIKA_DATA_DIR` at
 * all. That blind spot hid a real §11.7 mismatch until this check went looking
 * for it.
 *
 * So each discovered variable is suppressed in turn, forcing the fallback branch
 * behind it, until the set stops growing.
 */
function variablesTheServerReads(): Set<string> {
  const reads = new Set<string>();
  probeReads(new Set(), reads);

  for (let round = 0; round < 10; round++) {
    const before = reads.size;

    for (const name of [...reads]) {
      probeReads(new Set([name]), reads);
    }

    if (reads.size === before) return reads;
  }

  throw new Error(
    'Read discovery did not settle after 10 rounds — probe the precedence chain by hand',
  );
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

/** The variable names in SPEC §11.7's deployment-contract table. */
function variablesTheSpecDocuments(): Set<string> {
  const spec = readFileSync(SPEC, 'utf8');
  const rows = [...spec.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm)];

  if (rows.length === 0) {
    throw new Error(`Parsed no variables from §11.7 in ${SPEC} — has the table changed shape?`);
  }

  return new Set(rows.map((r) => r[1]!));
}

describe('env contract: server ↔ SPEC §11.7', () => {
  /**
   * The third direction, and the one that produced LAI-105:
   * `LAIKA_DISABLE_INVITE_ONLY` sat in §11.7 for a day being read by nothing.
   * LAI-043 caught server↔container drift; this catches server↔spec.
   */
  it('reads every variable §11.7 documents', () => {
    const documented = variablesTheSpecDocuments();
    const reads = variablesTheServerReads();

    const unread = [...documented]
      .filter((name) => !reads.has(name) && !DOCUMENTED_BUT_UNREAD.has(name))
      .map(
        (name) =>
          `${name} — SPEC §11.7 documents it and server/src/env.ts never reads it. §11.7 says everything in that table must be read; either wire it up or take the row out.`,
      );

    expect(unread).toEqual([]);
  });

  it('documents every variable the server reads', () => {
    const documented = variablesTheSpecDocuments();
    const reads = variablesTheServerReads();

    const undocumented = [...reads]
      .filter((name) => !documented.has(name))
      .map(
        (name) =>
          `${name} — server/src/env.ts reads it and SPEC §11.7 does not list it. That is how an operator ends up unable to discover a variable that matters (D-018).`,
      );

    expect(undocumented).toEqual([]);
  });

  it('keeps the documented-but-unread list honest', () => {
    // When §11.7 drops a row, its exemption must go too — otherwise the list
    // quietly becomes a place where removed variables linger.
    const documented = variablesTheSpecDocuments();

    const stale = [...DOCUMENTED_BUT_UNREAD.keys()]
      .filter((name) => !documented.has(name))
      .map((name) => `${name} — exempted but §11.7 no longer lists it; remove the entry`);

    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    const empty = [...DOCUMENTED_BUT_UNREAD.entries()]
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([name]) => `${name} — exemptions need a reason someone can disagree with`);

    expect(empty).toEqual([]);
  });
});

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

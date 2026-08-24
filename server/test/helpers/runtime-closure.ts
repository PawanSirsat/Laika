import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * The packages the **shipped process** loads, and where they live on disk.
 *
 * Not `node_modules` as a whole: that is 139 packages, almost all of them vitest,
 * esbuild, rolldown and vite, none of which run in production. The closure that
 * matters is `server/package.json`'s `dependencies`, transitively — 28 packages —
 * and scanning only those keeps the audit about code that actually ships.
 */

const REPO_ROOT = join(SERVER_ROOT, '..');
const STORE = join(REPO_ROOT, 'node_modules', '.pnpm');

/** package name → directory, from pnpm's content-addressed store. */
function storeIndex(): Map<string, string> {
  const index = new Map<string, string>();
  if (!existsSync(STORE)) return index;

  for (const entry of readdirSync(STORE)) {
    const modules = join(STORE, entry, 'node_modules');
    if (!existsSync(modules)) continue;

    for (const name of readdirSync(modules)) {
      if (name.startsWith('@')) {
        const scope = join(modules, name);
        if (!statSync(scope).isDirectory()) continue;
        for (const inner of readdirSync(scope)) {
          const key = `${name}/${inner}`;
          if (!index.has(key)) index.set(key, join(scope, inner));
        }
        continue;
      }
      if (!index.has(name)) index.set(name, join(modules, name));
    }
  }

  return index;
}

function dependenciesOf(dir: string): string[] {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return [];

  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(parsed.dependencies ?? {});
  } catch {
    return [];
  }
}

export interface RuntimePackage {
  readonly name: string;
  readonly dir: string;
}

/** Every package reachable from `server/package.json`'s runtime dependencies. */
export function runtimeClosure(): RuntimePackage[] {
  const index = storeIndex();
  const manifest = JSON.parse(readFileSync(join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  const seen = new Set<string>();
  const queue = Object.keys(manifest.dependencies ?? {});
  const found: RuntimePackage[] = [];

  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);

    const dir = index.get(name);
    if (dir === undefined) continue;

    found.push({ name, dir });
    queue.push(...dependenciesOf(dir));
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Anything that reads the environment to decide behaviour.
 *
 * `isProduction` has no parentheses because it is a module-level **constant** in
 * `@better-auth/core` — evaluated once at import, so `NODE_ENV` must already be
 * set when the module loads. That is worth matching on precisely: a constant and
 * a function fail differently.
 */
const ENVIRONMENT_BRANCH = /NODE_ENV|isTest\(\)|isProduction|isDevelopment\(\)/;

const SKIP_DIRECTORIES = new Set(['test', 'tests', '__tests__', 'node_modules']);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(current, entry);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        if (!SKIP_DIRECTORIES.has(entry)) walk(full);
        continue;
      }
      if (/\.(?:mjs|cjs|js)$/.test(entry) && !entry.includes('.min.')) files.push(full);
    }
  };

  walk(dir);
  return files;
}

/** Package names in the runtime closure whose code branches on the environment. */
export function packagesBranchingOnEnvironment(): string[] {
  return runtimeClosure()
    .filter(({ dir }) =>
      sourceFiles(dir).some((file) => {
        try {
          return ENVIRONMENT_BRANCH.test(readFileSync(file, 'utf8'));
        } catch {
          return false;
        }
      }),
    )
    .map(({ name }) => name);
}

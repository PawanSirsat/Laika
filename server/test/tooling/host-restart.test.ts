import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_AHEAD_MARKER } from '../../src/db/migrate.ts';

/**
 * CI's rollback restores the database a failed deploy migrated (LAI-1033).
 *
 * `.github/deploy/host-restart.sh` runs as root on the production instance.
 * Here it runs against a temporary volume, with `docker`, `aws`, `curl` and
 * `sleep` replaced by stubs that record what the script asked of them — so
 * what is asserted is which file the container was started on, and that
 * nothing was deleted.
 */

const SCRIPT = fileURLToPath(new URL('../../../.github/deploy/host-restart.sh', import.meta.url));
const IMAGE = 'registry.example/laika@sha256:previous';

let root: string;
let data: string;
let backups: string;
let marker: string;
let state: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laika-host-'));
  data = join(root, 'data');
  backups = join(data, 'backups');
  marker = join(root, 'opt', 'deploy-started-at');
  state = join(root, 'state');
  bin = join(root, 'bin');
  for (const d of [backups, state, bin]) mkdirSync(d, { recursive: true });

  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('aws', 'echo password');
  stub('sleep', 'exit 0');
  stub(
    'curl',
    `[ "$(cat "${state}/healthy" 2>/dev/null)" = yes ] && echo '{"status":"ok"}' && exit 0; exit 7`,
  );
  // `run` records the image and the database it was started on.
  stub(
    'docker',
    `case "$1" in
  login) cat >/dev/null ;;
  inspect) cat "${state}/running" 2>/dev/null || exit 1 ;;
  run) for a in "$@"; do last="$a"; done
       echo "$last" > "${state}/running"
       cat "${data}/laika.db" > "${state}/started-on" 2>/dev/null || echo '(none)' > "${state}/started-on" ;;
  logs) cat "${state}/logs" 2>/dev/null ;;
  *) : ;;
esac`,
  );
  // macOS has no sha256sum; the instance (Amazon Linux) does.
  if (spawnSync('sh', ['-c', 'command -v sha256sum']).status !== 0) {
    stub('sha256sum', 'shasum -a 256 "$@"');
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function host(mode: string, run: string, healthy = true) {
  writeFileSync(join(state, 'healthy'), healthy ? 'yes' : 'no');
  const result = spawnSync('bash', [SCRIPT, IMAGE, mode, run], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      LAIKA_HOST_DATA: data,
      LAIKA_DEPLOY_STARTED: marker,
    },
  });
  return { ...result, out: result.stdout + result.stderr };
}

/** A snapshot whose mtime is `ageSeconds` from now — negative is the past. */
function snapshot(name: string, content: string, ageSeconds: number): string {
  const path = join(backups, `pre-migration-${name}.sqlite`);
  writeFileSync(path, content);
  const t = Date.now() / 1000 + ageSeconds;
  utimesSync(path, t, t);
  return path;
}

/** Puts the marker in the past, so snapshots written "after" it are newer. */
function deployed(run: string) {
  expect(host('deploy', run).status).toBe(0);
  const t = Date.now() / 1000 - 60;
  utimesSync(marker, t, t);
}

const startedOn = () => readFileSync(join(state, 'started-on'), 'utf8');
const live = () => readFileSync(join(data, 'laika.db'), 'utf8');

describe('a rollback after a deploy that migrated', () => {
  it('starts the previous image on the snapshot taken before the deploy’s first boot', () => {
    writeFileSync(join(data, 'laika.db'), 'migrated');
    writeFileSync(join(data, 'laika.db-wal'), 'migrated wal');
    const ancient = snapshot('2026-01-01T00-00-00-000Z', 'last month', -86_400);
    deployed('101-1');
    // The first boot's snapshot, then a crash-looped boot's of a half-migrated file.
    const first = snapshot('2026-11-01T10-00-00-000Z', 'before the deploy', -30);
    const second = snapshot('2026-11-01T10-00-05-000Z', 'half migrated', -25);

    const r = host('rollback', '101-1');

    expect(r.status, r.out).toBe(0);
    expect(startedOn()).toBe('before the deploy');
    expect(live()).toBe('before the deploy');
    expect(existsSync(join(data, 'laika.db-wal')), 'a stale -wal would replay over it').toBe(false);

    // Nothing deleted: the migrated set is kept beside it, every snapshot stays.
    const kept = readdirSync(data).filter((n) => n.startsWith('laika.db.rolled-back-'));
    expect(kept.sort()).toHaveLength(2);
    const keptDb = kept.find((n) => !n.endsWith('-wal'));
    const keptWal = kept.find((n) => n.endsWith('-wal'));
    expect(readFileSync(join(data, keptDb ?? '?'), 'utf8')).toBe('migrated');
    expect(readFileSync(join(data, keptWal ?? '?'), 'utf8')).toBe('migrated wal');
    for (const s of [ancient, first, second]) expect(existsSync(s), s).toBe(true);
    expect(r.out).toContain(`restoring ${first}`);
  });
});

describe('a rollback that must not touch the database', () => {
  it('leaves it when the marker belongs to another run', () => {
    // A deploy that failed before reaching the instance left the last good
    // deploy's marker; the snapshot after it is days behind the live file.
    writeFileSync(join(data, 'laika.db'), 'live');
    deployed('100-1');
    snapshot('2026-11-01T10-00-00-000Z', 'from the last good deploy', -30);

    const r = host('rollback', '101-1');

    expect(r.status, r.out).toBe(0);
    expect(startedOn()).toBe('live');
    expect(r.out).toContain('restore: none needed');
  });

  it('leaves it when this deploy took no snapshot (nothing was migrated)', () => {
    writeFileSync(join(data, 'laika.db'), 'live');
    snapshot('2026-01-01T00-00-00-000Z', 'last month', -86_400);
    deployed('102-1');

    const r = host('rollback', '102-1');

    expect(r.status, r.out).toBe(0);
    expect(startedOn()).toBe('live');
  });

  it('never restores on a deploy, only on a rollback', () => {
    writeFileSync(join(data, 'laika.db'), 'live');
    deployed('103-1');
    snapshot('2026-11-01T10-00-00-000Z', 'before', -30);

    const r = host('deploy', '103-1');

    expect(r.status, r.out).toBe(0);
    expect(startedOn()).toBe('live');
    expect(readFileSync(marker, 'utf8').split('\n')[0]).toBe('103-1');
  });
});

describe('a rolled-back image that refuses the schema', () => {
  it('fails the step and says the restore is manual', () => {
    writeFileSync(join(data, 'laika.db'), 'migrated by an earlier deploy');
    writeFileSync(join(state, 'logs'), `${SCHEMA_AHEAD_MARKER}: this database has 1 migration(s)…`);

    const r = host('rollback', '104-1', false);

    expect(r.status).toBe(1);
    expect(r.out).toContain('schema-ahead: this image refuses the database');
    expect(live()).toBe('migrated by an earlier deploy');
  });
});

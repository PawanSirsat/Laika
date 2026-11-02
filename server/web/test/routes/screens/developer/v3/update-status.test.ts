/**
 * A tool's helper update status (LAI-1065, plan LAI-1042 §H), from the
 * board's compatibility answer and the tool's own client report alone.
 *
 * - Each status from fixture combinations of the two.
 * - No report is *Version unknown* — never *outdated*, in any combination.
 * - *Update required* names the feature, and only a feature the board has
 *   switched on whose protocol the helper is below.
 * - The copy command names this board and nothing secret.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  boardBehindNote,
  type ClientReport,
  deviceUpdateSummary,
  offersUpdate,
  type Read,
  reportedHelper,
  sameCommit,
  updateCommand,
  type UpdateManifest,
  updateManifestOf,
  updateStatus,
  versionChip,
  WATCH_CAP_MS,
  WATCH_FIRST_MS,
  WATCH_LIMIT_MS,
  type WatchClock,
  watchForReport,
  whatsNew,
  worstUpdate,
} from '../../../../../src/routes/screens/developer/v3/update-status.ts';

const BOARD = 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90';
const OLDER = '19f85875aa00bb11cc22dd33ee44ff5566778899';

interface CompatOver {
  readonly current?: number;
  readonly minClient?: number;
  readonly commit?: string | null;
  readonly features?: Record<string, boolean>;
  readonly minFor?: Record<string, number>;
  readonly notes?: unknown[];
}

/** A compatibility answer as `server/src/services/developer-compat.ts` writes it. */
function compat(over: CompatOver = {}): unknown {
  return {
    server: { version: '0.1.0', build_commit: over.commit ?? BOARD },
    protocol: { current: over.current ?? 2, min_client: over.minClient ?? 1 },
    features: {
      developer_access: 'v3',
      device_pairing: false,
      tool_setup_exchange: false,
      client_reports: false,
      project_setups: false,
      ...over.features,
    },
    cli: {
      min_protocol_for: over.minFor ?? {
        device_pairing: 2,
        tool_setup_exchange: 2,
        client_reports: 2,
        project_setups: 2,
      },
      source: {
        type: 'git',
        url: 'https://github.com/PawanSirsat/Laika.git',
        commit: over.commit === undefined ? BOARD : over.commit,
        path: 'cli',
      },
    },
    release_notes: {
      ref: over.commit === undefined ? BOARD : over.commit,
      whats_new: over.notes ?? [
        { protocol: 2, summary: 'Device pairing and tool setup without a secret.' },
        {
          protocol: 1,
          summary: 'laika agent login, session hooks, laika connect and checkpoints.',
        },
      ],
    },
  };
}

function manifest(over: CompatOver = {}): UpdateManifest {
  const m = updateManifestOf(compat(over));
  assert.ok(m, 'the fixture is a readable manifest');
  return m;
}

function report(over: Partial<ClientReport> = {}): ClientReport {
  return {
    cli_version: '0.1.0',
    cli_commit: BOARD,
    protocol: 2,
    capabilities: ['client_report', 'doctor', 'update'],
    harness_version: null,
    harness: null,
    reported_at: 1_800_000_000_000,
    self_reported: true,
    ...over,
  };
}

void describe('the board’s manifest', () => {
  void test('an answer without a protocol is no manifest, so the row says Could not check', () => {
    assert.equal(updateManifestOf(undefined), undefined);
    assert.equal(updateManifestOf({ features: { developer_access: 'v3' } }), undefined);
    assert.equal(updateManifestOf({ protocol: { current: 'two' } }), undefined);
    assert.equal(updateStatus(updateManifestOf({}) ?? 'failed', report()).key, 'unchecked');
  });

  void test('only switched-on features with a known protocol count, and notes come oldest first', () => {
    const m = manifest({ features: { device_pairing: true, made_up: true } });
    assert.deepEqual(m.enabled, ['device_pairing']);
    assert.deepEqual(
      m.whatsNew.map((n) => n.protocol),
      [1, 2],
    );
    assert.equal(m.helperCommit, BOARD);
  });

  void test('a commit that is not hex is no commit', () => {
    assert.equal(manifest({ commit: 'main' }).helperCommit, null);
    assert.equal(manifest({ commit: null }).helperCommit, null);
  });
});

void describe('each status, from the two answers', () => {
  void test('Could not check when the board’s answer failed, with that reason', () => {
    const s = updateStatus('failed', report());
    assert.equal(s.key, 'unchecked');
    assert.equal(s.word, 'Could not check');
    assert.match(s.reason, /board’s update information/);
  });

  void test('Could not check when the tool’s report failed, with that reason', () => {
    const s = updateStatus(manifest(), 'failed');
    assert.equal(s.key, 'unchecked');
    assert.match(s.reason, /version report could not be read/);
  });

  void test('Checking while either answer is still on its way', () => {
    assert.equal(updateStatus(undefined, report()).key, 'checking');
    assert.equal(updateStatus(manifest(), undefined).key, 'checking');
  });

  void test('Version unknown with no report, or a report with no protocol', () => {
    for (const r of [null, report({ protocol: null })]) {
      const s = updateStatus(manifest(), r);
      assert.equal(s.key, 'unknown');
      assert.equal(s.word, 'Version unknown');
      assert.equal(offersUpdate(s.key), false);
    }
  });

  void test('Up to date: the helper runs the commit the board offers, either side abbreviated', () => {
    assert.equal(updateStatus(manifest(), report()).key, 'up-to-date');
    const s = updateStatus(manifest(), report({ cli_commit: BOARD.slice(0, 7) }));
    assert.equal(s.word, 'Up to date');
    assert.match(s.reason, /cea011d/);
  });

  void test('another commit at the board’s protocol is Up to date, naming both, with no update offered (review round 1, B1)', () => {
    // OLDER could be behind the board's commit, ahead of it, or on a fork; the
    // page cannot tell, and `laika update` refuses a target not ahead of HEAD.
    const s = updateStatus(manifest(), report({ cli_commit: OLDER }));
    assert.equal(s.key, 'up-to-date');
    assert.equal(s.word, 'Up to date');
    assert.match(s.reason, /on helper 19f8587; this board offers cea011d/);
    assert.equal(offersUpdate(s.key), false);
  });

  void test('a newer or forked commit at the board’s protocol is never an update', () => {
    const FORK = 'abcdef0123456789abcdef0123456789abcdef01';
    for (const runs of [FORK, OLDER, FORK.slice(0, 7)]) {
      const s = updateStatus(manifest(), report({ cli_commit: runs }));
      assert.equal(s.key, 'up-to-date', runs);
      assert.equal(offersUpdate(s.key), false, runs);
    }
  });

  void test('Update available: a protocol the board accepts but older than its own, and old work keeps working', () => {
    const s = updateStatus(manifest({ current: 3 }), report({ cli_commit: OLDER, protocol: 2 }));
    assert.equal(s.key, 'available');
    assert.equal(s.word, 'Update available');
    assert.match(s.reason, /This board speaks helper protocol 3; this one speaks 2/);
    assert.match(s.reason, /keeps working/);
    assert.equal(offersUpdate(s.key), true);
  });

  void test('the reasons say the protocol the same way, whichever side is ahead (N3)', () => {
    const level = updateStatus(manifest(), report({ cli_commit: null }));
    const ahead = updateStatus(manifest(), report({ cli_commit: null, protocol: 3 }));
    const behind = updateStatus(manifest({ current: 3 }), report({ cli_commit: null }));
    assert.equal(level.reason, 'This one speaks this board’s helper protocol, 2');
    assert.equal(ahead.reason, 'This one speaks helper protocol 3, newer than this board’s 2');
    assert.match(behind.reason, /^This board speaks helper protocol 3; this one speaks 2\./);
  });

  void test('with no commit on either side, the protocol decides', () => {
    const noBoardCommit = manifest({ commit: null });
    assert.equal(updateStatus(noBoardCommit, report({ protocol: 1 })).key, 'available');
    assert.equal(updateStatus(noBoardCommit, report({ protocol: 2 })).key, 'up-to-date');
    assert.equal(
      updateStatus(manifest(), report({ cli_commit: null, protocol: 1 })).key,
      'available',
    );
    assert.equal(
      updateStatus(manifest(), report({ cli_commit: null, protocol: 2 })).key,
      'up-to-date',
    );
  });

  void test('a helper ahead of the board is up to date, and says the board is behind', () => {
    const s = updateStatus(manifest({ current: 2 }), report({ cli_commit: OLDER, protocol: 3 }));
    assert.equal(s.key, 'up-to-date');
    assert.equal(s.aheadOfBoard, true);
  });
});

void describe('Update required names the feature', () => {
  void test('only a switched-on feature whose protocol the helper is below', () => {
    const m = manifest({
      current: 3,
      features: { device_pairing: true, project_setups: true },
      minFor: { device_pairing: 2, project_setups: 3, tool_setup_exchange: 9 },
    });
    const s = updateStatus(m, report({ cli_commit: OLDER, protocol: 2 }));
    assert.equal(s.key, 'required');
    assert.equal(s.word, 'Update required for project setup');
    assert.deepEqual(s.requiredFor, ['project setup']);
    assert.match(s.reason, /needs helper protocol 3; this one speaks 2/);
    // tool_setup_exchange needs 9, but the board has it off: it needs nothing.
    assert.doesNotMatch(s.word, /secret/);
  });

  void test('a feature the board has switched off never makes an update required', () => {
    const s = updateStatus(manifest(), report({ cli_commit: OLDER, protocol: 1 }));
    assert.equal(s.key, 'available');
  });

  void test('every switched-on feature it lacks is named', () => {
    const m = manifest({ features: { device_pairing: true, tool_setup_exchange: true } });
    const s = updateStatus(m, report({ protocol: 1 }));
    assert.equal(s.word, 'Update required for pairing devices, adding tools without a secret');
  });

  void test('below the board’s oldest accepted protocol, it is required for this board', () => {
    const s = updateStatus(manifest({ minClient: 2 }), report({ protocol: 1 }));
    assert.equal(s.key, 'required');
    assert.deepEqual(s.requiredFor, ['this board']);
  });

  void test('without a report nothing is required, whatever the board switched on', () => {
    const m = manifest({ features: { device_pairing: true } });
    assert.equal(updateStatus(m, null).key, 'unknown');
  });
});

void describe('never outdated without a report', () => {
  void test('across every combination, no word or reason says outdated, and only a report moves it off unknown', () => {
    const manifests: Read<UpdateManifest>[] = [
      undefined,
      'failed',
      manifest(),
      manifest({ commit: null }),
      manifest({ features: { device_pairing: true, project_setups: true }, current: 3 }),
      manifest({ minClient: 3, current: 3 }),
    ];
    const reports: Read<ClientReport | null>[] = [
      undefined,
      'failed',
      null,
      report({ protocol: null }),
      report(),
      report({ cli_commit: OLDER, protocol: 1 }),
      report({ cli_commit: null, protocol: 4 }),
    ];
    let seen = 0;
    for (const m of manifests) {
      for (const r of reports) {
        const s = updateStatus(m, r);
        seen += 1;
        assert.doesNotMatch(`${s.word} ${s.reason}`, /outdated|out of date|broken/i);
        const noReport = r === null || (typeof r === 'object' && r.protocol === null);
        if (noReport && m !== 'failed' && m !== undefined) assert.equal(s.key, 'unknown');
        if (s.key === 'available' || s.key === 'required' || s.key === 'up-to-date') {
          assert.ok(typeof r === 'object' && r !== null && r.protocol !== null);
        }
      }
    }
    assert.equal(seen, manifests.length * reports.length);
  });
});

void describe('What’s new', () => {
  void test('marks what is newer than the helper’s protocol', () => {
    const lines = whatsNew(manifest(), report({ protocol: 1 }));
    assert.deepEqual(
      lines.map((l) => [l.protocol, l.newForTool]),
      [
        [1, false],
        [2, true],
      ],
    );
  });

  void test('with no report, marks nothing: the page does not know what it lacks', () => {
    assert.ok(whatsNew(manifest(), null).every((l) => !l.newForTool));
  });
});

void describe('the update command', () => {
  void test('checks first, then updates, against this board', () => {
    const c = updateCommand('https://laika.example.com');
    assert.equal(
      c.text,
      'laika update --check --board https://laika.example.com\nlaika update --board https://laika.example.com',
    );
    assert.equal(c.allowHttp, false);
  });

  void test('--allow-http only for plain http off loopback, and only on the update itself', () => {
    const plain = updateCommand('http://192.168.1.20:3000');
    assert.equal(plain.allowHttp, true);
    assert.match(plain.text, /^laika update --check --board http:\/\/192\.168\.1\.20:3000\n/);
    assert.match(plain.text, /\nlaika update --board http:\/\/192\.168\.1\.20:3000 --allow-http$/);
    for (const loop of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      assert.equal(updateCommand(loop).allowHttp, false, loop);
      assert.doesNotMatch(updateCommand(loop).text, /allow-http/);
    }
  });

  void test('holds no secret: the origin alone, even from an address that carried one', () => {
    const c = updateCommand('https://ada:pw@laika.example.com/developer?token=lai_SECRET#lai_x');
    assert.doesNotMatch(c.text, /lai_|SECRET|pw|ada|token|\?|#/);
    assert.match(c.text, /--board https:\/\/laika\.example\.com$/m);
  });

  void test('an origin that is not http(s) is left out rather than pasted', () => {
    assert.equal(updateCommand('javascript:alert(1)').text, 'laika update --check\nlaika update');
  });
});

void describe('a device and the board', () => {
  const s = (r: ClientReport | null) => updateStatus(manifest(), r);

  void test('the card names counts worst first, or that all are up to date', () => {
    assert.equal(
      deviceUpdateSummary([s(report()), s(report())]),
      'Helpers up to date on every tool',
    );
    assert.equal(deviceUpdateSummary([s(report())]), 'Helper up to date');
    assert.equal(
      deviceUpdateSummary([s(null), s(report({ cli_commit: OLDER, protocol: 1 })), s(report())]),
      'Helper updates: 1 update available, 1 version unknown, 1 up to date',
    );
    assert.equal(deviceUpdateSummary([]), undefined);
    assert.equal(deviceUpdateSummary([updateStatus(undefined, undefined)]), undefined);
    assert.equal(worstUpdate([s(report()), s(null)]), 'unknown');
  });

  void test('the board note: owner or admin, and only when a helper is ahead of the board', () => {
    const ahead = updateStatus(
      manifest({ current: 2 }),
      report({ cli_commit: OLDER, protocol: 3 }),
    );
    const level = s(report());
    assert.match(boardBehindNote('owner', [ahead]) ?? '', /updated by whoever runs this instance/);
    assert.ok(boardBehindNote('admin', [ahead]));
    assert.equal(boardBehindNote('member', [ahead]), undefined);
    assert.equal(boardBehindNote(undefined, [ahead]), undefined);
    assert.equal(boardBehindNote('owner', [level]), undefined);
  });

  void test('sameCommit compares only hex, at the shorter length', () => {
    assert.equal(sameCommit(BOARD, BOARD.slice(0, 9)), true);
    assert.equal(sameCommit(BOARD, OLDER), false);
    assert.equal(sameCommit('main', 'main'), false);
  });
});

/**
 * The board #216 (LAI-1062) serves: protocol 2, `min_client` 1, pairing, tool
 * setup and client reports switched on, each needing 2; project setup off.
 */
function protocol2Board(): UpdateManifest {
  return manifest({
    current: 2,
    minClient: 1,
    features: { device_pairing: true, tool_setup_exchange: true, client_reports: true },
    minFor: { device_pairing: 2, tool_setup_exchange: 2, client_reports: 2, project_setups: 2 },
    notes: [
      { protocol: 1, summary: 'laika agent login, session hooks, laika connect and checkpoints.' },
      { protocol: 2, summary: 'laika device pair, laika tool add and client reports.' },
    ],
  });
}

void describe('against the protocol-2 board', () => {
  const board = protocol2Board();

  void test('a protocol-1 helper: required for each switched-on feature, never for project setup', () => {
    const s = updateStatus(board, report({ cli_commit: OLDER, protocol: 1 }));
    assert.equal(s.key, 'required');
    assert.equal(
      s.word,
      'Update required for pairing devices, adding tools without a secret, version reports',
    );
    assert.doesNotMatch(s.word, /project setup/);
    // Three features need it: plural agreement, and one feature stays singular.
    assert.match(s.reason, /version reports need helper protocol 2; this one speaks 1\./);
    assert.equal(offersUpdate(s.key), true);
    assert.deepEqual(
      whatsNew(board, report({ protocol: 1 })).map((l) => l.newForTool),
      [false, true],
    );
  });

  void test('a protocol-2 helper: Up to date on the board’s commit, and on any other', () => {
    assert.equal(
      updateStatus(board, report()).reason,
      'Runs the helper this board offers, cea011d',
    );
    const other = updateStatus(board, report({ cli_commit: OLDER }));
    assert.equal(other.key, 'up-to-date');
    assert.equal(offersUpdate(other.key), false);
  });

  void test('no report is Version unknown; a newer helper is Up to date and ahead', () => {
    assert.equal(updateStatus(board, null).key, 'unknown');
    const ahead = updateStatus(board, report({ cli_commit: OLDER, protocol: 3 }));
    assert.equal(ahead.key, 'up-to-date');
    assert.equal(ahead.aheadOfBoard, true);
  });
});

/**
 * The watch after *Copy update command* (review round 1, N1), on a clock the
 * test owns: each wait is read off the timer it set, and a timer runs only
 * when the test fires it.
 */
function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; ms: number; run: () => void }>();
  const clock: WatchClock = {
    now: () => t,
    set: (run, ms) => {
      id += 1;
      timers.set(id, { at: t + ms, ms, run });
      return id;
    },
    clear: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    pending: () => timers.size,
    /** Fire the one pending timer: move the clock to it, run it, let its read answer. */
    async fire(): Promise<number> {
      const [key, timer] = [...timers.entries()][0] ?? [];
      assert.ok(key !== undefined && timer !== undefined, 'a timer is pending');
      timers.delete(key);
      t = timer.at;
      timer.run();
      await new Promise((done) => setImmediate(done));
      return timer.ms;
    },
  };
}

void describe('the watch after a copy', () => {
  void test('15 s, 30 s, 60 s, then 2 minutes each; gives up past 30 minutes, after 18 reads', async () => {
    const f = fakeClock();
    let reads = 0;
    const ended: unknown[] = [];
    watchForReport(
      () => {
        reads += 1;
        return Promise.resolve(undefined);
      },
      f.clock,
      (found) => ended.push(found),
    );
    const waits: number[] = [];
    while (f.pending() > 0) waits.push(await f.fire());
    assert.deepEqual(waits.slice(0, 6), [
      WATCH_FIRST_MS,
      30_000,
      60_000,
      WATCH_CAP_MS,
      WATCH_CAP_MS,
      WATCH_CAP_MS,
    ]);
    assert.ok(
      waits.every((ms) => ms <= WATCH_CAP_MS),
      'never past the cap',
    );
    // Reads at 15, 45 and 105 s, then every 120 s until one lands at or past
    // the limit (105 + 120·15 = 1905 s ≥ 1800 s): 3 + 15 = 18.
    assert.equal(WATCH_LIMIT_MS, 1_800_000);
    assert.equal(reads, 18);
    assert.equal(
      waits.reduce((a, b) => a + b, 0),
      1_905_000,
    );
    assert.deepEqual(ended, [undefined]);
    assert.equal(f.pending(), 0, 'nothing left running once it gave up');
  });

  void test('stops at the first new report and hands it over', async () => {
    const f = fakeClock();
    let reads = 0;
    const ended: unknown[] = [];
    watchForReport(
      () => {
        reads += 1;
        return Promise.resolve(reads === 3 ? 'new report' : undefined);
      },
      f.clock,
      (found) => ended.push(found),
    );
    while (f.pending() > 0) await f.fire();
    assert.equal(reads, 3);
    assert.deepEqual(ended, ['new report']);
  });

  void test('a read that fails is not news: it waits and reads again', async () => {
    const f = fakeClock();
    let reads = 0;
    watchForReport(
      () => {
        reads += 1;
        return reads === 1 ? Promise.reject(new Error('offline')) : Promise.resolve('ok');
      },
      f.clock,
      () => undefined,
    );
    await f.fire();
    assert.equal(f.pending(), 1);
    assert.equal(await f.fire(), 30_000);
    assert.equal(reads, 2);
  });

  void test('cancel clears the pending wait: no read, no end, nothing left running', async () => {
    const f = fakeClock();
    let reads = 0;
    let ended = false;
    const w = watchForReport(
      () => {
        reads += 1;
        return Promise.resolve(undefined);
      },
      f.clock,
      () => {
        ended = true;
      },
    );
    await f.fire();
    assert.equal(f.pending(), 1);
    w.cancel();
    assert.equal(f.pending(), 0);
    assert.equal(reads, 1);
    assert.equal(ended, false);
  });

  void test('cancel while a read is on its way: its answer sets no new wait', async () => {
    const f = fakeClock();
    let answer: (v: string | undefined) => void = () => undefined;
    let ended = false;
    const w = watchForReport(
      () =>
        new Promise<string | undefined>((done) => {
          answer = done;
        }),
      f.clock,
      () => {
        ended = true;
      },
    );
    await f.fire();
    w.cancel();
    answer('late');
    await new Promise((done) => setImmediate(done));
    assert.equal(f.pending(), 0);
    assert.equal(ended, false);
  });
});

void describe('versionChip — the version on a list row (LAI-1083)', () => {
  void test('every status says itself in two words; the update ones as before', () => {
    assert.deepEqual(versionChip('up-to-date'), {
      key: 'up-to-date',
      word: 'Helper up to date',
      tone: 'ok',
    });
    assert.deepEqual(versionChip('available'), {
      key: 'available',
      word: 'Update available',
      tone: 'accent',
    });
    assert.deepEqual(versionChip('required'), {
      key: 'required',
      word: 'Update required',
      tone: 'danger',
    });
    assert.deepEqual(versionChip('unknown'), {
      key: 'unknown',
      word: 'Version unknown',
      tone: 'neutral',
    });
    assert.deepEqual(versionChip('unchecked'), {
      key: 'unchecked',
      word: 'Could not check',
      tone: 'neutral',
    });
  });

  void test('nothing while it is still being read, or with nothing to read', () => {
    assert.equal(versionChip('checking'), undefined);
    assert.equal(versionChip(undefined), undefined);
  });

  void test('a device speaks for all of its tools', () => {
    assert.equal(versionChip('up-to-date', 3)?.word, 'Helpers up to date');
    assert.equal(versionChip('up-to-date', 1)?.word, 'Helper up to date');
    assert.equal(versionChip('required', 3)?.word, 'Update required');
  });
});

void describe('reportedHelper — the version a tool reported (LAI-1083)', () => {
  const report = (cliVersion: string | null) => ({
    cli_version: cliVersion,
    cli_commit: null,
    protocol: 2,
    capabilities: [],
    harness_version: null,
    harness: null,
    reported_at: null,
    self_reported: true as const,
  });

  void test('a reported version is the line’s words', () => {
    assert.equal(reportedHelper(report('0.1.0')), 'helper 0.1.0');
    assert.equal(reportedHelper(report('  0.2.1 ')), 'helper 0.2.1');
  });

  void test('no report, an empty version, a failed or pending read: nothing', () => {
    assert.equal(reportedHelper(report(null)), undefined);
    assert.equal(reportedHelper(report('  ')), undefined);
    assert.equal(reportedHelper(null), undefined);
    assert.equal(reportedHelper('failed'), undefined);
    assert.equal(reportedHelper(undefined), undefined);
  });
});

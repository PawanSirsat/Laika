import { describe, expect, it } from 'vitest';
import {
  compatibility,
  FEATURE_NAMES,
  FEATURE_ROUTES,
  PROTOCOL,
  servedFeatures,
} from '../../src/services/developer-compat.ts';

/**
 * The compatibility body (SPEC §6.4, LAI-1043). The route is asserted in
 * `http/routes/developer.test.ts`.
 */

/** Every route every feature names, as a full build mounts them. */
const ALL_ROUTES = Object.values(FEATURE_ROUTES).flat();

const INPUT = {
  version: '1.2.3',
  buildCommit: 'abc1234',
  developerAccess: 'classic',
  cliSourceUrl: 'https://github.com/PawanSirsat/Laika.git',
  servedRoutes: ALL_ROUTES,
} as const;

describe('compatibility()', () => {
  it('carries exactly the documented top-level keys', () => {
    expect(Object.keys(compatibility(INPUT)).sort()).toEqual([
      'cli',
      'features',
      'protocol',
      'release_notes',
      'server',
    ]);
  });

  it('serves a closed feature set, by name', () => {
    const { features } = compatibility(INPUT);

    // Names, not a count (CLAUDE.md §2): a feature added without this test
    // updated fails here, and so does one renamed.
    expect(Object.keys(features).sort()).toEqual([
      'client_reports',
      'developer_access',
      'device_pairing',
      'project_setups',
      'tool_setup_exchange',
    ]);
    expect([...FEATURE_NAMES].sort()).toEqual([
      'client_reports',
      'device_pairing',
      'project_setups',
      'tool_setup_exchange',
    ]);
    expect(features.developer_access).toBe('classic');
  });

  it('turns a feature on exactly when every route it names is served (LAI-1062)', () => {
    expect(servedFeatures(ALL_ROUTES)).toEqual({
      device_pairing: true,
      tool_setup_exchange: true,
      client_reports: true,
      project_setups: false,
    });
    expect(Object.values(servedFeatures([])).some(Boolean)).toBe(false);

    // One route missing is enough to turn its feature off, and only its own.
    for (const name of FEATURE_NAMES) {
      for (const route of FEATURE_ROUTES[name]) {
        const served = servedFeatures(ALL_ROUTES.filter((r) => r !== route));
        expect(served[name], `${name} without ${route}`).toBe(false);
        for (const other of FEATURE_NAMES.filter((n) => n !== name)) {
          expect(served[other], `${other} without ${route}`).toBe(FEATURE_ROUTES[other].length > 0);
        }
      }
    }
  });

  it('keeps project setups off: it has no server-side record, so no route names it', () => {
    expect(FEATURE_ROUTES.project_setups).toEqual([]);
    expect(compatibility(INPUT).features.project_setups).toBe(false);
  });

  // Plan §F.3: a helper too old for a feature that is on is told to update for
  // that feature, never refused outright — so every feature that is on needs a
  // protocol this board speaks, and the oldest helper is still in range.
  it('keeps a protocol-1 helper in range while naming protocol 2 for what is on', () => {
    const body = compatibility(INPUT);

    expect(body.protocol).toEqual({ current: 2, min_client: 1 });
    for (const name of FEATURE_NAMES) {
      if (!body.features[name]) continue;
      expect(body.cli.min_protocol_for[name], name).toBeLessThanOrEqual(body.protocol.current);
      expect(body.cli.min_protocol_for[name], name).toBeGreaterThan(1);
    }
    expect(body.release_notes.whats_new.map((e) => e.protocol)).toEqual([1, 2]);
  });

  it('passes each Developer access mode through', () => {
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      expect(compatibility({ ...INPUT, developerAccess: mode }).features.developer_access).toBe(
        mode,
      );
    }
  });

  it('names the protocol range a helper must speak, and the minimum per feature', () => {
    const body = compatibility(INPUT);

    expect(body.protocol).toEqual({ current: PROTOCOL.current, min_client: PROTOCOL.minClient });
    expect(body.protocol.min_client).toBeLessThanOrEqual(body.protocol.current);
    // One place says the range (SPEC §6.4): `cli` does not repeat it.
    expect(Object.keys(body.cli).sort()).toEqual(['min_protocol_for', 'source']);
    expect(Object.keys(body.cli.min_protocol_for).sort()).toEqual([...FEATURE_NAMES].sort());
    // A feature that is off may need a later protocol; none may need one
    // older than the oldest a board accepts.
    for (const name of FEATURE_NAMES) {
      expect(body.cli.min_protocol_for[name]).toBeGreaterThanOrEqual(body.protocol.min_client);
    }
  });

  it('points the CLI at the board’s own commit, and the release notes at the same ref', () => {
    const body = compatibility(INPUT);

    expect(body.cli.source).toEqual({
      type: 'git',
      url: INPUT.cliSourceUrl,
      commit: 'abc1234',
      path: 'cli',
    });
    expect(body.release_notes.ref).toBe('abc1234');
    expect(body.release_notes.whats_new.map((e) => e.protocol)).toContain(PROTOCOL.current);
  });

  it('leaves the commit null everywhere when the build did not say', () => {
    const body = compatibility({ ...INPUT, buildCommit: null });

    expect(body.server.build_commit).toBeNull();
    expect(body.cli.source.commit).toBeNull();
    expect(body.release_notes.ref).toBeNull();
  });

  // The route builds its body once, so this guards a second `compatibility()`
  // call against an earlier caller's edits to the shared constants, not the
  // route's cached body.
  it('returns new objects each call, so editing one result leaves the next unchanged', () => {
    const first = compatibility(INPUT);
    first.cli.min_protocol_for.device_pairing = 99;
    first.release_notes.whats_new.push({ protocol: 99, summary: 'x' });

    const second = compatibility(INPUT);
    expect(second.cli.min_protocol_for.device_pairing).toBe(2);
    expect(second.release_notes.whats_new.map((e) => e.protocol)).not.toContain(99);
  });
});

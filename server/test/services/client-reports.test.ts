import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAST_USED_THROTTLE_MS } from '../../src/auth/tokens.ts';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { agentClientReports, agents, tokens } from '../../src/db/schema.ts';
import { recordMcpClientReport, reportClient } from '../../src/services/client-reports.ts';
import { insertToken } from '../../src/services/tokens.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/client-reports.ts` (SPEC §4.81, LAI-1056): what an agent's own
 * client says it is. The HTTP half, with the schema's refusals, is
 * `test/http/routes/tool-setup.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function agentToken(harness: string): { agentId: string; tokenId: string } {
  const agentId = newId();
  t.db
    .insert(agents)
    .values({
      id: agentId,
      orgId: s.orgId,
      ownerUserId: s.userId,
      displayName: harness,
      harness,
      status: 'active',
      createdAt: NOW,
    })
    .run();
  const minted = insertToken(t.db, owner, {
    name: harness,
    scope: 'full',
    projectIds: null,
    expiresAt: null,
    agentId,
    now: NOW,
  });
  return { agentId, tokenId: minted.token.id };
}

function report(agentId: string) {
  return t.db
    .select()
    .from(agentClientReports)
    .where(eq(agentClientReports.agentId, agentId))
    .get();
}

describe('the MCP initialize report', () => {
  it('keeps the client’s own slug, never the agent’s harness or the token’s name', () => {
    const { agentId, tokenId } = agentToken('omnigent');
    // Omnigent says `mcp`: the slug that name alone gives is `other`, so the
    // board never takes the owner's word for what connected.
    expect(recordMcpClientReport(t.db, tokenId, NOW, 'mcp', '1.0')).toBe(true);
    expect(report(agentId)).toMatchObject({ clientName: 'mcp', clientSlug: 'other' });
  });

  it('writes nothing for a personal token, or a call that is not initialize', () => {
    const personal = insertToken(t.db, owner, {
      name: 'claude-code on macOS',
      scope: 'full',
      projectIds: null,
      expiresAt: null,
      agentId: null,
      now: NOW,
    });
    expect(recordMcpClientReport(t.db, personal.token.id, NOW, 'claude-code', '2')).toBe(false);
    const { tokenId } = agentToken('claude-code');
    expect(recordMcpClientReport(t.db, tokenId, NOW, undefined, undefined)).toBe(false);
    expect(t.db.select().from(agentClientReports).all()).toEqual([]);
  });

  it('writes at most once a throttle for the same word, and at once for a new one', () => {
    const { agentId, tokenId } = agentToken('claude-code');
    expect(recordMcpClientReport(t.db, tokenId, NOW, 'claude-code', '2.1')).toBe(true);
    expect(recordMcpClientReport(t.db, tokenId, NOW + 1000, 'claude-code', '2.1')).toBe(false);
    expect(recordMcpClientReport(t.db, tokenId, NOW + 2000, 'claude-code', '2.2')).toBe(true);
    expect(
      recordMcpClientReport(
        t.db,
        tokenId,
        NOW + 2000 + LAST_USED_THROTTLE_MS,
        'claude-code',
        '2.2',
      ),
    ).toBe(true);
    expect(report(agentId)?.reportedAt).toBe(NOW + 2000 + LAST_USED_THROTTLE_MS);
  });

  it('cleans what it keeps: no control characters, at most 64 characters', () => {
    const { agentId, tokenId } = agentToken('claude-code');
    recordMcpClientReport(t.db, tokenId, NOW, `claude‮-code${'x'.repeat(100)}`, 7);
    const row = report(agentId);
    expect(row?.clientName).not.toContain('‮');
    expect(Array.from(row?.clientName ?? '').length).toBeLessThanOrEqual(64);
    expect(row?.clientVersion).toBeNull();
  });
});

describe('the CLI report', () => {
  it('stores the capabilities sorted and once each, on the reporting token', () => {
    const { agentId, tokenId } = agentToken('claude-code');
    const token = t.db.select().from(tokens).where(eq(tokens.id, tokenId)).get()!;
    const actor: ResolvedActor = {
      ...owner,
      token: {
        id: token.id,
        scope: 'full',
        projectIds: null,
        expiresAt: null,
        agent: {
          id: agentId,
          displayName: 'claude-code',
          harness: 'claude-code',
          deviceLabel: null,
          status: 'active',
          grants: new Map(),
        },
      },
    };
    const view = reportClient(
      t.db,
      actor,
      { cliVersion: '0.9.0', protocol: 2, capabilities: ['update', 'claims', 'update'] },
      NOW,
    );
    expect(view.capabilities).toEqual(['claims', 'update']);
    expect(report(agentId)).toMatchObject({ source: 'cli', tokenId, reportedAt: NOW });
  });
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { tokens } from '../../src/db/schema.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import { draftsOn, proposeTimeDraft, recordTimeDrafts } from '../../src/services/time-drafts.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Which agent proposed a draft (LAI-835): a copy of the proposing token's
 * client name as the board knew it then — D-076's `last_client_name`, else the
 * token's own name — never anything the proposal says, and nothing for a
 * collector's block.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

let t: TestDb;
let owner: ResolvedActor;

/** The owner through a token named `name` whose agent last called itself `client`. */
function viaToken(name: string, client: string | null): ResolvedActor & { tokenId: string } {
  const id = newId();
  t.db
    .insert(tokens)
    .values({
      id,
      userId: owner.userId,
      name,
      prefix: 'lai_test',
      tokenHash: `${id}-hash`,
      scope: 'full',
      projectIdsJson: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      lastClientName: client,
      createdAt: NOW,
    })
    .run();
  return { ...owner, token: { id, scope: 'full', projectIds: null }, tokenId: id };
}

const clients = () => draftsOn(t.db, owner.userId, DAY).map((d) => [d.source, d.client]);

beforeEach(() => {
  t = freshDb();
  const loaded = loadActor(t.db, seed(t.db, NOW).userId);
  if (loaded === null) throw new Error('no owner');
  owner = loaded;
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time', now: NOW }); // LAI-1
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, owner, { draft_my_time: true }, NOW);
});

afterEach(() => {
  t.close();
});

describe('which agent proposed a draft', () => {
  it('keeps the token’s client as the board knew it then, not as it is later', () => {
    const agent = viaToken('Claude Code on the laptop', 'claude-code');
    proposeTimeDraft(t.db, agent, { minutes: 30, task: 'LAI-1', day: DAY, tz: 'UTC' }, NOW);
    t.db.update(tokens).set({ lastClientName: 'codex' }).where(eq(tokens.id, agent.tokenId)).run();
    expect(clients()).toEqual([['agent', 'claude-code']]);
  });

  it('names an agent that never said `initialize` by its token’s name', () => {
    const agent = viaToken('Cursor on the desktop', null);
    proposeTimeDraft(t.db, agent, { minutes: 15, day: DAY, tz: 'UTC' }, NOW);
    expect(clients()).toEqual([['agent', 'Cursor on the desktop']]);
  });

  it('never takes the name from what the proposal says', () => {
    const agent = viaToken('Gemini', 'gemini-cli');
    proposeTimeDraft(
      t.db,
      agent,
      { minutes: 15, day: DAY, tz: 'UTC', note: 'proposed by claude-code' },
      NOW,
    );
    expect(clients()).toEqual([['agent', 'gemini-cli']]);
  });

  it('names no agent on a collector’s block', () => {
    const collector = viaToken('Collector', 'laika-cli');
    recordTimeDrafts(
      t.db,
      collector,
      {
        v: 1,
        collector_id: COLLECTOR,
        tz: 'UTC',
        days: [
          {
            day: DAY,
            blocks: [
              {
                start: Date.UTC(2026, 9, 20, 9),
                end: Date.UTC(2026, 9, 20, 10),
                minutes: 60,
                task: null,
                signals: { prompts: 1 },
              },
            ],
          },
        ],
      },
      NOW,
    );
    expect(clients()).toEqual([['collector', null]]);
  });

  it('is served on the draft in My day, the person’s own', () => {
    proposeTimeDraft(t.db, viaToken('A', 'claude-code'), { minutes: 10, day: DAY, tz: 'UTC' }, NOW);
    expect(getMyDay(t.db, owner, { day: DAY, tz: 'UTC' }, NOW).drafts.map((d) => d.client)).toEqual(
      ['claude-code'],
    );
  });
});

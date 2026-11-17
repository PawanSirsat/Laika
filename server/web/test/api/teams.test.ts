/**
 * `src/api/teams.ts` — Teams posting (D-154, LAI-1314): each call's method,
 * path and body, a refusal in words, and how a post is described.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../src/api/errors.ts';
import {
  channelLine,
  clearProjectTeamsChannel,
  getProjectTeams,
  getTeamsSettings,
  postKindWords,
  postOutcomeWords,
  postTone,
  scheduleLine,
  sendTeamsTestPost,
  setProjectTeamsChannel,
  setTeamsPosting,
  teamsRefusal,
  whenLabel,
} from '../../src/api/teams.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const empty = init?.method === 'DELETE';
  return Promise.resolve(
    new Response(empty ? null : '{"posting_enabled":false,"channel":null,"recent":[]}', {
      status: empty ? 204 : 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

const URL_FIXTURE =
  'https://prod-27.westeurope.logic.azure.com:443/workflows/x/triggers/manual/paths/invoke?sig=fixture';

void describe('the calls (§6.4, LAI-1314)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getTeamsSettings();
    await setTeamsPosting(true);
    await getProjectTeams('murphy law');
    await setProjectTeamsChannel('murphy', URL_FIXTURE);
    await sendTeamsTestPost('murphy');
    await clearProjectTeamsChannel('murphy');

    assert.deepEqual(
      sent.map((r) => [r.method, r.url.replace(/^.*\/api\/v1/, ''), r.body]),
      [
        ['GET', '/org/teams', undefined],
        ['PUT', '/org/teams', { posting_enabled: true }],
        ['GET', '/projects/murphy%20law/teams', undefined],
        ['PUT', '/projects/murphy/teams', { webhook_url: URL_FIXTURE }],
        ['POST', '/projects/murphy/teams/test', undefined],
        ['DELETE', '/projects/murphy/teams', undefined],
      ],
    );
  });
});

void describe('a refusal, in words', () => {
  void test('names the reason the server gave, else its message', () => {
    const refused = (reason: string) =>
      new ApiError('unprocessable', 'raw server words', 422, { field: 'webhook_url', reason });
    assert.match(teamsRefusal(refused('webhook_url_not_https')), /https:\/\//);
    assert.match(teamsRefusal(refused('webhook_url_invalid')), /Power Automate/);
    assert.match(
      teamsRefusal(new ApiError('conflict', 'x', 409, { reason: 'teams_no_channel' })),
      /no Teams channel/,
    );
    assert.equal(teamsRefusal(refused('something_new')), 'raw server words');
    assert.match(teamsRefusal(new ApiError('rate_limited', 'x', 429)), /Too many test posts/);
    assert.equal(teamsRefusal(new NetworkError(null)), 'The request did not reach Laika.');
  });
});

void describe('a post, described', () => {
  const post = {
    kind: 'standup',
    event: 'evening',
    outcome: 'failed',
    reason: 'refused',
    http_status: 401,
  } as const;

  void test('says what kind of post it was', () => {
    assert.equal(postKindWords(post), 'Evening stand-up');
    assert.equal(postKindWords({ kind: 'standup', event: 'morning' }), 'Morning stand-up');
    assert.equal(postKindWords({ kind: 'digest', event: null }), 'Nightly digest');
    assert.equal(postKindWords({ kind: 'test', event: null }), 'Test post');
    assert.equal(postKindWords({ kind: 'notice', event: 'done' }), 'Notice');
  });

  void test('says what came of it, with Teams’ status when it answered', () => {
    assert.equal(postOutcomeWords(post), 'Refused by the flow (401)');
    assert.equal(
      postOutcomeWords({ outcome: 'suppressed', reason: 'posting_off', http_status: null }),
      'Held back — Teams posting is off',
    );
    assert.equal(postOutcomeWords({ outcome: 'sent', reason: null, http_status: 202 }), 'Sent');
    assert.equal(postTone(post), 'bad');
    assert.equal(postTone({ outcome: 'sent' }), 'on');
    assert.equal(postTone({ outcome: 'suppressed' }), 'off');
  });

  void test('names a channel by its host and last four, never its address', () => {
    assert.equal(
      channelLine({ host: 'prod-27.westeurope.logic.azure.com', last4: 'Wq3x' }),
      'prod-27.westeurope.logic.azure.com ···Wq3x',
    );
  });

  void test('says when the scheduled posts go', () => {
    assert.equal(
      scheduleLine({ standup_utc: ['05:30', '12:30'], digest_utc: '07:00' }),
      'Stand-ups at 05:30 and 12:30 UTC, Monday to Friday; the nightly digest at 07:00 UTC, daily.',
    );
  });

  void test('dates a post in the zone it is given', () => {
    assert.equal(whenLabel(Date.UTC(2026, 10, 18, 5, 30), 'UTC'), '18 Nov, 05:30');
    assert.equal(whenLabel(Date.UTC(2026, 10, 18, 5, 30), 'Asia/Kolkata'), '18 Nov, 11:00');
  });
});

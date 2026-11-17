import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors.ts';
import {
  checkTeamsWebhookUrl,
  isRetryable,
  isTeamsWebhookUrl,
  sendToTeams,
} from '../../src/services/teams-client.ts';
import { fakeTeams, TEAMS_URL, TEAMS_URL_2 } from '../helpers/fake-teams.ts';

/**
 * Posting to a Power Automate flow (D-154, LAI-1314), through a fake: **no
 * test calls Teams**. What is checked is the request KSage's flows accept,
 * that the answer is classified by whether a later attempt could post twice,
 * and that Teams' words never come back.
 */

const NOTICE = { title: 'LAI-7 is waiting for review', lines: ['Ship the thing — today'] };

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return (err.details as { reason?: string }).reason;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('a webhook address', () => {
  it('takes Power Automate’s two hosts and a Teams incoming webhook, as pasted', () => {
    for (const url of [
      TEAMS_URL,
      TEAMS_URL_2,
      'https://kvelld.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456',
    ]) {
      const address = checkTeamsWebhookUrl(`  ${url}  `);
      // Trimmed, never normalised: the flow is called as Power Automate wrote it.
      expect(address.url).toBe(url);
      expect(address.last4).toBe(url.slice(-4));
      expect(isTeamsWebhookUrl(url)).toBe(true);
    }
    expect(checkTeamsWebhookUrl(TEAMS_URL).host).toBe(
      'default0fixture.00.environment.api.powerplatform.com',
    );
  });

  it('refuses an address that is not https', () => {
    expect(reasonOf(() => checkTeamsWebhookUrl(TEAMS_URL.replace('https:', 'http:')))).toBe(
      'webhook_url_not_https',
    );
  });

  it('refuses any other host — the job would post a space’s work there every minute', () => {
    for (const url of [
      'https://localhost/workflows/x',
      'https://127.0.0.1/workflows/x',
      'https://169.254.169.254/latest/meta-data',
      'https://logic.azure.com.evil.example/workflows/x',
      'https://evil.example/?u=logic.azure.com',
      'https://powerplatform.com/x',
      'https://user:pass@prod-1.westeurope.logic.azure.com/workflows/x',
      'https://prod-1.westeurope.logic.azure.com:8443/workflows/x',
      'not a url',
    ]) {
      expect(
        reasonOf(() => checkTeamsWebhookUrl(url)),
        url,
      ).toBe('webhook_url_invalid');
      expect(isTeamsWebhookUrl(url), url).toBe(false);
    }
  });
});

describe('posting', () => {
  it('posts KSage’s payload: one ASCII-escaped text field, JSON, no redirects', async () => {
    const fake = fakeTeams();
    const result = await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl });

    expect(result).toEqual({ outcome: 'sent', httpStatus: 202 });
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req?.url).toBe(TEAMS_URL);
    expect(req?.method).toBe('POST');
    expect(req?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(req?.redirect).toBe('manual');
    expect(/^[\x00-\x7f]*$/.test(req?.body ?? '')).toBe(true);
    expect(req?.body).toBe(
      '{"text":"<b>LAI-7 is waiting for review</b><br>Ship the thing \\u2014 today"}',
    );
  });

  it('takes any 2xx as sent — Power Automate answers 202, not 200', async () => {
    const fake = fakeTeams();
    for (const status of [200, 202, 204]) {
      fake.answer = () => status;
      expect(await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl })).toEqual({
        outcome: 'sent',
        httpStatus: status,
      });
    }
  });

  it('calls a refusal final, and *not now* worth another attempt', async () => {
    const fake = fakeTeams();
    const cases = [
      [400, 'refused'],
      [401, 'refused'],
      [404, 'refused'],
      [302, 'refused'],
      [408, 'unavailable'],
      [429, 'unavailable'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ] as const;
    for (const [status, reason] of cases) {
      fake.answer = () => status;
      const result = await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl });
      expect(result, String(status)).toEqual({ outcome: 'failed', reason, httpStatus: status });
    }
    expect(isRetryable('unavailable')).toBe(true);
    expect(isRetryable('refused')).toBe(false);
  });

  it('retries a connection that never opened, and never one that may have arrived', async () => {
    const fake = fakeTeams();
    fake.answer = () => 'refused';
    const refused = await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl });
    expect(refused).toEqual({ outcome: 'failed', reason: 'unreachable', httpStatus: null });
    expect(isRetryable('unreachable')).toBe(true);

    fake.answer = () => 'dropped';
    const dropped = await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl });
    expect(dropped).toEqual({ outcome: 'failed', reason: 'no_answer', httpStatus: null });
    expect(isRetryable('no_answer')).toBe(false);
  });

  it('gives up on a flow that hangs, as an answer that may have arrived', async () => {
    const fake = fakeTeams();
    fake.answer = () => 'hang';
    const started = Date.now();
    const result = await sendToTeams(TEAMS_URL, NOTICE, {
      fetchImpl: fake.fetchImpl,
      timeoutMs: 30,
    });
    expect(result).toEqual({ outcome: 'failed', reason: 'no_answer', httpStatus: null });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('never repeats what Teams answered', async () => {
    const fake = fakeTeams();
    fake.answer = () => 400;
    const result = await sendToTeams(TEAMS_URL, NOTICE, { fetchImpl: fake.fetchImpl });
    // The fake's body says "flow said: …"; nothing of it is in the result.
    expect(JSON.stringify(result)).not.toContain('flow said');
  });
});

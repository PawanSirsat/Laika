import { describe, expect, it } from 'vitest';
import {
  CALENDARS_READ,
  GraphAnswerError,
  graphClient,
  type GraphClientOptions,
  GraphCredentialsError,
  type GraphToken,
  GraphUnavailableError,
  isClientId,
  isTenantId,
  readRoles,
  rolesOf,
} from '../../src/services/microsoft-graph.ts';
import {
  accessToken,
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
  graphEvent,
} from '../helpers/fake-graph.ts';

/**
 * The Microsoft Graph client (D-157, LAI-1316) against a fake identity
 * platform and Graph: the token and its cache, the calendar read and its
 * paging, and every failure named — never in Microsoft's words.
 */

const NOW = Date.UTC(2026, 10, 18, 12);
const FROM = Date.UTC(2026, 10, 17);
const TO = Date.UTC(2026, 10, 20);
const ADA = 'ada@kvelld.example';

function client(
  fake: FakeGraph,
  extra: Partial<GraphClientOptions> = {},
): ReturnType<typeof graphClient> {
  return graphClient({
    tenantId: GRAPH_TENANT,
    clientId: GRAPH_CLIENT,
    clientSecret: GRAPH_SECRET,
    fetchImpl: fake.fetchImpl,
    sleep: () => Promise.resolve(),
    timeoutMs: 50,
    now: () => NOW,
    ...extra,
  });
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

/** No Microsoft text in anything a caller could pass on. */
function sayNothingOfMicrosoft(err: Error): void {
  expect(err.message).not.toMatch(/MS-SECRET-WORDS|AADSTS/);
  expect(JSON.stringify((err as { details?: unknown }).details)).not.toMatch(
    /MS-SECRET-WORDS|AADSTS/,
  );
}

describe('ids', () => {
  it('takes a GUID or a domain for the tenant, and only a GUID for the client', () => {
    expect(isTenantId(GRAPH_TENANT)).toBe(true);
    expect(isTenantId('kvelld.onmicrosoft.com')).toBe(true);
    expect(isTenantId('common')).toBe(false);
    expect(isTenantId('evil.com/../x')).toBe(false);
    expect(isTenantId('a.b')).toBe(false);
    expect(isClientId(GRAPH_CLIENT)).toBe(true);
    expect(isClientId('kvelld.onmicrosoft.com')).toBe(false);
  });

  it('never fetches for a tenant that is not one', async () => {
    const fake = fakeGraph();
    const err = await refusal(client(fake, { tenantId: 'evil.example/x?' }).token());
    expect(err).toBeInstanceOf(GraphUnavailableError);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the token', () => {
  it('asks for the client-credentials grant on the tenant, and reads its roles', async () => {
    const fake = fakeGraph({ roles: ['User.Read.All', CALENDARS_READ] });
    const token = await client(fake).token();
    expect(token.roles).toEqual([CALENDARS_READ, 'User.Read.All']);
    expect(token.expiresAt).toBe(NOW + 3599 * 1000);
    const [req] = fake.of('token');
    expect(req?.url.href).toBe(
      `https://login.microsoftonline.com/${GRAPH_TENANT}/oauth2/v2.0/token`,
    );
    const form = new URLSearchParams(req?.body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: GRAPH_CLIENT,
      client_secret: GRAPH_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
  });

  it('keeps a token until five minutes before it lapses, then asks again', async () => {
    const fake = fakeGraph();
    const cache = new Map<string, GraphToken>();
    let now = NOW;
    const c = client(fake, { cache, now: () => now });
    const first = await c.token();
    now += 50 * 60 * 1000;
    expect(await c.token()).toBe(first);
    // A second client sharing the cache uses it too.
    expect(await client(fake, { cache, now: () => now }).token()).toBe(first);
    expect(fake.of('token')).toHaveLength(1);
    now = first.expiresAt - 4 * 60 * 1000;
    const second = await c.token();
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(fake.of('token')).toHaveLength(2);
  });

  it('asks for a new one when told to be fresh, and keeps that', async () => {
    const fake = fakeGraph({ roles: [] });
    const cache = new Map<string, GraphToken>();
    const c = client(fake, { cache });
    expect((await c.token()).roles).toEqual([]);
    fake.roles = [CALENDARS_READ];
    expect((await c.token()).roles).toEqual([]);
    expect((await c.token({ fresh: true })).roles).toEqual([CALENDARS_READ]);
    expect((await c.token()).roles).toEqual([CALENDARS_READ]);
    expect(fake.of('token')).toHaveLength(2);
  });

  it('says a refused secret, client or tenant is refused, in its own words', async () => {
    for (const extra of [
      { clientSecret: 'wrong-secret' },
      { clientId: '00000000-0000-4000-8000-000000000000' },
      { tenantId: '11111111-1111-4111-8111-111111111111' },
    ]) {
      const err = await refusal(client(fakeGraph(), extra).token());
      expect(err).toBeInstanceOf(GraphCredentialsError);
      expect((err as GraphCredentialsError).details).toMatchObject({
        reason: 'graph_credentials_refused',
      });
      sayNothingOfMicrosoft(err);
    }
  });

  it('reads no roles from a token that is not a readable JWT, and says it could not tell', () => {
    expect(readRoles('opaque')).toEqual({ roles: [], known: false });
    expect(readRoles('a.!!!.c')).toEqual({ roles: [], known: false });
    // A readable token with no `roles` claim has none — that is an answer.
    expect(readRoles(`h.${Buffer.from('{"aud":"x"}').toString('base64url')}.s`)).toEqual({
      roles: [],
      known: true,
    });
    expect(rolesOf('opaque')).toEqual([]);
    expect(rolesOf(accessToken(['B', 'A', 'A', 7 as unknown as string], 1))).toEqual(['A', 'B']);
  });
});

describe('a calendar', () => {
  it('reads the window in UTC with only the fields Laika uses', async () => {
    const at = Date.UTC(2026, 10, 18, 9);
    const fake = fakeGraph({
      calendars: { [ADA]: [graphEvent(at, { subject: 'Standup', minutes: 15 })] },
    });
    const read = await client(fake).calendarView(ADA, FROM, TO);
    expect(read).toEqual({
      events: [
        expect.objectContaining({
          subject: 'Standup',
          start: at,
          end: at + 15 * 60_000,
          isAllDay: false,
          showAs: 'busy',
          sensitivity: 'normal',
          response: 'accepted',
          isOnlineMeeting: false,
          location: 'Room 4',
        }),
      ],
    });
    const [req] = fake.of('calendarView');
    expect(req?.url.origin + req!.url.pathname).toBe(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ADA)}/calendarView`,
    );
    expect(req?.url.searchParams.get('startDateTime')).toBe(new Date(FROM).toISOString());
    expect(req?.url.searchParams.get('endDateTime')).toBe(new Date(TO).toISOString());
    // No join link, no body, no attendees: never asked for.
    expect(req?.url.searchParams.get('$select')?.split(',')).not.toEqual(
      expect.arrayContaining(['body']),
    );
    const selected = req?.url.searchParams.get('$select')?.split(',');
    expect(selected).toEqual([
      'id',
      'iCalUId',
      'subject',
      'start',
      'end',
      'isAllDay',
      'isCancelled',
      'showAs',
      'sensitivity',
      'responseStatus',
      'isOrganizer',
      // A boolean: Teams or not (D-157 item 3). The join link stays unasked.
      'isOnlineMeeting',
      'location',
    ]);
    for (const field of ['body', 'attendees', 'onlineMeeting', 'onlineMeetingUrl', 'webLink']) {
      expect(selected).not.toContain(field);
    }
    // UTC times, and ids that survive a move between folders (review F5).
    expect(req?.prefer).toBe('outlook.timezone="UTC", IdType="ImmutableId"');
    // A redirect is never followed: the token would go wherever it pointed.
    expect(fake.requests.map((r) => r.redirect)).toEqual(['error', 'error']);
    expect(req?.authorization).toBe(`Bearer ${fake.tokens[0] ?? ''}`);
  });

  it('follows every page', async () => {
    const at = Date.UTC(2026, 10, 18, 0);
    const rows = Array.from({ length: 230 }, (_, i) => graphEvent(at + i * 60_000, { minutes: 1 }));
    const fake = fakeGraph({ calendars: { [ADA]: rows } });
    const read = await client(fake).calendarView(ADA, FROM, TO);
    expect('events' in read && read.events).toHaveLength(230);
    expect(fake.of('calendarView')).toHaveLength(3);
  });

  it('refuses a redirect rather than follow it', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    const err = await refusal(
      client(fake, {
        fetchImpl: (input, init) =>
          init?.redirect === 'error'
            ? Promise.reject(new TypeError('fetch failed: redirect mode is set to error'))
            : fake.fetchImpl(input, init),
      }).calendarView(ADA, FROM, TO),
    );
    expect(err).toBeInstanceOf(GraphUnavailableError);
  });

  it('never follows a next link off Graph', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    fake.intercept = (req) =>
      req.kind === 'calendarView'
        ? new Response(
            JSON.stringify({ value: [], '@odata.nextLink': 'https://evil.example/v1.0/next' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : undefined;
    const err = await refusal(client(fake).calendarView(ADA, FROM, TO));
    expect(err).toBeInstanceOf(GraphAnswerError);
    expect(fake.of('calendarView')).toHaveLength(1);
  });

  it('gives up on a calendar that never ends', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    fake.intercept = (req) =>
      req.kind === 'calendarView'
        ? new Response(
            JSON.stringify({
              value: [],
              '@odata.nextLink': `${req.url.href.split('&$skiptoken')[0] ?? ''}&$skiptoken=x`,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : undefined;
    const err = await refusal(client(fake).calendarView(ADA, FROM, TO));
    expect(err).toBeInstanceOf(GraphAnswerError);
    expect(err.message).not.toMatch(/evil/);
    expect(fake.of('calendarView')).toHaveLength(20);
  });

  it('skips one person’s mailbox by reason — no calendar, not opened, not looked up — and keeps the token', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [], 'bea@kvelld.example': [] } });
    fake.denied.add('bea@kvelld.example');
    fake.refused.add('cy@kvelld.example');
    const cache = new Map<string, GraphToken>();
    const c = client(fake, { cache });
    expect(await c.calendarView('nobody@kvelld.example', FROM, TO)).toEqual({
      skipped: 'no_mailbox',
    });
    expect(await c.calendarView('bea@kvelld.example', FROM, TO)).toEqual({ skipped: 'denied' });
    expect(await c.calendarView('cy@kvelld.example', FROM, TO)).toEqual({ skipped: 'refused' });
    expect(await c.calendarView(ADA, FROM, TO)).toEqual({ events: [] });
    // One mailbox is one person, not the token: it stays.
    expect(cache.size).toBe(1);
    expect(fake.of('token')).toHaveLength(1);
  });

  it('skips a person whose read fails on a later page, rather than keep half', async () => {
    const at = Date.UTC(2026, 10, 18, 0);
    const rows = Array.from({ length: 150 }, (_, i) => graphEvent(at + i * 60_000, { minutes: 1 }));
    const fake = fakeGraph({ calendars: { [ADA]: rows } });
    fake.intercept = (req) =>
      req.kind === 'calendarView' && req.url.searchParams.has('$skiptoken')
        ? new Response('{}', { status: 403 })
        : undefined;
    expect(await client(fake).calendarView(ADA, FROM, TO)).toEqual({ skipped: 'denied' });
  });

  it('says a token Graph refuses is refused, and drops it so the next ask is new', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    const cache = new Map<string, GraphToken>();
    const c = client(fake, { cache });
    fake.intercept = (req) =>
      req.kind === 'calendarView'
        ? new Response('{"error":{"message":"MS-SECRET-WORDS"}}', { status: 401 })
        : undefined;
    const err = await refusal(c.calendarView(ADA, FROM, TO));
    expect(err).toBeInstanceOf(GraphCredentialsError);
    sayNothingOfMicrosoft(err);
    expect(cache.size).toBe(0);
    fake.intercept = null;
    expect(await c.calendarView(ADA, FROM, TO)).toEqual({ events: [] });
    expect(fake.of('token')).toHaveLength(2);
  });

  it('forgets its token when asked, so a grant made since is in the next one', async () => {
    const fake = fakeGraph({ roles: [] });
    const cache = new Map<string, GraphToken>();
    const c = client(fake, { cache });
    expect((await c.token()).roles).toEqual([]);
    fake.roles = [CALENDARS_READ];
    c.forget();
    expect((await c.token()).roles).toEqual([CALENDARS_READ]);
  });

  it('refuses an event with no id or no UTC time as a bad answer', async () => {
    const at = Date.UTC(2026, 10, 18, 9);
    for (const bad of [
      { id: '' },
      {
        start: { dateTime: '2026-11-18T09:00:00.0000000', timeZone: 'South Africa Standard Time' },
      },
      { end: { dateTime: 'soon', timeZone: 'UTC' } },
    ]) {
      const fake = fakeGraph({ calendars: { [ADA]: [] } });
      // Answered as is: the fake's own window filter would drop an unreadable time.
      fake.intercept = (req) =>
        req.kind === 'calendarView'
          ? new Response(JSON.stringify({ value: [{ ...graphEvent(at), ...bad }] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : undefined;
      expect(await refusal(client(fake).calendarView(ADA, FROM, TO))).toBeInstanceOf(
        GraphAnswerError,
      );
    }
  });
});

describe('waiting and failing', () => {
  it('asks once more after a 429, waiting what Retry-After says', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    let first = true;
    fake.intercept = (req) => {
      if (req.kind !== 'calendarView' || !first) return undefined;
      first = false;
      return new Response('{}', { status: 429, headers: { 'retry-after': '7' } });
    };
    const waits: number[] = [];
    const read = await client(fake, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).calendarView(ADA, FROM, TO);
    expect(read).toEqual({ events: [] });
    expect(waits).toEqual([7000]);
    expect(fake.of('calendarView')).toHaveLength(2);
  });

  it('gives up on a wait longer than thirty seconds, and on a second 503', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    fake.intercept = (req) =>
      req.kind === 'calendarView'
        ? new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
        : undefined;
    expect(await refusal(client(fake).calendarView(ADA, FROM, TO))).toBeInstanceOf(
      GraphUnavailableError,
    );
    expect(fake.of('calendarView')).toHaveLength(1);

    fake.intercept = (req) =>
      req.kind === 'calendarView' ? new Response('{}', { status: 503 }) : undefined;
    expect(await refusal(client(fake).calendarView(ADA, FROM, TO))).toBeInstanceOf(
      GraphUnavailableError,
    );
  });

  it('gives up on a Microsoft that hangs, and a refused connection', async () => {
    const fake = fakeGraph();
    fake.intercept = () => 'hang';
    const err = await refusal(client(fake).token());
    expect(err).toBeInstanceOf(GraphUnavailableError);
    expect((err as GraphUnavailableError).reached).toBe(true);

    const down = await refusal(
      client(fake, {
        fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
      }).token(),
    );
    expect(down).toBeInstanceOf(GraphUnavailableError);
    expect((down as GraphUnavailableError).reached).toBe(false);
  });

  it('names an unexpected status a bad answer, and a token with none', async () => {
    const fake = fakeGraph({ calendars: { [ADA]: [] } });
    fake.intercept = (req) =>
      req.kind === 'calendarView'
        ? new Response('{"error":{"message":"MS-SECRET-WORDS"}}', { status: 409 })
        : undefined;
    const err = await refusal(client(fake).calendarView(ADA, FROM, TO));
    expect(err).toBeInstanceOf(GraphAnswerError);
    sayNothingOfMicrosoft(err);

    fake.intercept = (req) =>
      req.kind === 'token' ? new Response('{"token_type":"Bearer"}', { status: 200 }) : undefined;
    expect(await refusal(client(fake).token())).toBeInstanceOf(GraphAnswerError);
  });
});

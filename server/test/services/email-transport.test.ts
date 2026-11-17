import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySmtpError,
  errorLine,
  noTransport,
  shortDetail,
  smtpTransport,
  tlsFor,
} from '../../src/services/email-transport.ts';

/**
 * How a message leaves, and what a failure means for trying again (D-153,
 * LAI-1312). The rule every branch below serves: **retry only what cannot
 * have been delivered**.
 */

/** A `nodemailer`-shaped error, as `smtp-connection` builds them. */
function smtpError(fields: Record<string, unknown>, message = 'failed'): Error {
  return Object.assign(new Error(message), fields);
}

describe('classifySmtpError', () => {
  it('reads a 5xx reply as refused for good, with the reply code as the code', () => {
    const outcome = classifySmtpError(
      smtpError(
        { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' },
        'Invalid login: 535 5.7.8 Authentication failed',
      ),
    );
    expect(outcome).toEqual({
      kind: 'refused',
      permanent: true,
      code: '535',
      detail: 'Invalid login: 535 5.7.8 Authentication failed',
    });
  });

  it('reads a 4xx reply as "not now": refused, not permanent', () => {
    const outcome = classifySmtpError(smtpError({ code: 'EENVELOPE', responseCode: 421 }));
    expect(outcome).toMatchObject({ kind: 'refused', permanent: false, code: '421' });
  });

  it('retries a timeout that ended before the message — connect, greeting, TLS upgrade', () => {
    for (const timeoutType of ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT']) {
      expect(classifySmtpError(smtpError({ code: 'ETIMEDOUT', timeoutType })), timeoutType).toEqual(
        { kind: 'unreachable', code: 'ETIMEDOUT', detail: 'failed' },
      );
    }
  });

  it('never retries a timeout once the session was underway: it may have arrived', () => {
    // nodemailer says `command: 'CONN'` for a socket timeout even during DATA,
    // which is why the phase is read from `timeoutType` and not `command`.
    const outcome = classifySmtpError(
      smtpError({ code: 'ETIMEDOUT', timeoutType: 'SOCKET_TIMEOUT', command: 'CONN' }),
    );
    expect(outcome).toEqual({ kind: 'indeterminate', code: 'ETIMEDOUT', detail: 'failed' });
  });

  it('retries what never connected — DNS, a refused port, no route — naming the cause', () => {
    expect(classifySmtpError(smtpError({ code: 'EDNS' }))).toMatchObject({
      kind: 'unreachable',
      code: 'EDNS',
    });
    for (const originalCode of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH']) {
      expect(classifySmtpError(smtpError({ code: 'ESOCKET', originalCode }))).toMatchObject({
        kind: 'unreachable',
        code: originalCode,
      });
    }
  });

  it('calls a dropped connection mid-exchange indeterminate', () => {
    expect(classifySmtpError(smtpError({ code: 'ECONNECTION' }))).toMatchObject({
      kind: 'indeterminate',
      code: 'ECONNECTION',
    });
    expect(
      classifySmtpError(smtpError({ code: 'ESOCKET', originalCode: 'ECONNRESET' })),
    ).toMatchObject({ kind: 'indeterminate', code: 'ESOCKET' });
  });

  it('refuses for good what configuration decided before any message', () => {
    for (const code of ['EAUTH', 'ENOAUTH', 'ECONFIG', 'EENVELOPE']) {
      expect(classifySmtpError(smtpError({ code })), code).toMatchObject({
        kind: 'refused',
        permanent: true,
        code,
      });
    }
  });

  it('treats something that is not an error at all as indeterminate, never as sent', () => {
    expect(classifySmtpError('boom')).toEqual({
      kind: 'indeterminate',
      code: 'EUNKNOWN',
      detail: '',
    });
  });

  it('masks the key wherever a reply echoes it', () => {
    const key = 'xsmtpsib-SECRET-1234';
    const outcome = classifySmtpError(
      smtpError({ code: 'EAUTH', responseCode: 535 }, `535 bad credentials for ${key}\nmore`),
      key,
    );
    expect(outcome).toMatchObject({ detail: '535 bad credentials for ***' });
    expect(JSON.stringify(outcome)).not.toContain(key);
  });
});

describe('the small helpers', () => {
  it('keeps the first line, at most 200 characters', () => {
    expect(shortDetail('a'.repeat(250))).toHaveLength(200);
    expect(shortDetail('first\r\nsecond')).toBe('first');
    expect(shortDetail(undefined)).toBe('');
  });

  it('fits a code and its reason into last_error’s 300 characters', () => {
    expect(errorLine('535', 'x'.repeat(400))).toHaveLength(300);
    expect(errorLine('535', 'bad')).toBe('535: bad');
  });

  it('uses implicit TLS on 465 and requires STARTTLS everywhere else', () => {
    expect(tlsFor(465)).toEqual({ secure: true, requireTLS: false });
    expect(tlsFor(587)).toEqual({ secure: false, requireTLS: true });
    expect(tlsFor(25)).toEqual({ secure: false, requireTLS: true });
  });

  it('noTransport refuses everything, so a forgotten recorder fails loudly', async () => {
    const outcome = await noTransport.send(
      {
        host: 'h',
        port: 587,
        username: 'u',
        password: 'p',
        fromAddress: 'a@b.c',
        fromName: 'n',
      },
      { to: 'x@y.z', subject: 's', text: 't', html: 'h', idempotencyKey: 'k' },
    );
    expect(outcome).toMatchObject({ kind: 'refused', permanent: true, code: 'ENOTRANSPORT' });
  });
});

describe('smtpTransport, against a local socket and nothing else', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((done) => {
      if (server === undefined) done();
      else server.close(() => done());
    });
    server = undefined;
  });

  /** A server that refuses at the greeting: `554`, the way a relay that will not serve says it. */
  async function refusingServer(): Promise<number> {
    server = createServer((socket) => {
      socket.end('554 5.3.2 Service not available\r\n');
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return address.port;
  }

  const message = { to: 'x@example.test', subject: 's', text: 't', html: 'h', idempotencyKey: 'k' };
  const config = (port: number) => ({
    host: '127.0.0.1',
    port,
    username: 'u',
    password: 'pw-not-real',
    fromAddress: 'a@example.test',
    fromName: 'Test',
  });

  it('reports a refusal at the greeting as refused for good, with the reply code', async () => {
    const port = await refusingServer();
    const outcome = await smtpTransport().send(config(port), message);
    expect(outcome).toMatchObject({ kind: 'refused', permanent: true, code: '554' });
  });

  it('reports a port nobody listens on as unreachable — safe to retry', async () => {
    // Take a free port, then let it go: nothing is listening there now.
    const port = await refusingServer();
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    const outcome = await smtpTransport().send(config(port), message);
    expect(outcome).toMatchObject({ kind: 'unreachable', code: 'ECONNREFUSED' });
  });
});

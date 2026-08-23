import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * First in the chain (SPEC §11.2): everything after it — the logger, the error
 * handler — needs an id to attribute its output to.
 *
 * An inbound `X-Request-Id` is honoured so a reverse proxy can correlate, but it
 * is length-capped and character-filtered: it ends up in logs and in 5xx bodies,
 * and an unbounded attacker-controlled string in a log line is how log injection
 * starts.
 */
const MAX_INBOUND_LENGTH = 128;
const SAFE_INBOUND = /^[A-Za-z0-9_.:-]+$/;

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header(REQUEST_ID_HEADER);
  const id =
    inbound !== undefined && inbound.length <= MAX_INBOUND_LENGTH && SAFE_INBOUND.test(inbound)
      ? inbound
      : randomUUID();

  c.set('requestId', id);
  c.header(REQUEST_ID_HEADER, id);

  await next();
});

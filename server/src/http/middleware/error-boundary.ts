import { createMiddleware } from 'hono/factory';
import { type AppEnv } from '../context.ts';

/**
 * The front half of the SPEC §11.2 `errorHandler` stage, not a stage of its own.
 *
 * Hono only routes `Error` instances to `app.onError`; anything else — a thrown
 * string, a rejected promise carrying a plain object, a library that throws its
 * own result type — propagates straight out of the dispatcher. Under
 * `@hono/node-server` that surfaces as an unhandled rejection and the client
 * gets a dropped connection instead of the `internal` envelope AC4 requires.
 *
 * Wrapping the throw preserves the original value on `cause`, so the log keeps
 * everything while the response still leaks nothing.
 */
export const errorBoundary = createMiddleware<AppEnv>(async (_c, next) => {
  try {
    await next();
  } catch (thrown) {
    if (thrown instanceof Error) throw thrown;

    throw new Error(`Non-Error value thrown: ${Object.prototype.toString.call(thrown)}`, {
      cause: thrown,
    });
  }
});

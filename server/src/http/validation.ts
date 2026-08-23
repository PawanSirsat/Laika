/**
 * Zod at every boundary (SPEC §6.3, §13.1).
 *
 * Two rules the helpers exist to enforce, rather than leaving to each handler:
 *
 *  - **Unknown body fields are rejected, never dropped.** A silently ignored
 *    field is a client that believes it set something and a server that did not
 *    — the failure surfaces much later, somewhere else, as missing data. §6.3
 *    calls for `unprocessable`, and `.strict()` is what produces it.
 *  - **The inferred type is the handler's argument type**, so validation and
 *    typing cannot drift apart.
 */

import { z } from 'zod';
import { ApiError } from './errors.ts';

export interface FieldIssue {
  path: string;
  message: string;
  code: string;
}

/** Flatten a zod error into something a client can act on field by field. */
export function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

function fail(where: string, error: z.ZodError): never {
  throw new ApiError('unprocessable', `Invalid ${where}`, { issues: toFieldIssues(error) });
}

/**
 * Parse a request body. Reject unknown keys.
 *
 * Takes an already-parsed value rather than the request, so it is usable from
 * MCP tools and webhook handlers too — the same validation for every entry point
 * is the point (§7.2).
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail('request body', result.error);
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail('query parameters', result.error);
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail('path parameters', result.error);
  return result.data;
}

/**
 * An object schema that refuses unknown keys.
 *
 * Use this rather than `z.object(...)` directly: zod's default is to strip
 * unknown keys silently, which is exactly the behaviour §6.3 forbids.
 */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape);
}

/** A JSON body that is not an object at all is a client error worth naming. */
export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('unprocessable', 'Request body must be a JSON object', {
      received: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    });
  }
  return value as Record<string, unknown>;
}

export { z };

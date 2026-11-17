import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  clearEmailSettings,
  type EmailSettingsView,
  type EmailTestView,
  getEmailSettings,
  sendTestEmail,
  setEmailSettings,
} from '../../services/email-settings.ts';
import { type MailTransport } from '../../services/email-transport.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * The organisation's Email card (§6.4, D-153, LAI-1312), mounted on
 * `/api/v1/org`.
 *
 * Transport only (CONVENTIONS §2): who may — `org.email.configure`, signed in
 * only — and every rule are the service's. `POST /email/test` spends a small
 * bucket of its own (`email-test:<who>`), because each one opens a connection
 * to the mail server.
 *
 * **The key is in one request body and nowhere else**: validated, handed to the
 * service, and never logged — the request logger records the path and status.
 */

const SettingsBody = strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(320),
  // Absent keeps the stored key; there is no way to read it back to resend it.
  password: z.string().trim().min(1).max(500).optional(),
  from_address: z.string().trim().min(3).max(320),
  from_name: z.string().trim().min(1).max(80),
});

export interface EmailRouteOptions {
  db: Db;
  /** `LAIKA_SECRET`, for §12's encryption of the key. */
  serverSecret: string;
  /** `LAIKA_PUBLIC_URL`, which every link in a message is built from. */
  publicUrl?: string | undefined;
  /** How a message leaves: `smtpTransport()` in the app, a recorder in the tests. */
  transport: MailTransport;
}

export function emailRoutes(options: EmailRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret, transport } = options;
  const publicUrl = options.publicUrl ?? '';

  app.get('/email', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<EmailSettingsView>(getEmailSettings(db, actor, publicUrl));
  });

  app.put('/email', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(SettingsBody, await c.req.json().catch(() => null));
    return c.json<EmailSettingsView>(
      setEmailSettings(db, actor, body, serverSecret, publicUrl, Date.now()),
    );
  });

  app.delete('/email', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    clearEmailSettings(db, actor);
    return c.body(null, 204);
  });

  /** `200` whether the server took it or not: the answer is the result. */
  app.post('/email/test', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<EmailTestView>(await sendTestEmail(db, actor, serverSecret, transport));
  });

  return app;
}

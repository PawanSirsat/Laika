import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  getTimeReport,
  REPORT_DRAFTS,
  type TimeReportCsv,
  timeReportCsv,
  type TimeReportView,
} from '../../services/time-report.ts';
import { type AppEnv } from '../context.ts';
import { parseQuery, strictObject, z } from '../validation.ts';

/**
 * `GET /api/v1/time/report` (D-130, LAI-1135): the Time report, JSON or CSV.
 *
 * Transport only. Which scope the caller gets, and every refusal — `403`,
 * `session_required`, `members_not_allowed`, `drafts_not_allowed`,
 * `range_too_long`, `report_too_large` — is the service's, asked of `can()`.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day is YYYY-MM-DD');
// Comma lists, bounded here only to a sanity size; the service reads each item.
const list = z.string().max(8000);

export const TimeReportQuery = strictObject({
  from: day,
  to: day,
  spaces: list.optional(),
  members: list.optional(),
  kinds: list.optional(),
  drafts: z.enum(REPORT_DRAFTS).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** The file, pulled a line at a time, as `/activity/history?format=csv` sends its own. */
function csvResponse(csv: TimeReportCsv): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = csv.lines.next();
      if (next.done === true) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      csv.lines.return(undefined);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csv.filename}"`,
    },
  });
}

export function timeReportRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/report', (c) => {
    const actor = requireActor(c);
    const { format, ...query } = parseQuery(TimeReportQuery, c.req.query());
    if (format === 'csv') return csvResponse(timeReportCsv(db, actor, query));
    return c.json<TimeReportView>(getTimeReport(db, actor, query));
  });

  return app;
}

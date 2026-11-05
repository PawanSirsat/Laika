/**
 * LAI-1127: strings that occur **only** in the sample arrays of the owner's
 * Usage & cost design (`.polly/designs/insights-usage-cost.html`) — its
 * spaces, people, task keys and titles, model names and dollar figures —
 * never Laika's own words. None may ship: `no-prototype-data.test.ts` looks in
 * the source and the bundle, `browser/usage.test.ts` on the drawn page.
 */
export const PROTOTYPE_SAMPLES = [
  // Spaces and people the prototype invents.
  'Skynet',
  'SKYNET-73',
  'SynQ',
  'SYNQ-20',
  'Yashraaj',
  // Its task keys and titles.
  'LAIKA-934',
  'LAIKA-986',
  'Prod release via',
  'Rail polish',
  'Supplier ID',
  'Rate Upload',
  // Its models.
  'claude-haiku-5-5',
  'claude-opus-4-7',
  // Its headline figures.
  '$7,149',
  '$80,370',
  '$2,481',
  '$30,658',
  '20.1B',
  '12.7M',
] as const;

/**
 * LAI-1138: strings that occur only in the sample data of the owner's Time
 * report design (`.polly/designs/laika-time-report.html`, the `TimeReport`
 * component's MEMBERS, SPACES, PROJECTS and ITEMS) — its people, spaces,
 * sub-projects, task keys and titles, and the organisation it names. Every
 * figure and name the shipped report draws comes from `GET /time/report`.
 * `components/time-report/no-prototype-data.test.ts` looks in the source and
 * the bundle; `browser/time-report.test.ts` on the drawn page.
 */
export const TIME_REPORT_SAMPLES = [
  // People.
  'Hemant Purohit',
  'Amara Okafor',
  'Lindiwe Dube',
  'Riya Menon',
  'Thabo Nkosi',
  // The organisation and the design's sub-projects (D-130 item 4: none exist).
  'Kvell Dynamics',
  'Payments API',
  'Sync engine',
  'Driver app',
  'Time & My day',
  // Task keys and titles.
  'SAUCE-201',
  'SAUCE-214',
  'SYNQ-88',
  'ONR-341',
  'Refund webhooks',
  'Checkout address autocomplete',
  'Idempotency keys on payouts',
  'Conflict resolution for offline edits',
  'Offline route cache',
  'Basket totals rounding',
  'Swimlane filters',
] as const;

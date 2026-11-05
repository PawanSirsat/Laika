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

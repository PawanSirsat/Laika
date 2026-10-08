/**
 * The geometry of a donut chart (LAI-711), kept apart from the component so it
 * can be tested without a renderer (CONVENTIONS §4).
 *
 * Every measure is in **hundredths of the ring**: the component draws each
 * slice as a `<circle pathLength="100">`, so a slice of 25 is a quarter of the
 * circumference whatever the radius, and `stroke-dasharray` reads directly in
 * these units.
 */

export interface Arc {
  /** Where the slice starts, from the top, clockwise. */
  readonly start: number;
  /** How much of the ring it covers, after the gap between slices. */
  readonly length: number;
  /** Its share of the whole, rounded so that every share adds up to 100. */
  readonly percent: number;
}

/**
 * Whole percentages that add up to exactly 100 — the largest-remainder method.
 *
 * Rounding each share on its own gives 33 + 33 + 33 = 99 for three equal
 * slices, and a legend whose percentages do not add up reads as a bug.
 * Nothing at all (every value zero) is every share zero, not a division by
 * zero.
 */
export function roundedPercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total === 0) return values.map(() => 0);

  const exact = values.map((v) => (Math.max(0, v) / total) * 100);
  const floors = exact.map((e) => Math.floor(e));
  let short = 100 - floors.reduce((sum, f) => sum + f, 0);

  // Hand the missing points to the largest remainders, earliest first on a tie.
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (short <= 0) break;
    if ((values[i] ?? 0) <= 0) continue;
    floors[i] = (floors[i] ?? 0) + 1;
    short -= 1;
  }
  return floors;
}

/**
 * One arc per value, in order, clockwise from the top.
 *
 * `gap` is the space left between neighbouring slices. A lone slice is a full
 * ring with no gap, since there is nothing to separate it from. A slice smaller
 * than the gap still shows as a sliver rather than vanishing: a person with one
 * task is still on the chart.
 */
export function donutArcs(values: readonly number[], gap = 0.8): Arc[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  const percents = roundedPercents(values);
  const visible = values.filter((v) => v > 0).length;
  const spacing = visible > 1 ? gap : 0;

  let at = 0;
  return values.map((raw, i) => {
    const share = total === 0 ? 0 : (Math.max(0, raw) / total) * 100;
    const length = share === 0 ? 0 : Math.max(share - spacing, Math.min(share, 0.6));
    const arc = { start: at + spacing / 2, length, percent: percents[i] ?? 0 };
    at += share;
    return arc;
  });
}

/**
 * A legend's percentage: `38%`, or `<1%` for a share that rounds to nothing —
 * a person holding one task of four hundred is not holding 0% of the work.
 */
export function percentLabel(percent: number, value: number): string {
  return percent === 0 && value > 0 ? '<1%' : `${String(percent)}%`;
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';
import {
  backtest,
  fitModel,
  readSignals,
  type History,
} from '../../src/services/estimate-model.ts';
import { reportDiscovery } from '../helpers/discovery.ts';

/**
 * The size model replayed over the board's own finished work (D-085, LAI-771).
 *
 * The Laika board's history is this repository's `.tasks/done/` — sprints 1–8
 * were imported from it, and the R&D back-test (`task-estimation/REPORT.md`)
 * measured the same files. Each task is predicted **only from tasks that had
 * finished before it started**, by the production `backtest`, and compared with
 * the plain project median over the same tasks.
 *
 * ## Why a cut-off date
 *
 * D-037: a guard asserts a property, never a contingent fact. "The model beats
 * the median on whatever `.tasks/done/` holds today" would turn red on a future
 * day for a reason in the data, not the code. **The history up to 2026-10-17 is
 * fixed** — a finished task's start and finish do not move, and review notes
 * appended later are cut off by the parser — so on that set, beating the median
 * is a property of the model. A change to the model that loses to the median
 * on it is a regression, and this is where it shows.
 *
 * The numbers are printed on every run (`reportDiscovery`), so a reader sees
 * the error, not only a green tick. Reads `.tasks/`, writes nothing — the
 * standing of `task-file-state.test.ts` (LAI-415).
 */

const DONE = join(SERVER_ROOT, '..', '.tasks', 'done');
/** Tasks finished before this moment: the history as the decision measured it. */
const CUT_OFF = Date.UTC(2026, 9, 17);

function when(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw.trim().replace(/^['"]|['"]$/g, '');
  if (value === '' || value === 'null' || value === '~') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** Every finished task with a start and a finish, as the model reads a task. */
function history(): History[] {
  const rows: History[] = [];
  for (const name of readdirSync(DONE)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const text = readFileSync(join(DONE, name), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (match === null) continue;
    const front: Record<string, string> = {};
    for (const line of match[1]!.split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0 && !line.startsWith(' '))
        front[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const started = when(front.started);
    const finished = when(front.finished);
    if (started === null || finished === null || finished <= started || finished >= CUT_OFF)
      continue;

    // The task as written, before any review notes appended to it.
    const body = match[2]!.split(/\n## (?:Review|Send-?back|Round)/i)[0]!;
    const split = body.search(/\n## Acceptance/i);
    const title = (front.title ?? '').replace(/^['"]|['"]$/g, '');
    rows.push({
      id: front.id ?? name,
      key: front.id ?? name,
      title,
      signals: readSignals({
        title,
        description: split < 0 ? body : body.slice(0, split),
        acceptance: split < 0 ? '' : body.slice(split),
        // The area is the closest thing a task file has to a tag.
        tags: front.area === undefined ? [] : [front.area],
        blockedBy: (front['depends-on'] ?? '').match(/LAI-\d+/g)?.length ?? 0,
      }),
      startedAt: started,
      finishedAt: finished,
      buildMs: finished - started,
    });
  }
  return rows;
}

describe('the size model on the board’s own history, up to 2026-10-17', () => {
  const rows = history();
  const result = backtest(rows);

  it('reads the history it claims to — a parser that matched nothing cannot pass', () => {
    reportDiscovery('estimate back-test', {
      finished: rows.length,
      predicted: result.n,
      method_error_x1000: Math.round((result.methodError ?? 0) * 1000),
      median_error_x1000: Math.round((result.medianError ?? 0) * 1000),
      p80_hit_pct: Math.round((result.p80Hit ?? 0) * 100),
    });
    expect(rows.length).toBeGreaterThanOrEqual(300);
    expect(result.n).toBeGreaterThanOrEqual(150);
  });

  it('beats the plain project median, each prediction from earlier tasks only', () => {
    expect(result.methodError!).toBeLessThan(result.medianError!);
    expect(result.beatsMedian).toBe(true);
  });

  it('calibrates p80 on its own past errors: it holds about four in five', () => {
    expect(result.p80Hit!).toBeGreaterThan(0.7);
    expect(result.p80Hit!).toBeLessThan(0.9);
  });

  it('forecasts with the model, then, and not the median it beat', () => {
    expect(fitModel(rows, []).useModel).toBe(true);
  });
});

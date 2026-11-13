/**
 * The deliverable trial's documents (LAI-1131). **Illustrative only.**
 *
 * Three synthetic Markdown fixtures — no real names, addresses, tokens or
 * customer data — and the pre-rendered pictures of their diagrams. They are
 * reference content in the D-032 sense: this module is imported only by
 * `DocumentsTrial.tsx`, which `DocumentsTrialRoute.tsx` loads with `import()`,
 * so none of it reaches the entry chunk. `trial-fixtures.test.ts` builds the
 * app and proves that.
 */

import type { DiagramImages } from '../DocDiagram.tsx';
import architectureV1 from './fixtures/architecture-v1.md?raw';
import architectureV2 from './fixtures/architecture-v2.md?raw';
import uatReport from './fixtures/uat-report.md?raw';
import managementSummary from './fixtures/management-summary.md?raw';

export interface TrialVersion {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

export interface TrialDocument {
  readonly id: string;
  /** The letter the trial spec gives it. */
  readonly letter: 'A' | 'B' | 'C';
  readonly title: string;
  /** Newest last. */
  readonly versions: readonly TrialVersion[];
}

export const TRIAL_DOCUMENTS: readonly TrialDocument[] = [
  {
    id: 'architecture',
    letter: 'A',
    title: 'Architecture report',
    versions: [
      { id: 'v1', label: 'Version 1', source: architectureV1 },
      { id: 'v2', label: 'Version 2', source: architectureV2 },
    ],
  },
  {
    id: 'uat',
    letter: 'B',
    title: 'UAT report',
    versions: [{ id: 'v1', label: 'Version 1', source: uatReport }],
  },
  {
    id: 'summary',
    letter: 'C',
    title: 'Management summary',
    versions: [{ id: 'v1', label: 'Version 1', source: managementSummary }],
  },
];

const SVGS = import.meta.glob<string>('./diagrams/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** `<key>-light.svg` + `<key>-dark.svg` → one entry per diagram. */
function diagrams(): DiagramImages {
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const [path, url] of Object.entries(SVGS)) {
    const match = /\/([0-9a-f]{8})-(light|dark)\.svg$/.exec(path);
    if (match?.[1] === undefined) continue;
    (match[2] === 'light' ? light : dark).set(match[1], url);
  }
  const out = new Map<string, { light: string; dark: string }>();
  for (const [key, url] of light) {
    const pair = dark.get(key);
    if (pair !== undefined) out.set(key, { light: url, dark: pair });
  }
  return out;
}

export const TRIAL_DIAGRAMS: DiagramImages = diagrams();

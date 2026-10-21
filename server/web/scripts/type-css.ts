/**
 * `styles/type.css`, rendered from `theme/type-roles.ts` (LAI-606, LAI-828).
 *
 * Pure: it returns the stylesheet and writes nothing, so the generator writes
 * it (`scripts/generate-type-css.ts`) and `type-css-drift.test.ts` compares it
 * with the file on disk, byte for byte — the one check that covers the density
 * block and the comments, which `type-roles.test.ts` does not read.
 *
 * **It imports the real object rather than parsing the file.** The first
 * version read the source with a regex and silently produced 14 of 17 roles,
 * because Prettier had reformatted some entries onto one line — the sync test
 * caught it, which is the only reason it was not shipped. A generator that can
 * misread its own input is worse than no generator.
 */

import {
  DENSITY,
  leadingCss,
  rem,
  ROLE_NAMES,
  ROLES,
  STEP_NAMES,
  TYPE_SCALE,
  type RoleName,
  type StepName,
} from '../src/theme/type-roles.ts';

const header = `/*
 * The type scale and the type roles — GENERATED (LAI-606, LAI-828).
 *
 * Source of truth: \`theme/type-roles.ts\`. Regenerate with
 * \`npx tsx scripts/generate-type-css.ts\`; \`type-css-drift.test.ts\` fails if
 * this file differs from the generator's output by a byte, so editing it by
 * hand is a red build.
 *
 * Colour comes from a semantic token, so switching theme re-colours every role
 * at once. \`inherit\` on \`label\`, \`control\` and \`avatar\` is deliberate: those
 * are the roles whose colour belongs to the thing wearing them.
 */
`;

const scaleNote = `/*
 * The scale (LAI-828): every font-size in a stylesheet is one of these.
 * \`--text-*\` is the size and \`--leading-*\` its line-height, as Atlassian
 * pairs them. \`type-floor.test.ts\` fails on a size that is not one of them.
 */`;

const scale = [
  ':root {',
  ...STEP_NAMES.flatMap((step) => [
    `  --text-${step}: ${rem(TYPE_SCALE[step].size)};`,
    `  --leading-${step}: ${rem(TYPE_SCALE[step].leading)};`,
  ]),
  '}',
].join('\n');

const blocks = ROLE_NAMES.map((name) => {
  const r = ROLES[name];
  const lines = [
    `.t-${name} {`,
    `  font-family: var(--font-${r.family});`,
    `  font-size: var(--text-${r.step});`,
    `  font-weight: ${String(r.weight)};`,
    `  line-height: ${leadingCss(r.leading, r.step)};`,
    `  letter-spacing: ${r.tracking === 0 ? '0' : `${String(r.tracking)}em`};`,
    `  color: ${r.color === 'inherit' ? 'inherit' : `var(--${r.color})`};`,
  ];
  if (r.transform !== undefined) lines.push(`  text-transform: ${r.transform};`);
  if (r.tabular === true) lines.push('  font-variant-numeric: tabular-nums;');
  if (r.truncate === true) {
    lines.push('  white-space: nowrap;', '  overflow: hidden;', '  text-overflow: ellipsis;');
  }
  lines.push('}');
  return lines.join('\n');
});

const densityNote = `/*
 * Density overrides.
 *
 * Size and leading only — never weight, never colour. The selector is
 * \`.kanban-dense\`, the class \`LaneRow\` already toggles; a second
 * \`[data-density]\` switch beside it would be two controls for one idea.
 */`;

const density = Object.entries(DENSITY).flatMap(([, roles]) =>
  Object.entries(roles).map(
    ([role, over]: [string, { step?: StepName; leading?: number | 'step' }]) => {
      const step = over.step ?? ROLES[role as RoleName].step;
      const lines = [`.kanban-dense .t-${role} {`];
      if (over.step !== undefined) lines.push(`  font-size: var(--text-${over.step});`);
      if (over.leading !== undefined)
        lines.push(`  line-height: ${leadingCss(over.leading, step)};`);
      lines.push('}');
      return lines.join('\n');
    },
  ),
);

/** The whole of `styles/type.css`, as the generator writes it. */
export function renderTypeCss(): string {
  // trimEnd each piece: the header template ends in its own newline, and a
  // double blank after join is exactly what `pnpm format` rejects.
  return (
    [header, scaleNote, scale, ...blocks, densityNote, ...density]
      .map((s) => s.trimEnd())
      .join('\n\n') + '\n'
  );
}

/** How much the stylesheet holds, for the generator's one-line report. */
export const TYPE_CSS_COUNTS = {
  steps: STEP_NAMES.length,
  roles: ROLE_NAMES.length,
  density: density.length,
} as const;

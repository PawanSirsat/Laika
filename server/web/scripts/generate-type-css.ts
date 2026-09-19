/**
 * Emit `styles/type.css` from `theme/type-roles.ts` (LAI-606).
 *
 * Run with `npx tsx scripts/generate-type-css.ts` after editing a role.
 *
 * **It imports the real object rather than parsing the file.** The first
 * version read the source with a regex and silently produced 14 of 17 roles,
 * because Prettier had reformatted some entries onto one line — the sync test
 * caught it, which is the only reason it was not shipped. A generator that can
 * misread its own input is worse than no generator.
 */

import { writeFileSync } from 'node:fs';
import { DENSITY, rem, ROLE_NAMES, ROLES } from '../src/theme/type-roles.ts';

/**
 * A ratio stays a ratio; a px length is emitted in rem.
 *
 * Both forms exist because both are meant — see `TypeRole.leading`. Converting
 * a px line-height to a ratio here would silently make it scale with the size,
 * which is the property it was chosen to avoid.
 */
function leading(value: number | `${number}px`): string {
  return typeof value === 'number' ? String(value) : rem(Number.parseFloat(value));
}

const header = `/*
 * The type roles, as classes — GENERATED (LAI-606).
 *
 * Source of truth: \`theme/type-roles.ts\`. Regenerate with
 * \`npx tsx scripts/generate-type-css.ts\`; \`type-roles.test.ts\` fails if this
 * file and that object ever disagree, so editing this by hand is a red build.
 *
 * Colour comes from a semantic token, so switching theme re-colours every role
 * at once. \`inherit\` on \`label\`, \`control\` and \`avatar\` is deliberate: those
 * are the roles whose colour belongs to the thing wearing them.
 */
`;

const blocks = ROLE_NAMES.map((name) => {
  const r = ROLES[name];
  const lines = [
    `.t-${name} {`,
    `  font-family: var(--font-${r.family});`,
    `  font-size: ${rem(r.size)};`,
    `  font-weight: ${String(r.weight)};`,
    `  line-height: ${leading(r.leading)};`,
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
  Object.entries(roles).map(([role, over]) => {
    const lines = [`.kanban-dense .t-${role} {`];
    if (over.size !== undefined) lines.push(`  font-size: ${rem(over.size)};`);
    if ('leading' in over && over.leading !== undefined)
      lines.push(`  line-height: ${leading(over.leading)};`);
    lines.push('}');
    return lines.join('\n');
  }),
);

writeFileSync(
  new URL('../src/styles/type.css', import.meta.url).pathname,
  // trimEnd each piece: the header template ends in its own newline, and a
  // double blank after join is exactly what `pnpm format` rejects.
  [header, ...blocks, densityNote, ...density].map((s) => s.trimEnd()).join('\n\n') + '\n',
);

console.log(`${String(ROLE_NAMES.length)} roles, ${String(density.length)} density overrides`);

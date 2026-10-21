/**
 * Write `styles/type.css` from `theme/type-roles.ts` (LAI-606).
 *
 * Run with `npx tsx scripts/generate-type-css.ts` after editing the scale or a
 * role. The rendering lives in `scripts/type-css.ts`, which writes nothing, so
 * `type-css-drift.test.ts` can render the same stylesheet and compare.
 */

import { writeFileSync } from 'node:fs';
import { renderTypeCss, TYPE_CSS_COUNTS } from './type-css.ts';

writeFileSync(new URL('../src/styles/type.css', import.meta.url).pathname, renderTypeCss());

console.log(
  `${String(TYPE_CSS_COUNTS.steps)} steps, ${String(TYPE_CSS_COUNTS.roles)} roles, ${String(TYPE_CSS_COUNTS.density)} density overrides`,
);

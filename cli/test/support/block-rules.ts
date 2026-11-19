import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Revision 3's two rules as the web writes them in the repo block
 * (`connect-copy.ts`, LAI-1352): the words every other place that states
 * them must use exactly — the `laika-show-your-work` skill and the launcher's
 * work prompt (LAI-1351). Read from the web's source, so the two sides are
 * held to each other rather than to a copy of either.
 *
 * Returned as plain text: the rule number dropped, the template literal's
 * escaped backticks unescaped, and every run of whitespace one space, so
 * wrapping and indentation do not count.
 */
const COPY = fileURLToPath(
  new URL('../../../server/web/src/routes/screens/connect/connect-copy.ts', import.meta.url),
);

export type BlockRule = 'SHOW_THE_RESULT' | 'ONE_PARENT_PER_FEATURE';

export const plain = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function webRule(name: BlockRule): string {
  const source = readFileSync(COPY, 'utf8');
  const literal = new RegExp(`export const ${name} = \`((?:\\\\.|[^\`\\\\])*)\`;`).exec(
    source,
  )?.[1];
  if (literal === undefined) {
    throw new Error(
      `connect-copy.ts has no ${name}: the web's revision-3 block (LAI-1352) is not here`,
    );
  }
  return plain(literal.replace(/\\`/g, '`')).replace(/^\d+\. /, '');
}

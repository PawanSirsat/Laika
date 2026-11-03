/**
 * Acceptance drawn as a checklist (§11.4.2.1, LAI-1117): `acceptance_md` stays
 * prose on the server, and the panel draws it as a checklist only when every
 * line it holds is one. Mixed text is prose — a half-checklist would draw a
 * tick beside a sentence nobody meant as a criterion.
 */

const ITEM = /^\s*[-*+] \[( |x|X)\] \S/;

/** Every non-blank line is `- [ ] …` or `- [x] …` (any list marker). */
export function isChecklist(md: string): boolean {
  const lines = md.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => ITEM.test(line));
}

/** `{ done, total }` for a checklist; `null` for prose. */
export function checklistProgress(md: string): { done: number; total: number } | null {
  if (!isChecklist(md)) return null;
  const lines = md.split('\n').filter((line) => line.trim() !== '');
  const done = lines.filter((line) =>
    /\[(x|X)\]/.test(line.slice(0, line.indexOf(']') + 1)),
  ).length;
  return { done, total: lines.length };
}

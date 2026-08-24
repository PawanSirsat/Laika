/**
 * Strip comments from a source file before scanning it.
 *
 * Structural tests here grep source for things that must not be present. Doc
 * comments routinely *name* those things in order to say they must not be
 * present — `Sidebar.tsx` explains that there is no SYSTEM group and no
 * Calendar item, `ConnectionBanner.tsx` names the fixture hostname it refuses
 * to hardcode. Scanning raw source therefore punishes writing down why, and it
 * cost two tasks (LAI-020, LAI-019) before this moved into a helper.
 *
 * Approximate by design: it does not track string literals, so a `//` inside a
 * string would be treated as a comment. No source here has one; if that
 * changes, this needs a real tokeniser rather than a quiet false negative.
 */
export function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

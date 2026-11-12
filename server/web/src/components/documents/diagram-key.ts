/**
 * The name a pre-rendered diagram is filed under (LAI-1131).
 *
 * Mermaid cannot run under the production CSP (it writes a `<style>` element
 * into every SVG it draws, which `style-src-elem 'self'` refuses), so the trial
 * draws each diagram ahead of time with `scripts/render-trial-diagrams.ts` and
 * the page looks it up by its source. The key is a hash of that source, so an
 * edited diagram has a new key, finds no picture, and falls back to showing
 * its source — never a stale drawing of a diagram that changed.
 *
 * FNV-1a, 32 bits: synchronous in the browser (no `crypto.subtle` promise in a
 * render path) and the same in Node, where the script computes it. Collisions
 * are irrelevant at a few dozen diagrams.
 */
export function diagramKey(source: string): string {
  const text = source.replace(/\r\n/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Every ```mermaid fence in a Markdown document, in order, as written. */
export function mermaidSources(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```\s*$/gm)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

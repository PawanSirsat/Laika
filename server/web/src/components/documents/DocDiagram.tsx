import { useState } from 'react';
import { diagramKey } from './diagram-key.ts';
import { DocCodeBlock } from './DocCodeBlock.tsx';

/**
 * A Mermaid diagram in a document (LAI-1131, T5).
 *
 * **Mermaid does not run in the browser here.** The trial's spike rendered
 * every fixture diagram under the production CSP and Mermaid raised a
 * `style-src-elem` violation for each one: it writes a `<style>` element into
 * the SVG it draws, and `style-src-elem 'self'` refuses it. The CSP is not
 * relaxed for a diagram. Instead `scripts/render-trial-diagrams.ts` draws them
 * ahead of time, a light and a dark SVG each, and they are shown as images —
 * an SVG inside `<img>` is its own document, so its `<style>` never meets the
 * page's policy.
 *
 * The costs, recorded rather than hidden: the text in a diagram is not
 * selectable, links in it are dead, and it uses the system sans rather than
 * the app's self-hosted face. A diagram with no picture — edited since the
 * last pre-render — shows its source, labelled, instead of a stale drawing.
 */

export interface DiagramImage {
  readonly light: string;
  readonly dark: string;
}

export type DiagramImages = ReadonlyMap<string, DiagramImage>;

/** The first line of a Mermaid source names its kind; good enough for alt text. */
function describe(source: string): string {
  const first = source.trim().split('\n')[0]?.trim() ?? '';
  if (first.startsWith('sequenceDiagram')) return 'Sequence diagram';
  if (first.startsWith('erDiagram')) return 'Entity–relationship diagram';
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'Flowchart';
  return 'Diagram';
}

export function DocDiagram({
  source,
  images,
}: {
  readonly source: string;
  readonly images: DiagramImages;
}) {
  const [showSource, setShowSource] = useState(false);
  const image = images.get(diagramKey(source));
  const kind = describe(source);

  if (image === undefined) {
    return (
      <figure className="doc-diagram doc-diagram-fallback" data-diagram="source">
        <figcaption className="doc-diagram-caption">
          {kind} — shown as source: no pre-rendered picture matches this diagram.
        </figcaption>
        <DocCodeBlock code={source} language="" />
      </figure>
    );
  }

  return (
    <figure className="doc-diagram" data-diagram="image">
      <div className="doc-diagram-frame">
        <img className="doc-diagram-light" src={image.light} alt={`${kind}. Source below.`} />
        <img className="doc-diagram-dark" src={image.dark} alt={`${kind}. Source below.`} />
      </div>
      <figcaption className="doc-diagram-caption">
        {kind}
        <button
          type="button"
          className="doc-link-button"
          aria-expanded={showSource}
          onClick={() => {
            setShowSource((v) => !v);
          }}
        >
          {showSource ? 'Hide source' : 'Show source'}
        </button>
      </figcaption>
      {showSource ? <DocCodeBlock code={source} language="" /> : null}
    </figure>
  );
}

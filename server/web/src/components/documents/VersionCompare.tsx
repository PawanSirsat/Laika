import { Fragment, useMemo, useState } from 'react';
import {
  diffLines,
  diffSections,
  diffStats,
  foldUnchanged,
  type SectionChange,
} from './line-diff.ts';

/**
 * Two versions of a document, compared (LAI-1131, T7): first by section —
 * what was added, removed, moved or changed, matched by heading words so a
 * renumbered section is not "new" — then line by line, unchanged runs folded.
 *
 * Source against source, never rendered HTML: a reviewer of a deliverable
 * wants to know what the author changed, and a rendered diff turns one moved
 * table into fifty changed cells. Everything runs in the browser; Phase D
 * keeps versions server-side and may diff there.
 */

const CHANGE_LABEL: Readonly<Record<SectionChange, string>> = {
  added: 'Added',
  removed: 'Removed',
  moved: 'Moved',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

/** Text, not colour alone: each change has a glyph a screen reader skips. */
const CHANGE_GLYPH: Readonly<Record<SectionChange, string>> = {
  added: '+',
  removed: '−',
  moved: '↕',
  changed: '±',
  unchanged: '·',
};

export interface VersionCompareProps {
  readonly before: { readonly label: string; readonly source: string };
  readonly after: { readonly label: string; readonly source: string };
  /** Jump to a section in the reading view. */
  readonly onOpenSection?: ((id: string) => void) | undefined;
}

export function VersionCompare({ before, after, onOpenSection }: VersionCompareProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const sections = useMemo(
    () => diffSections(before.source, after.source),
    [before.source, after.source],
  );
  const lines = useMemo(
    () => diffLines(before.source, after.source),
    [before.source, after.source],
  );
  const stats = diffStats(lines);
  const hunks = useMemo(() => foldUnchanged(lines), [lines]);
  const shown = showUnchanged ? sections : sections.filter((s) => s.change !== 'unchanged');
  const counts = sections.reduce<Record<SectionChange, number>>(
    (acc, s) => ({ ...acc, [s.change]: acc[s.change] + 1 }),
    { added: 0, removed: 0, moved: 0, changed: 0, unchanged: 0 },
  );

  return (
    <div className="doc-compare" data-compare>
      <section className="doc-compare-block" aria-labelledby="doc-compare-sections">
        <div className="doc-compare-head">
          <h2 id="doc-compare-sections" className="doc-compare-title">
            Sections: {before.label} → {after.label}
          </h2>
          <p className="doc-compare-counts">
            {(['changed', 'moved', 'added', 'removed'] as const).map((c) => (
              <span key={c} className="doc-change" data-change={c}>
                <span aria-hidden="true">{CHANGE_GLYPH[c]}</span> {counts[c]}{' '}
                {CHANGE_LABEL[c].toLowerCase()}
              </span>
            ))}
          </p>
          <label className="doc-compare-toggle">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => {
                setShowUnchanged(e.target.checked);
              }}
            />{' '}
            Show unchanged sections
          </label>
        </div>
        <ul className="doc-section-changes">
          {shown.map((s, i) => (
            <li
              key={`${s.title}-${String(i)}`}
              className="doc-section-change"
              data-change={s.change}
              data-depth={s.depth}
            >
              <span className="doc-change" data-change={s.change}>
                <span aria-hidden="true">{CHANGE_GLYPH[s.change]}</span> {CHANGE_LABEL[s.change]}
              </span>
              <span className="doc-section-name">
                {s.oldHeading !== undefined &&
                s.newHeading !== undefined &&
                s.oldHeading !== s.newHeading ? (
                  <>
                    <del>{s.oldHeading}</del> → <ins>{s.newHeading}</ins>
                  </>
                ) : (
                  s.title
                )}
              </span>
              {s.newId !== undefined && onOpenSection !== undefined ? (
                <button
                  type="button"
                  className="doc-link-button"
                  onClick={() => {
                    onOpenSection(s.newId ?? '');
                  }}
                >
                  Read
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="doc-compare-block" aria-labelledby="doc-compare-lines">
        <div className="doc-compare-head">
          <h2 id="doc-compare-lines" className="doc-compare-title">
            Lines
          </h2>
          <p className="doc-compare-counts">
            <span className="doc-change" data-change="added">
              <span aria-hidden="true">+</span> {stats.inserted} inserted
            </span>
            <span className="doc-change" data-change="removed">
              <span aria-hidden="true">−</span> {stats.removed} removed
            </span>
          </p>
        </div>
        <div className="doc-diff-scroll" tabIndex={0} role="region" aria-label="Line differences">
          <table className="doc-diff">
            <caption className="visually-hidden">
              Line differences between {before.label} and {after.label}
            </caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{before.label} line</th>
                <th scope="col">{after.label} line</th>
                <th scope="col">Change</th>
                <th scope="col">Text</th>
              </tr>
            </thead>
            <tbody>
              {hunks.map((hunk, h) =>
                hunk.kind === 'fold' ? (
                  <tr key={`f${String(h)}`} className="doc-diff-fold">
                    <td colSpan={4}>⋯ {hunk.count} unchanged lines</td>
                  </tr>
                ) : (
                  <Fragment key={`h${String(h)}`}>
                    {hunk.lines.map((line, k) => (
                      <tr key={k} className="doc-diff-line" data-kind={line.kind}>
                        <td className="doc-diff-num">{line.oldLine ?? ''}</td>
                        <td className="doc-diff-num">{line.newLine ?? ''}</td>
                        <td className="doc-diff-mark">
                          {line.kind === 'insert' ? (
                            <>
                              <span aria-hidden="true">+</span>
                              <span className="visually-hidden">inserted</span>
                            </>
                          ) : line.kind === 'remove' ? (
                            <>
                              <span aria-hidden="true">−</span>
                              <span className="visually-hidden">removed</span>
                            </>
                          ) : null}
                        </td>
                        <td className="doc-diff-text">
                          {line.kind === 'insert' ? (
                            <ins>{line.text}</ins>
                          ) : line.kind === 'remove' ? (
                            <del>{line.text}</del>
                          ) : (
                            line.text
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { DocumentReader } from '../DocumentReader.tsx';
import { VersionCompare } from '../VersionCompare.tsx';
import type { Annotation } from '../annotations.ts';
import { TRIAL_DIAGRAMS, TRIAL_DOCUMENTS, type TrialDocument } from './trial-fixtures.ts';
import '../documents.css';

/**
 * `/design/documents` — the deliverable design trial (LAI-1131).
 *
 * A reference page, like `/design/tokens` and `/design/states`: public, out of
 * the product nav, and **not product**. It exists so the owner can judge how
 * long-form agent deliverables read before Phase D decides how they are
 * stored. Three illustrative fixtures; nothing is fetched and nothing is
 * saved — comments live in this component's state.
 */

type Mode = 'read' | 'compare';

export function DocumentsTrial() {
  const [docId, setDocId] = useState(TRIAL_DOCUMENTS[0]?.id ?? '');
  const doc: TrialDocument | undefined = TRIAL_DOCUMENTS.find((d) => d.id === docId);
  const latest = doc?.versions[doc.versions.length - 1];
  const [versionId, setVersionId] = useState(latest?.id ?? 'v1');
  const [mode, setMode] = useState<Mode>('read');
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [goTo, setGoTo] = useState<string | undefined>(undefined);

  if (doc === undefined || latest === undefined) return null;
  const version = doc.versions.find((v) => v.id === versionId) ?? latest;
  const comparable = doc.versions.length > 1;
  const showing: Mode = comparable ? mode : 'read';

  const pick = (next: TrialDocument): void => {
    setDocId(next.id);
    setVersionId(next.versions[next.versions.length - 1]?.id ?? 'v1');
    setGoTo(undefined);
    if (next.versions.length < 2) setMode('read');
  };

  return (
    <div className="doc-trial" data-doc-trial>
      <header className="doc-trial-head">
        <div className="doc-trial-intro">
          <h1 className="doc-trial-title">Deliverable reader — design trial</h1>
          <p className="doc-trial-note">
            <strong>Illustrative fixtures, not product.</strong> Three synthetic documents for
            judging how agent deliverables read. Nothing here is fetched or saved.
          </p>
        </div>
        <div className="doc-trial-controls">
          <div className="doc-segmented" role="group" aria-label="Document">
            {TRIAL_DOCUMENTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className="doc-segment"
                aria-pressed={d.id === doc.id}
                data-doc={d.id}
                onClick={() => {
                  pick(d);
                }}
              >
                <span className="doc-segment-letter" aria-hidden="true">
                  {d.letter}
                </span>
                {d.title}
              </button>
            ))}
          </div>
          {comparable ? (
            <>
              <div className="doc-segmented" role="group" aria-label="Version">
                {doc.versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="doc-segment"
                    aria-pressed={showing === 'read' && v.id === version.id}
                    disabled={showing === 'compare'}
                    data-version={v.id}
                    onClick={() => {
                      setVersionId(v.id);
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="doc-segmented" role="group" aria-label="View">
                <button
                  type="button"
                  className="doc-segment"
                  aria-pressed={showing === 'read'}
                  data-mode="read"
                  onClick={() => {
                    setMode('read');
                  }}
                >
                  Read
                </button>
                <button
                  type="button"
                  className="doc-segment"
                  aria-pressed={showing === 'compare'}
                  data-mode="compare"
                  onClick={() => {
                    setMode('compare');
                  }}
                >
                  Compare versions
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {showing === 'compare' ? (
        <VersionCompare
          before={doc.versions[0] ?? latest}
          after={latest}
          onOpenSection={(id) => {
            setVersionId(latest.id);
            setMode('read');
            setGoTo(id);
          }}
        />
      ) : (
        <DocumentReader
          key={`${doc.id}-${version.id}`}
          documentId={doc.id}
          title={doc.title}
          version={version.id}
          versionLabel={version.label}
          source={version.source}
          diagrams={TRIAL_DIAGRAMS}
          annotations={annotations}
          onAnnotationsChange={setAnnotations}
          goTo={goTo}
        />
      )}
    </div>
  );
}

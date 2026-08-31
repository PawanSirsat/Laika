import { useEffect, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import {
  contextBudget,
  getProjectContext,
  readableContextError,
  updateProjectContext,
  type ProjectContext,
} from '../../../api/project-context.ts';
import { CONTEXT_BELONGS, CONTEXT_EXCLUDED, CONTEXT_PURPOSE } from './context-copy.ts';
import type { Member } from '../../../api/tasks.ts';
import './project-context.css';

export interface ProjectContextPanelProps {
  readonly slug: string;
  readonly projectName: string;
  /** `lead`+ — decided by the caller, which knows the actor's memberships. */
  readonly mayEdit: boolean;
  readonly members: ReadonlyMap<string, Member>;
  readonly onClose: () => void;
}

/**
 * The shared project context document (SPEC §7.3, LAI-412).
 *
 * A slide-over on the Projects screen rather than a route: SPEC §11.4.2 maps
 * `get_project_context` to **Projects**, and the task detail is the existing
 * precedent for a panel that is deliberately not a nav destination.
 *
 * ## Plain markdown, deliberately
 *
 * A monospace `<textarea>` and nothing else. The value is served **verbatim** to
 * every agent session on the project, so what is typed is what ships — a
 * rich-text layer would put a rendering step between the author and the thing
 * the agent actually reads, and would need a dependency no task authorises.
 */
export function ProjectContextPanel({
  slug,
  projectName,
  mayEdit,
  members,
  onClose,
}: ProjectContextPanelProps) {
  const [loaded, setLoaded] = useState<ProjectContext | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getProjectContext(slug, controller.signal)
      .then((doc) => {
        setLoaded(doc);
        setDraft(doc.context_md);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause);
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  const dirty = loaded !== undefined && draft !== loaded.context_md;

  /**
   * Unsaved work must not vanish on a reload or a closed tab.
   *
   * The browser's own prompt, not a custom one: it is the only thing that can
   * interrupt a navigation the app does not control. `beforeunload` is ignored
   * unless something was actually edited, so a reader who only opened the
   * document is never asked.
   */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  const close = (): void => {
    // In-app closing is ours to guard, and the browser's prompt cannot reach it.
    if (dirty && !window.confirm('Close without saving? Your changes will be lost.')) return;
    onClose();
  };

  const save = (): void => {
    setSaving(true);
    setSaveError(undefined);
    updateProjectContext(slug, draft)
      .then((doc) => {
        setLoaded(doc);
        setDraft(doc.context_md);
        setSavedAt(Date.now());
      })
      .catch((cause: unknown) => {
        // The length is passed because the client knows it and the server's
        // zod refusal does not carry it — see `readableContextError`.
        setSaveError(readableContextError(cause, draft.length));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const budget = loaded === undefined ? undefined : contextBudget(draft.length, loaded.limit);
  const editedBy = loaded?.updated_by === null ? undefined : members.get(loaded?.updated_by ?? '');

  return (
    <aside className="ctx" aria-label={`Context document for ${projectName}`}>
      <header className="ctx-head">
        <div>
          <h2 className="ctx-title">Project context</h2>
          <p className="ctx-project">{projectName}</p>
        </div>
        <button type="button" className="ctx-close" onClick={close}>
          Close
        </button>
      </header>

      {loadError !== null ? (
        <ApiErrorState error={loadError} resource="this project's context" scope="project" />
      ) : loaded === undefined ? (
        <LoadingState shape="row" count={3} label="Loading the context document" />
      ) : (
        <>
          {/*
            The empty state is this screen's whole job (§7.3). A blank textarea
            labelled "Context" teaches nobody what to write, and the document's
            value depends entirely on the right things being in it.
          */}
          {draft === '' && (
            <section className="ctx-guide">
              <p className="ctx-guide-lead">{CONTEXT_PURPOSE}</p>
              <div className="ctx-guide-cols">
                <div>
                  <h3 className="ctx-guide-title">What belongs in it</h3>
                  <ul className="ctx-guide-list">
                    {CONTEXT_BELONGS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="ctx-guide-title">What does not</h3>
                  <ul className="ctx-guide-list">
                    {CONTEXT_EXCLUDED.map((item) => (
                      <li key={item.what}>
                        {item.what} <span className="ctx-guide-why">— {item.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          <label className="ctx-label" htmlFor="ctx-editor">
            <span className="visually-hidden">Context document, markdown</span>
          </label>
          <textarea
            id="ctx-editor"
            className="ctx-editor"
            value={draft}
            readOnly={!mayEdit}
            spellCheck={false}
            placeholder={mayEdit ? 'Markdown. Written once, read by every agent session.' : ''}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />

          <footer className="ctx-foot">
            {/*
              §7.3: the limit must be visible **before** it is hit — "a context
              document that silently blows an agent's context window is worse
              than no document". A count that only appears on a failed save
              arrives after the writing is done.
            */}
            {budget !== undefined && (
              <p className={`ctx-count ctx-count-${budget.tone}`} role="status">
                {budget.used.toLocaleString()} / {budget.limit.toLocaleString()} characters
                {budget.tone === 'over' && ` · ${String(-budget.remaining)} over`}
                {budget.tone === 'near' && ` · ${budget.remaining.toLocaleString()} left`}
              </p>
            )}

            <p className="ctx-edited">
              {loaded.updated_at === null
                ? 'Never edited.'
                : `Last edited ${new Date(loaded.updated_at).toLocaleString()}${
                    editedBy === undefined ? '' : ` by ${editedBy.name}`
                  }`}
            </p>

            {mayEdit ? (
              <div className="ctx-actions">
                {dirty && <span className="ctx-dirty">Unsaved changes</span>}
                {savedAt !== undefined && !dirty && (
                  <span className="ctx-saved" role="status">
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  className="ctx-save"
                  disabled={saving || !dirty}
                  onClick={save}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              /* No disabled Save and no control that answers 403 — a viewer is
                 told why the editor is read-only, which is a fact about their
                 role rather than a fault. */
              <p className="ctx-readonly">
                Read-only. Editing the context document needs the lead role on this project.
              </p>
            )}
          </footer>

          {saveError !== undefined && (
            <p className="ctx-error" role="alert">
              {saveError}
            </p>
          )}
        </>
      )}
    </aside>
  );
}

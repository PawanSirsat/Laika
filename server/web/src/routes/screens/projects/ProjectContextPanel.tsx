import { Spinner } from '../../../components/Spinner.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { useEffect, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import {
  contextBudget,
  getProjectContext,
  readableContextError,
  staleContextOf,
  updateProjectContext,
  type ProjectContext,
} from '../../../api/project-context.ts';
import { subscribeToEvents } from '../../../api/event-stream.ts';
import { agentsOf, useMyAgents } from '../../../api/use-my-agents.ts';
import { ContextDiffPanel, ContextHistory, RevisionBody } from './ContextHistory.tsx';
import { CONTEXT_BELONGS, CONTEXT_EXCLUDED, CONTEXT_PURPOSE } from './context-copy.ts';
import type { Member } from '../../../api/tasks.ts';
import { dateTime } from '../../../api/time-label.ts';
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
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<ProjectContext | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  /**
   * The newest revision known to exist, when it is newer than the one being
   * edited: from a save refused as stale, or from a `project.context_updated`
   * frame (LAI-556). `stale` is the refusal itself — the save did not happen.
   */
  const [newest, setNewest] = useState<number | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [comparing, setComparing] = useState(false);
  /** The comparison was too large, so r{newest} is shown whole instead. */
  const [wholeNewest, setWholeNewest] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const agents = agentsOf(useMyAgents());

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

  /**
   * Somebody else saved: learn the newest revision **without touching the
   * editor**. The draft, the caret and focus stay exactly where they were;
   * the history refreshes in place, and a notice offers the comparison.
   */
  useEffect(
    () =>
      subscribeToEvents(slug, (frame) => {
        if (frame.kind !== 'activity' || frame.type !== 'project.context_updated') return;
        setRefreshKey((n) => n + 1);
        getProjectContext(slug)
          .then((doc) => {
            setNewest((was) => Math.max(was ?? 0, doc.revision));
          })
          .catch(() => {
            // The history refresh above still says it; a failed probe here
            // only means the notice waits for the next frame or save.
          });
      }),
    [slug],
  );

  const dirty = loaded !== undefined && draft !== loaded.context_md;
  const behind =
    loaded !== undefined && newest !== undefined && newest > loaded.revision ? newest : undefined;

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
    if (!dirty) {
      onClose();
      return;
    }
    void confirm({
      title: 'Close without saving?',
      body: 'Your changes to this project’s context will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (yes) onClose();
    });
  };

  const settle = (doc: ProjectContext): void => {
    setLoaded(doc);
    setDraft(doc.context_md);
    setNewest(undefined);
    setStale(false);
    setComparing(false);
    setWholeNewest(false);
    setRefreshKey((n) => n + 1);
  };

  /** `base` is the revision this text replaces — normally the one opened. */
  const save = (base = loaded?.revision ?? 0): void => {
    setSaving(true);
    setSaveError(undefined);
    updateProjectContext(slug, draft, base)
      .then((doc) => {
        settle(doc);
        setSavedAt(Date.now());
      })
      .catch((cause: unknown) => {
        // Refused as stale: nothing was written and the draft is untouched.
        // The conflict box below says so and offers the comparison.
        const refusal = staleContextOf(cause);
        if (refusal !== null) {
          setNewest((was) => Math.max(was ?? 0, refusal.current_revision));
          setStale(true);
          return;
        }
        // The length is passed because the client knows it and the server's
        // zod refusal does not carry it — see `readableContextError`.
        setSaveError(readableContextError(cause, draft.length));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  /** Throw the draft away and take the newest revision, after asking. */
  const loadNewest = (): void => {
    const go = (): void => {
      getProjectContext(slug)
        .then(settle)
        .catch((cause: unknown) => {
          setSaveError(readableContextError(cause));
        });
    };
    if (!dirty) {
      go();
      return;
    }
    void confirm({
      title: `Load r${String(behind ?? '')} and discard your text?`,
      body: 'Your unsaved changes will be lost. Copy them first if you want to apply them again.',
      confirmLabel: 'Discard and load',
      cancelLabel: 'Keep my text',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (yes) go();
    });
  };

  /** Save this text as the next revision after the newest — an explicit overwrite. */
  const saveOver = (): void => {
    if (behind === undefined) return;
    void confirm({
      title: `Replace r${String(behind)} with your text?`,
      body: `Your text becomes r${String(behind + 1)}. Whatever r${String(behind)} added and yours does not have is gone from the current document; it stays in the history.`,
      confirmLabel: 'Save mine',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (yes) save(behind);
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
                : `Last edited ${dateTime(loaded.updated_at, Date.now())}${
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
                  onClick={() => {
                    save();
                  }}
                >
                  {saving && <Spinner size="sm" />}
                  Save
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

          {/*
            A newer revision exists than the one in the editor (LAI-556). After
            a refused save this is the refusal, so it is an alert; learned from
            the live stream it is a polite status, and **focus never moves**
            either way — a reader typing keeps typing.
          */}
          {behind !== undefined && loaded !== undefined && (
            <section className="ctx-conflict" data-context-conflict={stale ? 'stale' : 'live'}>
              <p className="ctx-conflict-text" role={stale ? 'alert' : 'status'}>
                {stale
                  ? `Not saved: somebody saved a newer version (r${String(behind)}) while you were editing r${String(loaded.revision)}. Your text is still here.`
                  : `Somebody saved r${String(behind)} since you opened r${String(loaded.revision)}.`}
              </p>
              <div className="ctx-conflict-actions">
                <button
                  type="button"
                  className="ctx-secondary"
                  aria-expanded={comparing}
                  onClick={() => {
                    setComparing((open) => !open);
                    setWholeNewest(false);
                  }}
                >
                  {comparing ? 'Hide the comparison' : 'Compare with the newer version'}
                </button>
                {dirty && (
                  <CopyButton
                    text={draft}
                    label="Copy my text"
                    what="your unsaved text"
                    className="ctx-secondary"
                  />
                )}
                <button type="button" className="ctx-secondary" onClick={loadNewest}>
                  {dirty ? `Discard mine, load r${String(behind)}` : `Load r${String(behind)}`}
                </button>
                {mayEdit && dirty && (
                  <button
                    type="button"
                    className="ctx-secondary ctx-danger"
                    disabled={saving}
                    onClick={saveOver}
                  >
                    Save mine over r{behind}
                  </button>
                )}
              </div>
              {comparing && (
                <div className="ctx-conflict-diff">
                  <p className="ctx-conflict-hint">
                    What changed between the version you opened (r{loaded.revision}) and r{behind}.
                    Your text is not part of this comparison; it is still in the editor.
                  </p>
                  {wholeNewest ? (
                    <RevisionBody slug={slug} revision={behind} />
                  ) : (
                    <ContextDiffPanel
                      slug={slug}
                      from={loaded.revision}
                      to={behind}
                      onOpenWhole={() => {
                        setWholeNewest(true);
                      }}
                    />
                  )}
                </div>
              )}
            </section>
          )}

          <ContextHistory slug={slug} refreshKey={refreshKey} members={members} agents={agents} />
        </>
      )}
    </aside>
  );
}

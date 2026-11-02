import { useCallback, useEffect, useId, useState, type MouseEvent } from 'react';
import {
  getAgent,
  listAgents,
  setAgentGrants,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import { everyPage } from '../../../../api/every-page.ts';
import { pickProject } from '../../../../api/pick-project.ts';
import { getProjectAccess, type ProjectAccess } from '../../../../api/project-access.ts';
import {
  listProjectSetups,
  recordSelfReport,
  type ProjectSetup,
} from '../../../../api/project-setups.ts';
import { useProjects } from '../../../../api/use-projects.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../../components/Dropdown.tsx';
import { EmptyState } from '../../../../components/EmptyState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { Spinner } from '../../../../components/Spinner.tsx';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { Help } from '../../../../components/wizard/Help.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import {
  markedProjectBlock,
  PROJECT_BLOCK_REVISION,
  projectSetupPrompt,
  type ProjectRef,
} from '../../connect/connect-copy.ts';
import { OVERVIEW_ADDRESSES } from './overview-state.ts';
import {
  connectedTools,
  currentChoice,
  grantLabel,
  grantOptions,
  projectCheckCommand,
  recordFinding,
  recordSource,
  recordState,
  REPO_MCP_CONFIG_TOOLS,
  setupEvidence,
  targetFor,
  withOneGrant,
  type GrantChoice,
  type ToolChoice,
} from './project-setup.ts';
import '../../connect/connect.css';

export interface ProjectSetupTabProps {
  readonly origin: string;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  readonly onNavigate: (to: string) => void;
}

/**
 * The last tool chosen here, by agent id. Its own key: Connect's
 * `laika.connect.agent` holds a catalogue id, and classic reads it.
 */
const TOOL_KEY = 'laika.developer.project-setup.tool';

function rememberedTool(): string | null {
  try {
    return window.localStorage.getItem(TOOL_KEY);
  } catch {
    return null;
  }
}

function rememberTool(id: string): void {
  try {
    window.localStorage.setItem(TOOL_KEY, id);
  } catch {
    // A private window: the choice is still in the address.
  }
}

type Load<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'error'; readonly error: unknown };

const ROLE_WORDS = { lead: 'Lead', member: 'Member', viewer: 'Viewer' } as const;

/**
 * Developer access V3 → Project setup (LAI-1052, plan §G): one repository at
 * a time, repeatable for every one.
 *
 * 1. **Project and tool** — a project of yours and one of your connected
 *    tools, both kept in the address so the page can be bookmarked, shared
 *    with yourself on another machine, and resumed.
 * 2. **Access** — your membership and the tool's grant, as two facts from
 *    `GET /agents/:id/project-access`, and the grant selector the server's
 *    `can_grant` allows. Saving changes this project only, through the
 *    existing `PUT /agents/:id/grants`. No token is minted or shown.
 * 3. **Instructions** — the tool's own file (`instructionsTarget`) and the
 *    revision-2 prompt that updates only the Laika block in it.
 * 4. **Repo MCP config** — only for the tools that read it from the repo.
 * 5. **Record** — what is known about the block, from the board's records
 *    (§4.82): `laika project check`'s, verified on a device, apart from the
 *    reader's own *I've added it*, which is shown as theirs, never verified.
 *
 * The board never sees the repository, and the page never says it did.
 */
export function ProjectSetupTab({ origin, params, setParams, onNavigate }: ProjectSetupTabProps) {
  const projects = useProjects();
  const [agents, setAgents] = useState<Load<readonly RegisteredAgent[]>>({ kind: 'loading' });
  const [message, announce] = useLiveRegion();
  const [now] = useState(() => Date.now());
  const ids = useId();

  const loadAgents = useCallback(() => {
    const controller = new AbortController();
    setAgents({ kind: 'loading' });
    everyPage((cursor) =>
      listAgents(controller.signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    )
      .then(({ items }) => {
        setAgents({ kind: 'ready', value: items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAgents({ kind: 'error', error });
      });
    return controller;
  }, []);

  useEffect(() => {
    const controller = loadAgents();
    return () => {
      controller.abort();
    };
  }, [loadAgents]);

  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const choose = (key: 'project' | 'tool', value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === 'tool') rememberTool(value);
    setParams(next);
  };

  const intro = (
    <p className="conn-body">
      Do this once for each repository. It gives one of your tools access to one project and gives
      you a prompt that adds this project to that tool’s instructions file. It never shows a token,
      and it never changes anything on your device by itself.
    </p>
  );

  let body;
  if (agents.kind === 'loading' || projects.status === 'loading') {
    body = <LoadingState shape="row" count={2} label="Loading your tools and projects" />;
  } else if (agents.kind === 'error') {
    body = (
      <ApiErrorState
        error={agents.error}
        resource="your tools"
        scope="organisation"
        onRetry={loadAgents}
      />
    );
  } else if (projects.status === 'error') {
    body = (
      <ApiErrorState
        error={projects.error}
        resource="your projects"
        scope="organisation"
        onRetry={projects.reload}
      />
    );
  } else {
    const tools = connectedTools(agents.value, now);
    const project = pickProject(projects.projects, params.get('project') ?? undefined);
    if (tools.length === 0) {
      body = (
        <EmptyState
          headline="No connected tools yet"
          body="Add a coding tool on one of your devices first. Then come back here to give it a project."
          action={{
            label: 'Add a tool',
            onClick: () => {
              onNavigate(OVERVIEW_ADDRESSES.addTool);
            },
          }}
        />
      );
    } else if (project === undefined) {
      body = (
        <EmptyState
          headline="No projects to set up"
          body="You are not a member of any project yet. A lead can add you, or you can create one from Projects."
        />
      );
    } else {
      const wanted = params.get('tool') ?? rememberedTool();
      const tool = tools.find((t) => t.id === wanted) ?? tools[0];
      body =
        tool === undefined ? null : (
          <>
            <div className="dev-projects-fields">
              <div className="conn-field">
                <label className="conn-label" htmlFor={`${ids}-project`}>
                  Project
                </label>
                <Dropdown
                  id={`${ids}-project`}
                  variant="bare"
                  className="conn-select"
                  noun="projects"
                  value={project.slug}
                  options={projects.projects
                    .filter((row): row is typeof row & { slug: string } => 'slug' in row)
                    .map((row) => ({ value: row.slug, label: row.name }))}
                  onChange={(next) => {
                    choose('project', next);
                  }}
                />
              </div>
              <div className="conn-field">
                <label className="conn-label" htmlFor={`${ids}-tool`}>
                  Connected tool
                </label>
                <Dropdown
                  id={`${ids}-tool`}
                  variant="bare"
                  className="conn-select"
                  noun="tools"
                  value={tool.id}
                  options={tools.map((t) => ({ value: t.id, label: t.label, detail: t.status }))}
                  onChange={(next) => {
                    choose('tool', next);
                  }}
                />
              </div>
            </div>
            <SetupFor
              key={`${tool.id}:${project.id}`}
              origin={origin}
              tool={tool}
              project={{ slug: project.slug, prefix: project.prefix, name: project.name }}
              announce={announce}
              go={go}
              onAgentChanged={(changed) => {
                setAgents((prev) =>
                  prev.kind === 'ready'
                    ? {
                        kind: 'ready',
                        value: prev.value.map((a) => (a.id === changed.id ? changed : a)),
                      }
                    : prev,
                );
              }}
            />
          </>
        );
    }
  }

  return (
    <div className="dev-body">
      <LiveRegion message={message} />
      <section className="dev-card dev-projects dev-setup" aria-labelledby={`${ids}-title`}>
        <div className="dev-card-head">
          <h2 className="dev-card-title" id={`${ids}-title`}>
            Set up a project repository
          </h2>
          <span className="conn-chip conn-chip-scope">Once per repository</span>
        </div>
        <div className="dev-projects-body">
          {intro}
          {body}
        </div>
      </section>
    </div>
  );
}

interface SetupForProps {
  readonly origin: string;
  readonly tool: ToolChoice;
  readonly project: ProjectRef;
  readonly announce: (message: string) => void;
  readonly go: (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onAgentChanged: (agent: RegisteredAgent) => void;
}

/** Steps 2–5 for one tool and one project; remounted when either changes. */
function SetupFor({ origin, tool, project, announce, go, onAgentChanged }: SetupForProps) {
  const ids = useId();
  const [access, setAccess] = useState<Load<ProjectAccess>>({ kind: 'loading' });
  const [choice, setChoice] = useState<GrantChoice>('none');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [now] = useState(() => Date.now());
  const [records, setRecords] = useState<Load<readonly ProjectSetup[]>>({ kind: 'loading' });
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<unknown>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    setAccess({ kind: 'loading' });
    getProjectAccess(tool.id, project.slug, controller.signal)
      .then((value) => {
        setAccess({ kind: 'ready', value });
        setChoice(currentChoice(value));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAccess({ kind: 'error', error });
      });
    setRecords({ kind: 'loading' });
    listProjectSetups(project.slug, tool.id, controller.signal)
      .then((value) => {
        setRecords({ kind: 'ready', value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRecords({ kind: 'error', error });
      });
    return controller;
  }, [tool.id, project.slug]);

  useEffect(() => {
    const controller = load();
    return () => {
      controller.abort();
    };
  }, [load]);

  if (access.kind === 'loading') {
    return <LoadingState shape="row" count={1} label={`Checking ${tool.label}’s access`} />;
  }
  if (access.kind === 'error') {
    return (
      <ApiErrorState
        error={access.error}
        resource={`${tool.label}’s access to ${project.name}`}
        scope="project"
        verb="check"
        onRetry={load}
      />
    );
  }

  const value = access.value;
  const options = grantOptions(value);
  const current = currentChoice(value);
  const dirty = choice !== current;
  const canChange = value.can_grant.max !== null;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Read the agent again right before the write, so a grant changed
      // elsewhere since the page loaded is carried over, not lost.
      const fresh = await getAgent(tool.id);
      const changed = await setAgentGrants(
        tool.id,
        withOneGrant(fresh.grants, value.project.id, choice),
      );
      onAgentChanged(changed);
      const next = await getProjectAccess(tool.id, project.slug);
      setAccess({ kind: 'ready', value: next });
      setChoice(currentChoice(next));
      setSaved(true);
      announce(`${tool.label} now has ${grantLabel(currentChoice(next))} in ${project.name}.`);
    } catch (error: unknown) {
      setSaveError(error);
      announce(`Could not change ${tool.label}’s access.`);
    } finally {
      setSaving(false);
    }
  };

  const target = targetFor(tool.client);
  const block = markedProjectBlock(origin, project);
  const preamble = target.wrap('').trimEnd();
  const prompt = target.committable
    ? projectSetupPrompt({ origin, project, path: target.path, block, preamble })
    : undefined;
  const evidence = records.kind === 'ready' ? setupEvidence(records.value, tool.id) : null;
  const checkCommand = projectCheckCommand(project.slug);

  const record = async () => {
    setRecording(true);
    setRecordError(null);
    try {
      const made = await recordSelfReport({
        agentId: tool.id,
        projectSlug: project.slug,
        templateRevision: PROJECT_BLOCK_REVISION,
        instructionsPath: target.committable ? target.path : null,
      });
      setRecords((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', value: [...prev.value.filter((r) => r.id !== made.id), made] }
          : { kind: 'ready', value: [made] },
      );
      announce(`Recorded: you added the block for ${project.name}. Not verified.`);
    } catch (error: unknown) {
      setRecordError(error);
      announce('Could not record it.');
    } finally {
      setRecording(false);
    }
  };
  const roleWord = value.member.role === null ? 'Not a member' : ROLE_WORDS[value.member.role];
  const spaceSettings = `/spaces/${encodeURIComponent(project.slug)}/settings?tab=access`;

  return (
    <>
      <fieldset className="dev-setup-step" aria-describedby={`${ids}-access-facts`}>
        <legend className="dev-setup-legend">Access</legend>
        <dl className="dev-setup-facts" id={`${ids}-access-facts`}>
          <div>
            <dt>You</dt>
            <dd>
              {roleWord} of {value.project.name}
              {value.member.can_write ? '' : ' · you can read, not change'}
            </dd>
          </div>
          <div>
            <dt>{tool.label}</dt>
            <dd data-fact="grant">{grantLabel(current)}</dd>
          </div>
          <div>
            <dt>In effect</dt>
            <dd data-fact="effective">
              {grantLabel(value.effective)}
              {value.effective !== current && value.grant.scope !== null
                ? ' — never more than you, and the space, allow'
                : ''}
            </dd>
          </div>
        </dl>

        {!value.project.agents_allowed && (
          <Help tone="warn">
            Coding tools are turned off for this space, so any tool can only read here. A lead
            changes that in{' '}
            <a href={spaceSettings} onClick={go(spaceSettings)}>
              Space settings → Access
            </a>
            .
          </Help>
        )}

        <div
          className="dev-setup-grants"
          role="radiogroup"
          aria-labelledby={`${ids}-grant-label`}
          aria-describedby={`${ids}-grant-help`}
        >
          <span className="conn-label" id={`${ids}-grant-label`}>
            What {tool.label} may do in {value.project.name}
          </span>
          {options.map((option) => (
            <label
              key={option.value}
              className="dev-setup-grant"
              data-disabled={option.disabled === undefined ? undefined : 'true'}
            >
              <input
                type="radio"
                name={`${ids}-grant`}
                value={option.value}
                checked={choice === option.value}
                disabled={option.disabled !== undefined || saving}
                onChange={() => {
                  setChoice(option.value);
                  setSaved(false);
                }}
              />
              <span>{option.label}</span>
              {option.disabled !== undefined && (
                <span className="dev-setup-grant-why">{option.disabled}</span>
              )}
            </label>
          ))}
        </div>
        <p className="conn-note" id={`${ids}-grant-help`}>
          A tool starts with no access. Give it the least it needs; Full lets it create and change
          tasks here as you.
          {!canChange && ' This tool is disconnected, so it cannot be given access.'}
        </p>
        {choice === 'none' && (
          <p className="conn-note conn-info" data-note="no-access">
            With No access, {tool.label} will not see this project.
          </p>
        )}
        {saveError !== null && (
          <ApiErrorState
            error={saveError}
            resource={`${tool.label}’s access`}
            scope="project"
            verb="change"
          />
        )}
        <div className="dev-setup-actions">
          <button
            type="button"
            className="bar-control bar-control-primary"
            // aria-disabled, not disabled: the button keeps focus when a save
            // finishes and it has nothing left to save.
            aria-disabled={!dirty || saving || !canChange}
            aria-busy={saving}
            onClick={() => {
              if (!dirty || saving || !canChange) return;
              void save();
            }}
          >
            {saving && <Spinner size="sm" />}
            Save access
          </button>
          {saved && !dirty && <span className="conn-note">Saved.</span>}
        </div>
      </fieldset>

      <fieldset className="dev-setup-step">
        <legend className="dev-setup-legend">Instructions file</legend>
        {prompt !== undefined ? (
          <p className="conn-body">
            In the repository, paste this into {tool.toolName}. It reads <code>{target.path}</code>,
            shows you a diff, and changes only the Laika block in it — everything else in the file
            stays as you wrote it. It installs nothing and commits nothing.
          </p>
        ) : (
          <p className="conn-body">
            {tool.toolName} has no instructions file. Paste this block into its project instructions
            instead.
          </p>
        )}
        {target.note !== undefined && <p className="conn-note">{target.note}</p>}
        <p className="conn-note" data-note="optional">
          The block is optional: your tool reaches the board without it. It is needed when your
          local activity counts <em>only repos set up for Laika</em>, which look for this block.
        </p>
        {prompt !== undefined && (
          <CodeBlock
            label={`Paste into ${tool.toolName}, in the repo`}
            labelId={`${ids}-prompt`}
            tag="carries no token"
            text={prompt}
            what="the project setup prompt"
            main
            preClassName="conn-project-prompt"
          />
        )}
        <details className="dev-setup-manual" open={prompt === undefined}>
          <summary>{prompt === undefined ? 'The block' : 'Or edit the file yourself'}</summary>
          <CodeBlock
            label={`${target.path} — Laika block, instructions template revision ${String(PROJECT_BLOCK_REVISION)}`}
            labelId={`${ids}-block`}
            tag="carries no token"
            text={prompt === undefined ? block : target.wrap(block)}
            what={`the ${target.path} block`}
            preClassName="conn-project-block"
          />
        </details>
      </fieldset>

      {REPO_MCP_CONFIG_TOOLS.has(tool.client) && (
        <fieldset className="dev-setup-step" data-step="repo-mcp">
          <legend className="dev-setup-legend">Repo MCP config (optional, separate)</legend>
          <p className="conn-body">
            {tool.toolName} also reads its MCP config from a file in the repository. Run this inside
            the repository once. It writes no token.
          </p>
          <CodeBlock
            label="Terminal, in the repository"
            text={`laika connect ${tool.client} --project`}
            what="the command"
          />
        </fieldset>
      )}

      <fieldset className="dev-setup-step" data-step="record">
        <legend className="dev-setup-legend">Record it</legend>
        {records.kind === 'loading' ? (
          <LoadingState shape="row" count={1} label="Loading what is recorded" />
        ) : records.kind === 'error' ? (
          <ApiErrorState
            error={records.error}
            resource="what is recorded for this repository"
            scope="project"
            onRetry={load}
          />
        ) : evidence === null ? null : (
          <>
            <p className="conn-body" data-status={evidence.overall}>
              {evidence.overall === 'not-recorded' ? (
                <StatusChip
                  tone="neutral"
                  word="Not recorded"
                  reason="Laika cannot see your repository. Run laika project check in it to find out."
                />
              ) : evidence.overall === 'update-available' ? (
                <StatusChip
                  tone="warn"
                  word="Update available"
                  reason={`a record below is older than instructions template revision ${String(PROJECT_BLOCK_REVISION)}, or names another project. Paste the prompt again — it replaces only the block.`}
                />
              ) : evidence.overall === 'missing' ? (
                <StatusChip
                  tone="warn"
                  word="No block found"
                  reason="laika project check found no Laika block. Paste the prompt above in the repository."
                />
              ) : evidence.checks.some((r) => recordState(r) === 'current') ? (
                <StatusChip
                  tone="ok"
                  word="Checked"
                  reason="laika project check found the current block on your device."
                />
              ) : (
                <StatusChip tone="ok" word="Recorded by you" reason="not verified" />
              )}
            </p>
            {(evidence.checks.length > 0 || evidence.self !== null) && (
              <ul className="dev-setup-records" aria-label="Records for this repository">
                {evidence.checks.map((r) => (
                  <li key={r.id} data-source="local_check" data-state={recordState(r)}>
                    <span className="dev-setup-record-source">{recordSource(r, now)}</span>
                    <span className="conn-note">{recordFinding(r)}</span>
                  </li>
                ))}
                {evidence.self !== null && (
                  <li data-source="self_reported_browser" data-state={recordState(evidence.self)}>
                    <span className="dev-setup-record-source">
                      {recordSource(evidence.self, now)}
                    </span>
                    <span className="conn-note">{recordFinding(evidence.self)}</span>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
        <p className="conn-body" data-note="project-check">
          To check the file from your device, run this in the repository. It reads the instructions
          file, changes nothing, and records what it found with {tool.toolName}’s own credential.
        </p>
        <CodeBlock label="Terminal, in the repository" text={checkCommand} what="the command" />
        {recordError !== null && (
          <ApiErrorState error={recordError} resource="your record" scope="project" verb="save" />
        )}
        <div className="dev-setup-actions">
          <button
            type="button"
            className="bar-control"
            aria-disabled={recording || records.kind !== 'ready'}
            aria-busy={recording}
            onClick={() => {
              if (recording || records.kind !== 'ready') return;
              void record();
            }}
          >
            {recording && <Spinner size="sm" />}
            I’ve added it
          </button>
          <span className="conn-note">Self-reported. Laika does not check the file.</span>
        </div>
      </fieldset>
    </>
  );
}

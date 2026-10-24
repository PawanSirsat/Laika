import { useRef, useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { pickProject } from '../../../api/pick-project.ts';
import { useProjects } from '../../../api/use-projects.ts';
import {
  AGENT_GUIDES,
  guideFor,
  instructionsTarget,
  type AgentChoice,
} from '../connect/connect-agents.ts';
import { projectBlock, projectPrompt, type ProjectRef } from '../connect/connect-copy.ts';
import '../connect/connect.css';

/** The wizard's own key (`ConnectScreen`): read here so the tab opens on the agent just connected. */
const AGENT_KEY = 'laika.connect.agent';

function storedAgent(): string | null {
  try {
    return window.localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

/**
 * Agents that read their MCP config from a file **in the repository**, so a
 * project needs `laika connect <id> --project` run inside it as well as the
 * block (`cli/README.md`: VS Code's `.vscode/mcp.json`, Omnigent's
 * `tools/mcp/laika.yaml`). Everything else is set up once per machine.
 */
const PROJECT_FILE_AGENTS: ReadonlySet<AgentChoice> = new Set(['vscode', 'omnigent']);

export interface ProjectsTabProps {
  readonly origin: string;
}

/**
 * Projects (LAI-997): what is **once per project**, and nothing else.
 *
 * The machine was set up on Connect; this adds one repository to the board.
 * Pick the project and the agent, and the tab gives the block for that
 * agent's instructions file — to commit by hand — and a short prompt that has
 * the agent write it. Neither carries a token, and neither installs anything:
 * the one prompt that did both (LAI-622) is what made every new repo look
 * like a fresh install.
 */
export function ProjectsTab({ origin }: ProjectsTabProps) {
  const projects = useProjects();
  const [agentId, setAgentId] = useState<AgentChoice>(() => guideFor(storedAgent()).id);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const blockRef = useRef<HTMLPreElement | null>(null);
  const promptRef = useRef<HTMLPreElement | null>(null);

  const guide = guideFor(agentId);
  const target = instructionsTarget(guide.id);
  const chosen = pickProject(projects.projects, slug);
  const project: ProjectRef | undefined =
    chosen === undefined
      ? undefined
      : { slug: chosen.slug, prefix: chosen.prefix, name: chosen.name };
  const block = project === undefined ? undefined : target.wrap(projectBlock(origin, project));
  const prompt =
    project === undefined || block === undefined || !target.committable
      ? undefined
      : projectPrompt({ origin, project, path: target.path, block });

  return (
    <section className="dev-card dev-projects" aria-labelledby="dev-projects-title">
      <div className="dev-card-head">
        <h2 className="dev-card-title" id="dev-projects-title">
          Add this project
        </h2>
        <span className="conn-chip conn-chip-scope">Once per project</span>
      </div>
      <div className="dev-projects-body">
        <p className="conn-body">
          Your machine is set up on <a href="/developer?tab=connect">Connect</a>. This adds one
          repository to the board: a block in the agent’s instructions file that names the project,
          so every session that opens the repo works the right board without being told how. It
          carries no token and installs nothing. The rules themselves reach every agent from the
          board when it connects; this adds the project they belong to.
        </p>

        <div className="dev-projects-fields">
          <div className="conn-field">
            <label className="conn-label" htmlFor="dev-project-agent">
              Agent
            </label>
            <Dropdown
              id="dev-project-agent"
              variant="bare"
              className="conn-select"
              noun="agents"
              value={guide.id}
              options={AGENT_GUIDES.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(next) => {
                setAgentId(guideFor(next).id);
              }}
            />
          </div>

          {projects.status === 'ready' && project !== undefined && (
            <div className="conn-field">
              <label className="conn-label" htmlFor="dev-project">
                Project
              </label>
              <Dropdown
                id="dev-project"
                variant="bare"
                className="conn-select"
                noun="projects"
                value={project.slug}
                options={projects.projects
                  .filter((row): row is typeof row & { slug: string } => 'slug' in row)
                  .map((row) => ({ value: row.slug, label: row.name }))}
                onChange={(next) => {
                  setSlug(next);
                }}
              />
            </div>
          )}
        </div>

        {projects.status === 'loading' ? (
          <LoadingState shape="row" count={1} label="Loading your projects" />
        ) : projects.status === 'error' ? (
          <ApiErrorState error={projects.error} resource="your projects" scope="organisation" />
        ) : block === undefined || project === undefined ? (
          <EmptyState
            headline="No project to mirror work into"
            body="Setup still works without one — a session can connect and report in. Create a project and this block fills in with its slug."
          />
        ) : (
          <>
            {target.committable ? (
              <p className="conn-body">
                Commit this to <code>{target.path}</code> in the project, or paste the prompt below
                into {guide.name} in that repo and it writes the file for you.
              </p>
            ) : (
              <p className="conn-body">
                {guide.name} has no instructions file. Paste this into the Project instructions of
                the project you work in, and every chat there works the board without being told
                how.
              </p>
            )}
            {target.note !== undefined && <p className="conn-note">{target.note}</p>}
            {PROJECT_FILE_AGENTS.has(guide.id) && (
              <p className="conn-note conn-info" data-note="project-file">
                {guide.name} also reads its MCP config from a file in the repository: run{' '}
                <code>laika connect {guide.id} --project</code> inside it once. It writes no token.
              </p>
            )}

            <div className="conn-block">
              <div className="conn-block-bar">
                <span className="conn-block-label" id="dev-project-block-label">
                  {target.path} — carries no token
                </span>
                <CopyButton text={block} selects={blockRef} what={`the ${target.path} block`} />
              </div>
              <pre
                className="conn-pre conn-project-block"
                ref={blockRef}
                tabIndex={0}
                aria-labelledby="dev-project-block-label"
              >
                {block}
              </pre>
            </div>

            {prompt !== undefined && (
              <div className="conn-block">
                <div className="conn-block-bar">
                  <span className="conn-block-label" id="dev-project-prompt-label">
                    Paste into {guide.name}, in the repo — carries no token
                  </span>
                  <CopyButton text={prompt} selects={promptRef} what="the project prompt" />
                </div>
                <pre
                  className="conn-pre conn-project-prompt"
                  ref={promptRef}
                  tabIndex={0}
                  aria-labelledby="dev-project-prompt-label"
                >
                  {prompt}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

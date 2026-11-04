import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  getAgent,
  listAgents,
  setAgentGrants,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import { loadCliSource, type CliSource } from '../../../../api/developer-compat.ts';
import { everyPage } from '../../../../api/every-page.ts';
import { pickProject } from '../../../../api/pick-project.ts';
import { getProjectAccess, type ProjectAccess } from '../../../../api/project-access.ts';
import {
  listProjectSetups,
  recordSelfReport,
  type ProjectSetup,
} from '../../../../api/project-setups.ts';
import type { Project } from '../../../../api/projects.ts';
import { useProjects } from '../../../../api/use-projects.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../../components/Dropdown.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { Spinner } from '../../../../components/Spinner.tsx';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import {
  markedProjectBlock,
  PROJECT_BLOCK_REVISION,
  projectSetupPrompt,
  type ProjectRef,
} from '../../connect/connect-copy.ts';
import { DesignChip } from './DesignChip.tsx';
import { DesignWizard } from './DesignWizard.tsx';
import { DetailTiles } from './DetailTiles.tsx';
import { DxIcon } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { OVERVIEW_ADDRESSES } from './overview-state.ts';
import { SectionTitle } from './SectionTitle.tsx';
import { UpdateCliHelp } from './UpdateCliGuide.tsx';
import { GUIDE_TITLE } from './update-cli.ts';
import {
  cliMatchHint,
  connectedTools,
  currentChoice,
  doneSummary,
  GRANT_MEANINGS,
  grantLabel,
  grantOptions,
  hasRecord,
  levelChip,
  noDeviceCheck,
  parseStep,
  projectCheckCommand,
  recordFinding,
  recordSource,
  recordState,
  REPO_MCP_CONFIG_TOOLS,
  setupEvidence,
  setupRow,
  stepNumber,
  targetFor,
  verificationWords,
  withOneGrant,
  type CliMatchHint,
  type GrantChoice,
  type SetupEvidence,
  type SetupStep,
  type ToolChoice,
} from './project-setup.ts';
import '../../connect/connect.css';
import './project-setup-design.css';

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

const LOADING = { kind: 'loading' } as const;

const ROLE_WORDS = { lead: 'Lead', member: 'Member', viewer: 'Viewer' } as const;

const OVERVIEW_HREF = '/developer?tab=overview';

/** How often step 3 reads the records again while it is open. */
const RECHECK_MS = 5_000;

/** A change to the address: a value to set, or `null` to drop the key. */
type AddressChange = Readonly<Record<string, string | null>>;
type SetAddress = (change: AddressChange, options?: { readonly push?: boolean }) => void;
type Go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;

const STEP_NAMES = ['Choose project & tool', 'Copy project prompt', 'Review & verify'] as const;

/**
 * Developer access V3 → Project setup (LAI-1052, plan §G), drawn as the
 * owner's design's three-step wizard (LAI-1082): one repository at a time,
 * repeatable for every one.
 *
 * 1. **Choose project & tool** — a project of yours and one of your connected
 *    tools, and the tool's grant there as a chip and two facts from
 *    `GET /agents/:id/project-access`. *Change* opens the grant selector the
 *    server's `can_grant` allows; saving changes this project only, through
 *    the existing `PUT /agents/:id/grants`. No token is minted or shown, and
 *    *Continue* waits for a grant: the board refuses a record for a tool with
 *    none (LAI-1073).
 * 2. **Copy the setup prompt** — the tool's own file (`instructionsTarget`),
 *    the revision-2 prompt that updates only the Laika block in it, and the
 *    repo MCP config for the tools that read it from the repository.
 * 3. **Review & verify** — what is known about the block, from the board's
 *    records (§4.82): `laika project check`'s, verified on a device and read
 *    again while the step is open, apart from the reader's own *I've added
 *    it*, which is shown as theirs, never verified.
 * 4. **Done** — what was set up, and how it is known.
 *
 * Everything is in the address — `?project=`, `?tool=`, `?step=` — so the
 * page can be bookmarked, resumed and reached from another tab's row; a step
 * replaces the address rather than pushing it. `?view=setups` lists every
 * repository setup recorded across the reader's projects (LAI-1077); moving
 * between it and the wizard pushes, so Back returns to the list.
 *
 * The board never sees the repository, and the page never says it did.
 */
export function ProjectSetupTab({ origin, params, setParams, onNavigate }: ProjectSetupTabProps) {
  const projects = useProjects();
  const [agents, setAgents] = useState<Load<readonly RegisteredAgent[]>>(LOADING);
  const [message, announce] = useLiveRegion();
  const [now] = useState(() => Date.now());
  const ids = useId();

  const loadAgents = useCallback(() => {
    const controller = new AbortController();
    setAgents(LOADING);
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

  const go: Go = (to) => (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const setAddress: SetAddress = (change, options) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, options);
  };

  const choose = (key: 'project' | 'tool', value: string) => {
    if (key === 'tool') rememberTool(value);
    setAddress({ [key]: value });
  };

  const listing = params.get('view') === 'setups';
  const step = parseStep(params.get('step'));
  const titleId = `${ids}-title`;

  const viewSetups = (
    <button
      type="button"
      className="dx-btn dx-btn-sm"
      onClick={() => {
        setAddress({ view: 'setups' }, { push: true });
      }}
    >
      View existing setups
    </button>
  );
  const sectionTitle = (
    <SectionTitle
      title="Set up a project repository"
      titleId={titleId}
      sub="Once for each repository you work in."
      actions={viewSetups}
    />
  );

  let content: ReactNode;
  if (agents.kind === 'loading' || projects.status === 'loading') {
    content = (
      <>
        {sectionTitle}
        <LoadingState shape="row" count={2} label="Loading your tools and projects" />
      </>
    );
  } else if (agents.kind === 'error') {
    content = (
      <>
        {sectionTitle}
        <ApiErrorState
          error={agents.error}
          resource="your tools"
          scope="organisation"
          onRetry={loadAgents}
        />
      </>
    );
  } else if (projects.status === 'error') {
    content = (
      <>
        {sectionTitle}
        <ApiErrorState
          error={projects.error}
          resource="your projects"
          scope="organisation"
          onRetry={projects.reload}
        />
      </>
    );
  } else if (listing) {
    content = (
      <SetupsList
        titleId={titleId}
        agents={agents.value}
        projects={projects.projects}
        setAddress={setAddress}
      />
    );
  } else {
    const tools = connectedTools(agents.value, now);
    const project = pickProject(projects.projects, params.get('project') ?? undefined);
    const wanted = params.get('tool') ?? rememberedTool();
    const tool = tools.find((t) => t.id === wanted) ?? tools[0];
    if (tool === undefined) {
      content = (
        <EmptyCard
          icon="tool"
          title="No connected tools yet"
          body="Add a coding tool on one of your devices first. Then come back here to give it a project."
          action={
            <button
              type="button"
              className="dx-btn dx-btn-primary"
              onClick={() => {
                onNavigate(OVERVIEW_ADDRESSES.addTool);
              }}
            >
              Add a tool
            </button>
          }
        />
      );
    } else if (project === undefined) {
      content = (
        <EmptyCard
          icon="repo"
          title="No projects to set up"
          body="You are not a member of any project yet. A lead can add you, or you can create one from Projects."
        />
      );
    } else {
      content = (
        <SetupWizard
          origin={origin}
          now={now}
          tool={tool}
          project={{
            id: project.id,
            slug: project.slug,
            prefix: project.prefix,
            name: project.name,
          }}
          step={step}
          sectionTitle={sectionTitle}
          pickers={
            <div className="dx-ps-pickers">
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
          }
          announce={announce}
          go={go}
          setAddress={setAddress}
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
      );
    }
  }

  return (
    <div className="dx dx-ps dev-setup" data-view={listing ? 'setups' : 'wizard'}>
      <LiveRegion message={message} />
      {content}
    </div>
  );
}

function EmptyCard({
  icon,
  title,
  body,
  action,
}: {
  readonly icon: 'tool' | 'repo';
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}) {
  return (
    <section className="dx-card">
      <div className="dx-empty">
        <div className="dx-empty-icon">
          <DxIcon name={icon} size={22} />
        </div>
        <h3 className="dx-empty-title">{title}</h3>
        <p className="dx-empty-body">{body}</p>
        {action}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- data

interface SetupData {
  readonly access: Load<ProjectAccess>;
  readonly records: Load<readonly ProjectSetup[]>;
  readonly setAccess: (value: ProjectAccess) => void;
  readonly setRecords: Dispatch<SetStateAction<Load<readonly ProjectSetup[]>>>;
  readonly reload: () => void;
  /** Read the records again without dropping what is on screen meanwhile. */
  readonly refreshRecords: (signal?: AbortSignal) => void;
}

/**
 * The tool's access to the project and the records for both, for whichever
 * pair the address names. Held against the pair it was read for, so a change
 * of project or tool reads as loading at once rather than showing the last
 * pair's answer — without remounting the step, which would take focus off the
 * picker that changed it.
 */
function useSetupData(toolId: string, slug: string): SetupData {
  const key = `${toolId}\n${slug}`;
  const [state, setState] = useState<{
    readonly key: string;
    readonly access: Load<ProjectAccess>;
    readonly records: Load<readonly ProjectSetup[]>;
  }>({ key, access: LOADING, records: LOADING });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ key, access: LOADING, records: LOADING });
    getProjectAccess(toolId, slug, controller.signal)
      .then((value) => {
        setState((prev) =>
          prev.key === key ? { ...prev, access: { kind: 'ready', value } } : prev,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) =>
          prev.key === key ? { ...prev, access: { kind: 'error', error } } : prev,
        );
      });
    listProjectSetups(slug, toolId, controller.signal)
      .then((value) => {
        setState((prev) =>
          prev.key === key ? { ...prev, records: { kind: 'ready', value } } : prev,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) =>
          prev.key === key ? { ...prev, records: { kind: 'error', error } } : prev,
        );
      });
    return () => {
      controller.abort();
    };
  }, [key, toolId, slug, attempt]);

  const setAccess = useCallback(
    (value: ProjectAccess) => {
      setState((prev) => (prev.key === key ? { ...prev, access: { kind: 'ready', value } } : prev));
    },
    [key],
  );
  const setRecords: Dispatch<SetStateAction<Load<readonly ProjectSetup[]>>> = useCallback(
    (next) => {
      setState((prev) =>
        prev.key === key
          ? { ...prev, records: typeof next === 'function' ? next(prev.records) : next }
          : prev,
      );
    },
    [key],
  );
  const refreshRecords = useCallback(
    (signal?: AbortSignal) => {
      listProjectSetups(slug, toolId, signal)
        .then((value) => {
          setState((prev) =>
            prev.key === key ? { ...prev, records: { kind: 'ready', value } } : prev,
          );
        })
        .catch(() => {
          // A missed re-read keeps what is on screen; the next one tries again.
        });
    },
    [key, slug, toolId],
  );
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const current = state.key === key ? state : { access: LOADING, records: LOADING };
  return {
    access: current.access,
    records: current.records,
    setAccess,
    setRecords,
    reload,
    refreshRecords,
  };
}

// ------------------------------------------------------------------ wizard

interface SetupWizardProps {
  readonly origin: string;
  readonly now: number;
  readonly tool: ToolChoice;
  readonly project: ProjectRef & { readonly id: string };
  readonly step: SetupStep;
  readonly sectionTitle: ReactNode;
  readonly pickers: ReactNode;
  readonly announce: (message: string) => void;
  readonly go: Go;
  readonly setAddress: SetAddress;
  readonly onAgentChanged: (agent: RegisteredAgent) => void;
}

function SetupWizard({
  origin,
  now,
  tool,
  project,
  step: asked,
  sectionTitle,
  pickers,
  announce,
  go,
  setAddress,
  onAgentChanged,
}: SetupWizardProps) {
  const ids = useId();
  const data = useSetupData(tool.id, project.slug);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const pair = `${tool.id}:${project.slug}`;

  const evidence =
    data.records.kind === 'ready' ? setupEvidence(data.records.value, tool.id) : null;
  const recorded = evidence !== null && hasRecord(evidence);
  // *Done* says what was set up, so it waits for a record; without one the
  // address is taken back to the step that makes one.
  const doneWithout = asked === 'done' && evidence !== null && !recorded;
  const step: SetupStep = doneWithout ? 3 : asked;
  useEffect(() => {
    if (doneWithout) setAddress({ step: '3' });
  }, [doneWithout, setAddress]);

  // Focus follows a step change to its title, as every wizard here does; not
  // on the first render, which is the page loading.
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    titleRef.current?.focus();
  }, [step]);

  const toStep = (n: SetupStep) => {
    setAddress({ step: n === 1 ? null : String(n) });
  };

  const access = data.access;
  const granted = access.kind === 'ready' && access.value.grant.scope !== null;
  const target = targetFor(tool.client);

  if (step === 'done') {
    return (
      <DoneCard
        now={now}
        tool={tool}
        project={project}
        access={access}
        evidence={evidence}
        path={target.path}
        titleRef={titleRef}
        onRetry={data.reload}
        onAnother={() => {
          setAddress({ step: null });
        }}
        go={go}
      />
    );
  }

  const n = stepNumber(step);
  const steps = STEP_NAMES.map((name, i) => {
    const at = i + 1;
    const sub =
      at === 1
        ? access.kind === 'ready'
          ? `${levelChip(currentChoice(access.value)).word} · ${project.name}`
          : 'Authorize access'
        : at === 2
          ? 'Paste in the repository'
          : evidence !== null && recorded
            ? reviewWord(evidence)
            : 'Check before working';
    return {
      n: at,
      name,
      sub,
      done: at < n,
      open: at <= n,
      lockedReason:
        at === 2 && !granted
          ? `Give ${tool.label} access first.`
          : `Finish step ${String(at - 1)} first.`,
    };
  });

  const accessBody =
    access.kind === 'loading' ? (
      <LoadingState shape="row" count={1} label={`Checking ${tool.label}’s access`} />
    ) : access.kind === 'error' ? (
      <ApiErrorState
        error={access.error}
        resource={`${tool.label}’s access to ${project.name}`}
        scope="project"
        verb="check"
        onRetry={data.reload}
      />
    ) : null;

  let title: string;
  let line: string;
  let body: ReactNode;
  let note: ReactNode;
  let actions: ReactNode;
  const back = (to: SetupStep) => (
    <button
      type="button"
      className="dx-btn"
      onClick={() => {
        toStep(to);
      }}
    >
      Back
    </button>
  );

  if (step === 1) {
    title = 'Choose the project and connected tool';
    line = 'Project setup is separate from pairing a device and connecting a tool.';
    body = (
      <>
        <div className="dx-focus">
          <strong className="dx-focus-title">Project setup is the work-ready step</strong>
          <p className="dx-focus-body">
            Choose a Laika project and one of your connected tools. No re-pairing, no new install
            and no new credential.
          </p>
        </div>
        {pickers}
        <hr className="dx-divider dx-ps-divider" />
        {access.kind === 'ready' ? (
          <Authorization
            key={pair}
            tool={tool}
            project={project}
            access={access.value}
            announce={announce}
            go={go}
            onSaved={(next, agent) => {
              data.setAccess(next);
              onAgentChanged(agent);
            }}
          />
        ) : (
          accessBody
        )}
      </>
    );
    const why =
      access.kind === 'loading'
        ? `Checking ${tool.label}’s access.`
        : access.kind === 'error'
          ? `Could not check ${tool.label}’s access.`
          : granted
            ? 'Existing permissions stay as they are.'
            : `Give ${tool.label} access to ${project.name} to continue.`;
    note = <span id={`${ids}-continue-why`}>{why}</span>;
    actions = (
      <button
        type="button"
        className="dx-btn dx-btn-primary"
        aria-disabled={!granted}
        aria-describedby={granted ? undefined : `${ids}-continue-why`}
        onClick={() => {
          if (!granted) return;
          toStep(2);
        }}
      >
        Continue to prompt <span aria-hidden="true">→</span>
      </button>
    );
  } else if (step === 2) {
    title = target.committable
      ? `Copy the setup prompt for ${tool.toolName}`
      : `Copy the Laika block for ${tool.toolName}`;
    line = target.committable
      ? 'Run it in the repository: it changes only the Laika block in the instructions file.'
      : `${tool.toolName} has no instructions file, so the block goes into its project instructions.`;
    body = accessBody ?? (
      <PromptStep
        origin={origin}
        tool={tool}
        project={project}
        granted={granted}
        onGrant={() => {
          toStep(1);
        }}
      />
    );
    note = 'No password or token in this prompt.';
    actions = (
      <>
        {back(1)}
        <button
          type="button"
          className="dx-btn dx-btn-primary"
          onClick={() => {
            toStep(3);
          }}
        >
          {target.committable ? 'I ran this prompt' : 'I pasted the block'}{' '}
          <span aria-hidden="true">→</span>
        </button>
      </>
    );
  } else {
    title = 'Review and finish';
    line = 'Confirm the repository is ready to work against this board.';
    body = accessBody ?? (
      <ReviewStep
        key={pair}
        now={now}
        tool={tool}
        project={project}
        granted={granted}
        records={data.records}
        evidence={evidence}
        target={target}
        announce={announce}
        setRecords={data.setRecords}
        refreshRecords={data.refreshRecords}
        onRetry={data.reload}
      />
    );
    const why = recorded
      ? 'A project setup does not register a tool or mint a credential.'
      : projectCheckCommand(project.slug, tool.client) === null
        ? 'Record it yourself to finish.'
        : 'Run the check, or record it yourself, to finish.';
    note = <span id={`${ids}-finish-why`}>{why}</span>;
    actions = (
      <>
        {back(2)}
        <button
          type="button"
          className="dx-btn dx-btn-primary"
          aria-disabled={!recorded}
          aria-describedby={recorded ? undefined : `${ids}-finish-why`}
          onClick={() => {
            if (!recorded) return;
            toStep('done');
          }}
        >
          Finish <span aria-hidden="true">→</span>
        </button>
      </>
    );
  }

  return (
    <>
      {sectionTitle}
      <DesignWizard
        wizard="project-setup"
        railTitle="Project setup"
        railIntro="Once per repository, not per laptop."
        railLabel="Project setup steps"
        steps={steps}
        current={n}
        onSelect={(to) => {
          if (to === 1 || to === 2 || to === 3) toStep(to);
        }}
        step={n}
        total={3}
        kind="Project"
        title={title}
        line={line}
        titleId={`${ids}-step-title`}
        titleRef={titleRef}
        note={note}
        actions={actions}
        aside={<SetupAside />}
      >
        {body}
      </DesignWizard>
    </>
  );
}

/** The rail's line under *Review & verify* once something is recorded. */
function reviewWord(evidence: SetupEvidence): string {
  if (evidence.overall === 'update-available') return 'Update available';
  if (evidence.overall === 'missing') return 'No block found';
  return evidence.checks.some((r) => recordState(r) === 'current')
    ? 'Checked'
    : 'Recorded by you, not verified';
}

function SetupAside() {
  return (
    <>
      <section className="dx-card" aria-label="What stays separate">
        <div className="dx-card-pad">
          <p className="dx-label">What stays separate</p>
          <ul className="dx-ps-separate">
            <li className="dx-aside-item">
              <strong>Device</strong>
              <span>Paired once. Setting up a project never pairs it again.</span>
            </li>
            <li className="dx-aside-item">
              <strong>Tool</strong>
              <span>Its own identity and credential, connected once on its device.</span>
            </li>
            <li className="dx-aside-item">
              <strong>Project</strong>
              <span>A grant in Laika, then the prompt updates the repository’s instructions.</span>
            </li>
          </ul>
        </div>
      </section>
      <section className="dx-card" aria-label="What the prompt changes">
        <div className="dx-card-pad">
          <p className="dx-label">What the prompt changes</p>
          <ul className="dx-aside-list">
            <li>Only the Laika block in the tool’s instructions file.</li>
            <li>Everything else in the file stays as it is.</li>
            <li>It carries no token, and never asks for one.</li>
            <li>It installs nothing and pairs nothing.</li>
            <li>It commits nothing: you review the diff.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------- step 1: access

interface AuthorizationProps {
  readonly tool: ToolChoice;
  readonly project: ProjectRef & { readonly id: string };
  readonly access: ProjectAccess;
  readonly announce: (message: string) => void;
  readonly go: Go;
  readonly onSaved: (next: ProjectAccess, agent: RegisteredAgent) => void;
}

/**
 * The tool's grant in this project: a chip and two facts, and the selector
 * behind *Change* — open from the start while there is no grant, since that
 * is the one thing step 1 is waiting for. Remounted for each tool and
 * project, so a half-made choice never carries over to another pair.
 */
function Authorization({ tool, project, access, announce, go, onSaved }: AuthorizationProps) {
  const ids = useId();
  const [choice, setChoice] = useState<GrantChoice>(() => currentChoice(access));
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const options = grantOptions(access);
  const current = currentChoice(access);
  const dirty = choice !== current;
  const canChange = access.can_grant.max !== null;
  const granted = access.grant.scope !== null;
  const open = !granted || changing;
  const chip = levelChip(current);
  const roleWord = access.member.role === null ? 'Not a member' : ROLE_WORDS[access.member.role];
  const spaceSettings = `/spaces/${encodeURIComponent(project.slug)}/settings?tab=access`;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    // Kept open through the save, so *Saved.* is said where the choice was made.
    setChanging(true);
    try {
      // Read the agent again right before the write, so a grant changed
      // elsewhere since the page loaded is carried over, not lost.
      const fresh = await getAgent(tool.id);
      const changed = await setAgentGrants(
        tool.id,
        withOneGrant(fresh.grants, access.project.id, choice),
      );
      const next = await getProjectAccess(tool.id, project.slug);
      onSaved(next, changed);
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

  return (
    <div className="dx-ps-auth" data-granted={granted}>
      <div className="dx-ps-auth-head">
        <div className="dx-ps-auth-text">
          <strong className="dx-ps-auth-title" id={`${ids}-auth`}>
            Project authorization
          </strong>
          <dl className="dev-setup-facts dx-ps-facts" id={`${ids}-facts`}>
            <div>
              <dt>You</dt>
              <dd data-fact="you">
                {roleWord}
                {access.member.can_write ? '' : ' · you can read, not change'}
              </dd>
            </div>
            <div>
              <dt>In effect</dt>
              <dd data-fact="effective">
                {grantLabel(access.effective)}
                {access.effective !== current && granted
                  ? ' — never more than you, and the space, allow'
                  : ''}
              </dd>
            </div>
          </dl>
          <p className="dx-ps-auth-why">
            Laika checks this on every request. The instructions file grants nothing.
          </p>
        </div>
        <div className="dx-ps-auth-end">
          <span data-fact="grant">
            <span className="visually-hidden">{tool.label}: </span>
            <DesignChip tone={chip.tone}>{chip.word}</DesignChip>
          </span>
          {granted && (
            <button
              type="button"
              className="dx-btn dx-btn-sm"
              aria-expanded={changing}
              aria-controls={`${ids}-grants`}
              onClick={() => {
                setChanging((was) => !was);
              }}
            >
              Change
            </button>
          )}
        </div>
      </div>

      {!granted && (
        <NoteBlock tone="warn" title="Grant required" note="grant-required">
          <p>
            {tool.label} has no access to {project.name} yet. Give it access here before you set up
            the repository.
          </p>
        </NoteBlock>
      )}

      {!access.project.agents_allowed && (
        <NoteBlock tone="warn" title="Coding tools are off in this space" note="agents-off">
          <p>
            Any tool can only read here. A lead changes that in{' '}
            <a href={spaceSettings} onClick={go(spaceSettings)}>
              Space settings → Access
            </a>
            .
          </p>
        </NoteBlock>
      )}

      {open && (
        <div className="dx-ps-grants-panel" id={`${ids}-grants`}>
          <span className="conn-label" id={`${ids}-grant-label`}>
            What {tool.label} may do in {access.project.name}
          </span>
          <div
            className="dx-ps-grants"
            role="radiogroup"
            aria-labelledby={`${ids}-grant-label`}
            aria-describedby={`${ids}-grant-help`}
          >
            {options.map((option) => (
              <label
                key={option.value}
                className="dx-option dx-ps-grant"
                data-grant={option.value}
                data-disabled={option.disabled === undefined ? undefined : 'true'}
              >
                <input
                  type="radio"
                  name={`${ids}-grant`}
                  value={option.value}
                  checked={choice === option.value}
                  disabled={option.disabled !== undefined || saving}
                  aria-labelledby={`${ids}-${option.value}-name`}
                  aria-describedby={`${ids}-${option.value}-sub`}
                  onChange={() => {
                    setChoice(option.value);
                    setSaved(false);
                  }}
                />
                <span>
                  <strong className="dx-option-name" id={`${ids}-${option.value}-name`}>
                    {option.label}
                  </strong>
                  <span className="dx-option-sub" id={`${ids}-${option.value}-sub`}>
                    {option.disabled ?? GRANT_MEANINGS[option.value]}
                  </span>
                </span>
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
          <div className="dx-actions">
            <button
              type="button"
              className="dx-btn dx-btn-primary dx-btn-sm"
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
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- step 2: prompt

interface PromptStepProps {
  readonly origin: string;
  readonly tool: ToolChoice;
  readonly project: ProjectRef;
  readonly granted: boolean;
  readonly onGrant: () => void;
}

function PromptStep({ origin, tool, project, granted, onGrant }: PromptStepProps) {
  const ids = useId();
  const target = targetFor(tool.client);
  const block = markedProjectBlock(origin, project);
  const preamble = target.wrap('').trimEnd();
  const prompt = target.committable
    ? projectSetupPrompt({ origin, project, path: target.path, block, preamble })
    : undefined;
  const blockLabel = `${target.path} — Laika block, instructions template revision ${String(PROJECT_BLOCK_REVISION)}`;

  return (
    <>
      <div className="dx-focus">
        {prompt !== undefined ? (
          <>
            <strong className="dx-focus-title">
              Paste this into {tool.toolName} from the repository folder
            </strong>
            <p className="dx-focus-body">
              It reads <code>{target.path}</code>, shows you a diff, and changes only the Laika
              block in it — everything else in the file stays as you wrote it. It installs nothing
              and commits nothing.
            </p>
          </>
        ) : (
          <>
            <strong className="dx-focus-title">{tool.toolName} has no instructions file</strong>
            <p className="dx-focus-body">Paste this block into its project instructions instead.</p>
          </>
        )}
      </div>
      {!granted && (
        <NoteBlock tone="warn" title="Grant required" note="needs-grant">
          <p>
            {tool.label} has no access to {project.name} yet, so it cannot reach the board from this
            repository.{' '}
            <button type="button" className="dx-ps-link" onClick={onGrant}>
              Give it access in step 1
            </button>
            .
          </p>
        </NoteBlock>
      )}
      <DetailTiles
        items={[
          { label: 'Project', value: `${project.name} · ${project.slug}`, id: 'project' },
          {
            label: prompt === undefined ? 'Where it goes' : 'Target instructions file',
            value: target.path,
            id: 'target',
          },
        ]}
      />
      {target.note !== undefined && <p className="conn-note">{target.note}</p>}
      {prompt !== undefined ? (
        <>
          <CodeBlock
            label="Project prompt · no token"
            labelId={`${ids}-prompt`}
            text={prompt}
            what="the project setup prompt"
            main
            preClassName="conn-project-prompt"
          />
          <details className="dev-setup-manual dx-ps-manual">
            <summary>Or edit the file yourself</summary>
            <CodeBlock
              label={blockLabel}
              labelId={`${ids}-block`}
              tag="carries no token"
              text={target.wrap(block)}
              what={`the ${target.path} block`}
              preClassName="conn-project-block"
            />
          </details>
        </>
      ) : (
        <CodeBlock
          label={blockLabel}
          labelId={`${ids}-block`}
          tag="carries no token"
          text={block}
          what={`the ${target.path} block`}
          main
          preClassName="conn-project-block"
        />
      )}
      <p className="conn-note" data-note="optional">
        The block is optional: your tool reaches the board without it. It is needed when your local
        activity counts <em>only repos set up for Laika</em>, which look for this block.
      </p>
      {REPO_MCP_CONFIG_TOOLS.has(tool.client) && (
        <div data-step="repo-mcp">
          <NoteBlock title="Project-scoped configuration" note="repo-mcp">
            <p>
              {tool.toolName} also reads its MCP config from a file in the repository. That is a
              separate step this prompt does not take: run this inside the repository once. It
              writes no token.
            </p>
            <CodeBlock
              label="Terminal, in the repository"
              text={`laika connect ${tool.client} --project`}
              what="the command"
            />
          </NoteBlock>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- step 3: review

interface ReviewStepProps {
  readonly now: number;
  readonly tool: ToolChoice;
  readonly project: ProjectRef;
  readonly granted: boolean;
  readonly records: Load<readonly ProjectSetup[]>;
  readonly evidence: SetupEvidence | null;
  readonly target: ReturnType<typeof targetFor>;
  readonly announce: (message: string) => void;
  readonly setRecords: Dispatch<SetStateAction<Load<readonly ProjectSetup[]>>>;
  readonly refreshRecords: (signal?: AbortSignal) => void;
  readonly onRetry: () => void;
}

/**
 * What the board knows about the block, and the two ways to tell it: a
 * `laika project check` on the reader's device — the only *Checked* — or
 * their own *I've added it*. The records are read again when the window
 * regains focus and every few seconds while this step is open, so a check
 * run in a terminal shows here without a reload.
 */
function ReviewStep({
  now,
  tool,
  project,
  granted,
  records,
  evidence,
  target,
  announce,
  setRecords,
  refreshRecords,
  onRetry,
}: ReviewStepProps) {
  const ids = useId();
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<unknown>(null);
  const checkCommand = projectCheckCommand(project.slug, tool.client);
  const manual = noDeviceCheck(tool.toolName, tool.client);
  const [cliSource, setCliSource] = useState<CliSource | undefined>(undefined);
  const hint = cliMatchHint(cliSource);

  // The board's helper commit, for the hint: read once; unreadable says none.
  useEffect(() => {
    const controller = new AbortController();
    void loadCliSource(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setCliSource(answer);
    });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const again = () => {
      refreshRecords(controller.signal);
    };
    const timer = window.setInterval(again, RECHECK_MS);
    window.addEventListener('focus', again);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', again);
    };
  }, [refreshRecords]);

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

  const orb =
    evidence === null || evidence.overall === 'not-recorded'
      ? 'accent'
      : evidence.overall === 'current'
        ? undefined
        : 'warn';

  // What each row's mark says: a tick once that way has recorded something.
  const checkedHere = evidence !== null && evidence.checks.length > 0;
  const selfHere = evidence?.self ?? null;

  return (
    <div className="dx-ps-review" data-step="record">
      <div className="dx-status-head">
        <span className="dx-orb" data-tone={orb}>
          <DxIcon name="repo" />
        </span>
        <div>
          <h3 className="dx-ps-status-title">Review the repository setup</h3>
          <p className="dx-ps-status-line">
            {project.name} · {tool.label}
          </p>
        </div>
      </div>
      <p className="conn-body">
        The browser cannot see your repository. Laika knows what is in it only from a record: a
        check run on your device, or your own word.
      </p>

      {/*
        LAI-1099 #9: the two ways as the design's check rows — a mark, the way
        and its status, then its action — not two boxed cards.
      */}
      <section className="dx-ps-way" aria-labelledby={`${ids}-check`} data-way="check">
        <div className="dx-ps-way-head">
          <span className="dx-ps-way-mark" data-done={checkedHere || undefined} aria-hidden="true">
            <DxIcon name={checkedHere ? 'check' : 'tool'} size={16} />
          </span>
          <div className="dx-ps-way-text">
            <h4 className="dx-ps-way-title" id={`${ids}-check`}>
              Check it from your device
            </h4>
            {records.kind === 'loading' ? (
              <LoadingState shape="row" count={1} label="Loading what is recorded" />
            ) : records.kind === 'error' ? (
              <ApiErrorState
                error={records.error}
                resource="what is recorded for this repository"
                scope="project"
                onRetry={onRetry}
              />
            ) : evidence === null ? null : (
              <p className="dx-ps-status" data-status={evidence.overall} aria-live="polite">
                <EvidenceChip evidence={evidence} canCheck={checkCommand !== null} />
              </p>
            )}
          </div>
          {checkCommand !== null && <DesignChip tone="accent">Recommended</DesignChip>}
        </div>
        <div className="dx-ps-way-body">
          {checkCommand === null ? (
            // LAI-1091: `laika tool add` refuses this tool, so the check would
            // exit 2 and record nothing. Say so rather than offer it.
            <NoteBlock tone="warn" title={manual.title} note="no-device-check">
              <p className="conn-body">{manual.body}</p>
              {manual.note !== null && (
                <p className="conn-note" data-note="manual">
                  <InlineCode text={manual.note} />
                </p>
              )}
            </NoteBlock>
          ) : (
            <>
              <p className="conn-body" data-note="project-check">
                Run this in the repository. It reads the instructions file, changes nothing, and
                records what it found with {tool.toolName}’s own credential.
              </p>
              <CodeBlock
                label="Terminal, in the repository"
                text={checkCommand}
                what="the command"
              />
              <CliLine hint={hint} />
              <UpdateCliHelp place="project-setup" />
            </>
          )}
          {evidence !== null && evidence.checks.length > 0 && (
            <ul className="dev-setup-records dx-ps-records" aria-label="What the checks found">
              {evidence.checks.map((r) => (
                <li key={r.id} data-source="local_check" data-state={recordState(r)}>
                  <span className="dev-setup-record-source">{recordSource(r, now)}</span>
                  <span className="conn-note">{recordFinding(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="dx-ps-way" aria-labelledby={`${ids}-self`} data-way="self">
        <div className="dx-ps-way-head">
          <span
            className="dx-ps-way-mark"
            data-done={selfHere !== null || undefined}
            aria-hidden="true"
          >
            <DxIcon name={selfHere === null ? 'repo' : 'check'} size={16} />
          </span>
          <div className="dx-ps-way-text">
            <h4 className="dx-ps-way-title" id={`${ids}-self`}>
              Or record it yourself
            </h4>
            <p className="conn-note dx-ps-way-state">
              Self-reported. Laika does not check the file.
            </p>
          </div>
          <button
            type="button"
            className="dx-btn dx-btn-sm"
            aria-disabled={recording || records.kind !== 'ready' || !granted}
            aria-describedby={granted ? undefined : `${ids}-record-needs-access`}
            aria-busy={recording}
            onClick={() => {
              if (recording || records.kind !== 'ready' || !granted) return;
              void record();
            }}
          >
            {recording && <Spinner size="sm" />}
            I’ve added it
          </button>
        </div>
        {(selfHere !== null || recordError !== null || !granted) && (
          <div className="dx-ps-way-body">
            {selfHere !== null && (
              <ul className="dev-setup-records dx-ps-records" aria-label="What you recorded">
                <li data-source="self_reported_browser" data-state={recordState(selfHere)}>
                  <span className="dev-setup-record-source">{recordSource(selfHere, now)}</span>
                  <span className="conn-note">{recordFinding(selfHere)}</span>
                </li>
              </ul>
            )}
            {recordError !== null && (
              <ApiErrorState
                error={recordError}
                resource="your record"
                scope="project"
                verb="save"
              />
            )}
            {!granted && (
              <p
                className="conn-note"
                id={`${ids}-record-needs-access`}
                data-note="record-needs-access"
              >
                Give {tool.label} access to {project.name} first: a record names a tool that can
                work here.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Step 3's CLI line (LAI-1099 #9): one short sentence, and the LAI-1093 hint
 * behind *Help*, word for word. A disclosure, as the Overview's tools chip is:
 * focus stays on *Help* as it opens and `Tab` walks into it; `Escape` closes
 * it and puts focus back; a click outside, or focus leaving, closes it in
 * place. *How to update your Laika CLI* stays where it was, right under this.
 */
function CliLine({ hint }: { readonly hint: CliMatchHint }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    setOpen(false);
    button.current?.focus();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const to = event.relatedTarget as Node | null;
    if (!open || to === null || wrap.current?.contains(to) === true) return;
    setOpen(false);
  };

  return (
    <div className="dx-ps-cli" ref={wrap} onKeyDown={onKey} onBlur={onBlur} data-cli-line="">
      <p className="conn-note dx-ps-cli-line">
        Needs a Laika CLI that matches this board.{' '}
        <button
          type="button"
          className="dx-ps-link"
          aria-expanded={open}
          {...(open ? { 'aria-controls': popId } : {})}
          ref={button}
          onClick={() => {
            setOpen(!open);
          }}
        >
          Help
        </button>
      </p>
      {open && (
        <div className="dx-ps-help-pop" id={popId} role="group" aria-label="Which Laika CLI">
          <p className="conn-note" data-note="cli-match">
            This needs a Laika CLI that matches this board
            {hint.commit !== null && (
              <>
                {' '}
                (commit <code>{hint.commit}</code>)
              </>
            )}
            . Check with <code>{hint.version}</code>: if it prints a commit,{' '}
            <code>{hint.update}</code> brings it to this board’s. If either says unknown command,
            your CLI predates this board: {GUIDE_TITLE}, below, shows where it comes from and what
            to do about it, wherever the old one is.
          </p>
        </div>
      )}
    </div>
  );
}

function EvidenceChip({
  evidence,
  canCheck,
}: {
  readonly evidence: SetupEvidence;
  /** `false` when step 3 offers no `laika project check` for the tool (LAI-1091). */
  readonly canCheck: boolean;
}) {
  if (evidence.overall === 'not-recorded') {
    return (
      <StatusChip
        tone="neutral"
        word="Not recorded"
        reason={
          canCheck
            ? 'Laika cannot see your repository. Run laika project check in it to find out.'
            : 'Laika cannot see your repository. Record it yourself with I’ve added it.'
        }
      />
    );
  }
  if (evidence.overall === 'update-available') {
    return (
      <StatusChip
        tone="warn"
        word="Update available"
        reason={`a record below is older than instructions template revision ${String(PROJECT_BLOCK_REVISION)}, or names another project or task-key prefix. Paste the prompt again — it replaces only the block.`}
      />
    );
  }
  if (evidence.overall === 'missing') {
    return (
      <StatusChip
        tone="warn"
        word="No block found"
        reason="laika project check found no Laika block. Paste the prompt from step 2 in the repository."
      />
    );
  }
  return evidence.checks.some((r) => recordState(r) === 'current') ? (
    <StatusChip
      tone="ok"
      word="Checked"
      reason="laika project check found the current block on your device."
    />
  ) : (
    <StatusChip tone="ok" word="Recorded by you" reason="not verified" />
  );
}

// -------------------------------------------------------------------- done

interface DoneCardProps {
  readonly now: number;
  readonly tool: ToolChoice;
  readonly project: ProjectRef & { readonly id: string };
  readonly access: Load<ProjectAccess>;
  readonly evidence: SetupEvidence | null;
  readonly path: string;
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
  readonly onRetry: () => void;
  readonly onAnother: () => void;
  readonly go: Go;
}

/** What was set up, and how it is known — never more than the records say. */
function DoneCard({
  now,
  tool,
  project,
  access,
  evidence,
  path,
  titleRef,
  onRetry,
  onAnother,
  go,
}: DoneCardProps) {
  const ids = useId();
  let body: ReactNode;
  if (access.kind === 'error') {
    body = (
      <ApiErrorState
        error={access.error}
        resource={`${tool.label}’s access to ${project.name}`}
        scope="project"
        verb="check"
        onRetry={onRetry}
      />
    );
  } else if (access.kind === 'loading' || evidence === null) {
    body = <LoadingState shape="row" count={2} label="Loading the repository setup" />;
  } else {
    const summary = doneSummary({
      evidence,
      effective: access.value.effective,
      toolName: tool.toolName,
      projectName: project.name,
      path,
    });
    body = (
      <>
        <div className="dx-status-head">
          <span className="dx-orb" data-tone={summary.tone === 'warn' ? 'warn' : undefined}>
            <DxIcon name={summary.tone === 'warn' ? 'alert' : 'check'} />
          </span>
          <div>
            <p className="dx-eyebrow dx-ps-done-eyebrow">{summary.eyebrow}</p>
            <h2 className="dx-ps-done-title" id={`${ids}-done`} tabIndex={-1} ref={titleRef}>
              {project.name} · {tool.label}
            </h2>
            <p className="dx-ps-status-line">
              {tool.toolName} · {path}
            </p>
          </div>
        </div>
        <NoteBlock
          tone={summary.tone === 'warn' ? 'warn' : 'accent'}
          title={summary.title}
          note="done"
        >
          <p>{summary.body}</p>
        </NoteBlock>
        <DetailTiles
          items={[
            { label: 'Project', value: `${project.slug} (${project.prefix})`, id: 'project' },
            { label: 'Tool', value: tool.label, id: 'tool' },
            { label: 'Instructions file', value: path, id: 'file' },
            {
              label: 'Verification',
              value: verificationWords(evidence, now),
              id: 'verification',
            },
          ]}
        />
        <div className="dx-actions">
          <button type="button" className="dx-btn dx-btn-primary" onClick={onAnother}>
            Set up another repository <span aria-hidden="true">→</span>
          </button>
          <a className="dx-btn" href={OVERVIEW_HREF} onClick={go(OVERVIEW_HREF)}>
            Back to overview
          </a>
        </div>
      </>
    );
  }
  return (
    <section
      className="dx-card dx-ps-done"
      aria-labelledby={`${ids}-done`}
      data-wizard="project-setup"
      data-step="done"
    >
      <div className="dx-card-pad">{body}</div>
    </section>
  );
}

// ------------------------------------------------------------- setups list

interface SetupsListProps {
  readonly titleId: string;
  readonly agents: readonly RegisteredAgent[];
  readonly projects: readonly Project[];
  readonly setAddress: SetAddress;
}

/**
 * Every repository setup the reader has recorded, across every project they
 * can read, newest first (LAI-1077) — one line each, *Open* taking the setup
 * back to its step 3.
 */
function SetupsList({ titleId, agents, projects, setAddress }: SetupsListProps) {
  const [records, setRecords] = useState<Load<readonly ProjectSetup[]>>(LOADING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRecords(LOADING);
    listProjectSetups(undefined, undefined, controller.signal)
      .then((value) => {
        setRecords({ kind: 'ready', value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRecords({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  // Between the list and the wizard is a move the reader will want Back to
  // undo, so it pushes; a step within the wizard replaces.
  const start = () => {
    setAddress({ view: null, step: null }, { push: true });
  };

  let rows: ReactNode;
  if (records.kind === 'loading') {
    rows = (
      <li className="dx-record">
        <LoadingState shape="row" count={2} label="Loading your repository setups" />
      </li>
    );
  } else if (records.kind === 'error') {
    rows = (
      <li className="dx-record">
        <ApiErrorState
          error={records.error}
          resource="your repository setups"
          scope="organisation"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </li>
    );
  } else if (records.value.length === 0) {
    rows = (
      <li className="dx-record" data-row="none">
        <div className="dx-record-main">
          <span className="dx-record-sub">
            Nothing is recorded yet. A setup shows here once laika project check, or your own I’ve
            added it, records it.
          </span>
        </div>
      </li>
    );
  } else {
    rows = records.value.map((record) => {
      const row = setupRow(record, agents, projects.find((p) => p.id === record.project_id)?.name);
      return (
        <li
          key={record.id}
          className="dx-record"
          data-setup={record.id}
          data-source={record.source}
        >
          <span className="dx-icon">
            <DxIcon name={row.chip.word === 'Checked' ? 'check' : 'repo'} />
          </span>
          <div className="dx-record-main">
            <strong className="dx-record-title">{row.title}</strong>
            <span className="dx-record-sub">{row.sub}</span>
          </div>
          <div className="dx-record-end">
            <DesignChip tone={row.chip.tone}>{row.chip.word}</DesignChip>
            {row.toolId !== null && (
              <button
                type="button"
                className="dx-btn dx-btn-sm"
                aria-label={`Open ${row.title}`}
                onClick={() => {
                  setAddress(
                    { view: null, project: record.project_slug, tool: row.toolId, step: '3' },
                    { push: true },
                  );
                }}
              >
                Open <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </li>
      );
    });
  }

  return (
    <>
      <SectionTitle
        title="Your repository setups"
        titleId={titleId}
        sub="What laika project check found, and what you recorded yourself, newest first."
        actions={
          <button type="button" className="dx-btn dx-btn-sm" onClick={start}>
            Back to setup
          </button>
        }
      />
      <section className="dx-card" aria-labelledby={titleId}>
        <ul className="dx-records dx-ps-setups" aria-label="Repository setups">
          <li className="dx-record" data-row="new">
            <span className="dx-icon">
              <DxIcon name="repo" />
            </span>
            <div className="dx-record-main">
              <strong className="dx-record-title">A new repository</strong>
              <span className="dx-record-sub">
                Choose a project and one of your connected tools, then copy its prompt.
              </span>
            </div>
            <div className="dx-record-end">
              <button type="button" className="dx-btn dx-btn-primary dx-btn-sm" onClick={start}>
                Set up a new repository <span aria-hidden="true">→</span>
              </button>
            </div>
          </li>
          {rows}
        </ul>
      </section>
    </>
  );
}

/** Text with `backticked` runs set as code, as `AddToolWizard` shows a manual note. */
function InlineCode({ text }: { readonly text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}

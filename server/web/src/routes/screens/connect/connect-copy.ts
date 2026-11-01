/**
 * The text this page hands people (LAI-622).
 *
 * **Pure, and deliberately not in the component.** Every string here is a
 * deliverable — the prompt a developer pastes into Claude Code, and the block
 * a lead commits to a repository — so each is asserted by
 * `connect-copy.test.ts` without a renderer, a DOM or a browser.
 *
 * ## Two blocks, one of which must never carry a secret
 *
 * They sit inches apart on the page and are built by the same module, which is
 * exactly why the distinction is written down here and tested:
 *
 *  - {@link machinePrompt} **carries the token.** It is pasted into a session, so
 *    the secret lands in that transcript. The owner chose that trade for a
 *    single paste; the page says so plainly and names the revoke path.
 *  - {@link projectBlock} **must not.** It is committed to a git repository.
 *    A token in it is a leak, not a bug, and `connect-copy.test.ts` asserts its
 *    absence rather than trusting this paragraph. {@link projectPrompt} wraps
 *    it for an agent to write, and carries no token either.
 *
 * ## Two prompts, two scopes (LAI-507)
 *
 * The machine prompt is **once per machine**: it installs, checks the board
 * answers, and — when the organisation collects local activity — turns the
 * collector on. It never touches a repository. The project prompt is **once
 * per project**: it writes the block into the agent's instructions file and
 * nothing else. The one prompt that did both (LAI-622) made every new repo
 * look like a fresh install.
 */

/** Stands in for the token until one is minted, so nothing reads `undefined`. */
export const PLACEHOLDER_TOKEN = 'lai_…';

/** Where the plugin is cloned from. Not derivable — no endpoint serves it. */
export const PLUGIN_REPO = 'https://github.com/PawanSirsat/Laika.git';

/** Where the clone lands. One copy serves every repository on the machine. */
export const PLUGIN_HOME = '~/laika';

export interface ProjectRef {
  readonly slug: string;
  readonly prefix: string;
  readonly name: string;
}

/**
 * The block a lead commits, so later sessions mirror work onto the board
 * without being told to.
 *
 * It teaches the board's rules rather than its endpoints: an agent that has the
 * tools still needs to know that claiming comes before coding, and that
 * finishing means *review*, never *done*.
 *
 * **Agent-neutral** (LAI-737). It was `claudeMdBlock` and said nothing
 * Claude-specific even then; what changes per agent is the *file* it goes in,
 * which `instructionsTarget` in `connect-agents.ts` decides. The rules are the
 * ones the server hands every agent as `instructions` and `laika_whoami`'s
 * `how_to_work` (LAI-736) — this adds the per-project lines the server cannot
 * know.
 */
export function projectBlock(origin: string, project: ProjectRef): string {
  return `## Laika

This project is tracked on a Laika board. Mirror work onto it as you go — the
board is the source of truth, not this transcript.

- Board: ${origin}
- Project slug: \`${project.slug}\` — the \`project\` argument for every Laika tool
- Task keys look like \`${project.prefix}-42\`. Use the key, never an id.

Every session working in this repo:

1. **Read first.** \`laika_whoami\` confirms who you are acting as;
   \`get_project_context\` for \`${project.slug}\` carries the brief, the open work,
   and who is on it.
2. **Claim before code.** \`list_ready_tasks\`, then \`start_working\` on the
   task with the \`branch\` you work on — also when it is already yours and in
   progress — before anything else, and again whenever you move to another
   task. A task assigned to you that is not started yet: \`update_status\` to
   \`in_progress\`. One task at a time. A refusal means somebody else holds it
   — take another rather than forcing it.
   Name the branch after the key: \`${project.prefix}-42-short-name\`. Laika ties
   the tokens your session spends to the task you marked; work before it, or on
   a branch without a key, counts for no task.
3. **No task? Make one.** \`create_task\` before doing the work. Untracked work is
   invisible work.
4. **Say what happened.** \`add_comment\` on the task as you go — decisions and
   blockers, while they are fresh.
5. **Finish into review, never done.** \`finish_task\` moves it to review with
   your proof (commits, branch, pull request, test commands and exit codes): an
   agent never marks work done, a person does. A task a person sent back opens
   with their reason in \`get_task_context\`: fix that first, then
   \`finish_task\` again with fresh proof.
6. **Stray findings** — a broken script, a stale dependency — go to
   \`log_unlisted_work\` so they are triaged rather than lost.

If the Laika tools are not available, this session is not connected: say so and
stop, rather than working untracked.`;
}

export interface MachinePromptInput {
  readonly origin: string;
  /** The minted secret, or `undefined` before one exists. */
  readonly secret: string | undefined;
  /**
   * The organisation collects local activity (its *Developer insights*
   * switch, D-102 amended), so the collector is turned on as the last step.
   * `false` leaves it out entirely: `laika activity on` refuses while the
   * switch is off, and a step that is known to fail is noise.
   */
  readonly insightsOn: boolean;
}

/** The last line of a machine setup when the organisation collects local activity. */
export const ACTIVITY_ON = `${PLUGIN_HOME}/cli/bin/laika activity on --yes`;

/**
 * The one paste that sets a **machine** up (LAI-507; was `setupPrompt`,
 * which also wrote the project block).
 *
 * Ordered so the first thing that can fail, fails first and alone — and it ends
 * by telling Claude **not** to use the tools it has just installed, because
 * Claude Code loads plugins at startup and they cannot exist in a session that
 * began before the install. Without that line a session spends ten minutes
 * calling a tool that is not there and reports the setup broken.
 *
 * Idempotent on purpose: a machine already set up is told to skip the install
 * and go to the check, so a developer who pastes it twice loses nothing.
 */
export function machinePrompt({ origin, secret, insightsOn }: MachinePromptInput): string {
  const token = secret ?? PLACEHOLDER_TOKEN;

  const activityStep = insightsOn
    ? `4. Turn on local activity for this machine. The organisation collects per-day
   counts (prompts, agent sessions, commits, token totals — never the work
   itself) and this installs the hooks that count them:

   ${ACTIVITY_ON}

   Show me its output as it is. If it says sharing is off, say so and go on.`
    : `4. Nothing to do here: the organisation does not collect local activity.`;

  return `Set up Laika on this machine. This is once per machine, not per project:
do not write into this repository or any other.

Board:  ${origin}
Token:  ${token}

That token is a password. Do not write it into any repository, into .env, into
CLAUDE.md, or into any file git tracks. Do not echo it back to me.

Do these in order. Stop at the first one that fails and tell me what it said.
If \`laika whoami\` already answers with my name, this machine is set up: skip
1 and 2 and go to 3.

1. Get the plugin. It lives outside any project, so one copy serves every repo:

   git clone ${PLUGIN_REPO} ${PLUGIN_HOME} 2>/dev/null \\
     || git -C ${PLUGIN_HOME} pull --ff-only

2. Run the installer, feeding it the two answers on stdin so neither value ever
   appears as a command-line argument:

   ${PLUGIN_HOME}/plugin/scripts/install.sh <<'LAIKA_SETUP'
${origin}
${token}
LAIKA_SETUP

   It stores the settings readable only by me and puts \`laika\` and
   \`laika-claude\` commands on my PATH. Show me its output as it is.

3. Check the board answers to that token:

   curl -sS -H "Authorization: Bearer ${token}" ${origin}/api/v1/me

   Tell me the name and email it returns. If it answers 401, stop — the token is
   wrong, expired or revoked, and nothing after this can work.

${activityStep}

5. Report back in three lines and nothing else:
   - whether the installer ran or was skipped, and where the \`laika-claude\`
     command is
   - who the board says I am
   - anything you had to change to make a step work

6. Then stop. Do not try to use the Laika tools in this session — Claude Code
   loads plugins at startup, so they cannot exist in a session that started
   before the install. I will quit and restart with \`laika-claude\`. Adding a
   project to the board is a separate, shorter paste from the Projects tab.`;
}

export interface ProjectPromptInput {
  readonly origin: string;
  readonly project: ProjectRef;
  /** The agent's instructions file, from `instructionsTarget` — `CLAUDE.md`, `AGENTS.md`, … */
  readonly path: string;
  /** The block as the file should carry it, already wrapped for the agent. */
  readonly block: string;
}

/** The first line of the block, which is what the prompt looks for before writing. */
export const BLOCK_MARKER = 'This project is tracked on a Laika board.';

/**
 * The short paste that adds **one project** (LAI-507): it writes the block
 * into the agent's instructions file in the repo it is run in, and nothing
 * else. No install, no token, no check — the machine prompt did those once.
 */
export function projectPrompt({ origin, project, path, block }: ProjectPromptInput): string {
  return `Add this repository's project on the Laika board (${origin}) to ${path}. This
is once per project; it installs nothing and carries no token.

1. If ./${path} contains the line "${BLOCK_MARKER}", the block is already
   there: tell me so and stop.
2. Otherwise append the block below to ./${path}, keeping everything already
   in the file. Create the file if it does not exist. Copy the block exactly —
   it deliberately contains no token, and it must not gain one.
3. Change nothing else, and do not commit: I will review the diff.
4. Report in one line: whether you created the file or appended to it.

--- begin block ---
${block}
--- end block ---

The project is \`${project.slug}\` (${project.name}); its task keys look like
\`${project.prefix}-42\`.`;
}

/**
 * The repository file's template version (plan LAI-1042 §G, LAI-1052). It
 * counts changes to {@link markedProjectBlock}, and nothing else: it is **not**
 * `context_revision`, which versions the project brief the board serves over
 * MCP. The two never share a name, a field or a line on the page.
 *
 * Revision 1 is the unmarked block {@link projectBlock} still writes on the
 * classic Projects tab; revision 2 wraps the same text in begin and end
 * markers so a later revision can replace exactly it.
 */
export const PROJECT_BLOCK_REVISION = 2;

/** The end marker. The begin marker carries the revision and the project. */
export const BLOCK_END = '<!-- laika:end -->';

export function blockBegin(slug: string, revision: number = PROJECT_BLOCK_REVISION): string {
  return `<!-- laika:begin revision=${String(revision)} project=${slug} -->`;
}

const BEGIN = /<!-- laika:begin revision=(\d+)[^>]*-->/;

/**
 * Revision 2: {@link projectBlock} unchanged between the markers, so its first
 * line is still `## Laika` and its third still {@link BLOCK_MARKER} — the line
 * `laika activity`'s *Only repos set up for Laika* scope looks for.
 */
export function markedProjectBlock(origin: string, project: ProjectRef): string {
  return `${blockBegin(project.slug)}
${projectBlock(origin, project)}
${BLOCK_END}`;
}

export type BlockOutcome = 'created' | 'appended' | 'updated' | 'current';

export interface ReplacedBlock {
  readonly text: string;
  readonly outcome: BlockOutcome;
  /** The revision replaced: `1` for the unmarked block, `null` when none was. */
  readonly from: number | null;
}

/**
 * What {@link projectSetupPrompt} asks a tool to do to the instructions file,
 * as a pure function, so the rules are tested on fixtures rather than trusted
 * to prose.
 *
 * - No file (`null`): `create`, which is `block` already wrapped for the tool.
 * - A marked block at this revision or later: untouched.
 * - A marked block that is older: everything from its begin marker to its end
 *   marker is replaced, and nothing else.
 * - Revision 1: the `## Laika` section whose first paragraph carries
 *   {@link BLOCK_MARKER}, up to the next heading of level one or two or the end
 *   of the file, is replaced.
 * - Neither: `block` is appended after a blank line, and the rest is kept.
 *
 * Everything outside the replaced span is byte-identical to `text`.
 */
export function replaceLaikaBlock(
  text: string | null,
  block: string,
  create: string = block,
): ReplacedBlock {
  if (text === null) return { text: `${create}\n`, outcome: 'created', from: null };

  const begin = BEGIN.exec(text);
  if (begin !== null) {
    const end = text.indexOf(BLOCK_END, begin.index);
    if (end !== -1) {
      const revision = Number(begin[1]);
      if (revision >= PROJECT_BLOCK_REVISION) return { text, outcome: 'current', from: null };
      const after = end + BLOCK_END.length;
      return {
        text: text.slice(0, begin.index) + block + text.slice(after),
        outcome: 'updated',
        from: revision,
      };
    }
  }

  const legacy = legacySection(text);
  if (legacy !== null) {
    const [start, stop] = legacy;
    return { text: text.slice(0, start) + block + text.slice(stop), outcome: 'updated', from: 1 };
  }

  const gap = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${text}${gap}${block}\n`, outcome: 'appended', from: null };
}

/** `[start, end)` of a revision-1 block, trailing blank lines excluded, or `null`. */
function legacySection(text: string): [number, number] | null {
  const heading = /^## Laika[ \t]*$/gm;
  for (let match = heading.exec(text); match !== null; match = heading.exec(text)) {
    const bodyStart = match.index + match[0].length;
    const rest = text.slice(bodyStart);
    const firstParagraph = rest.replace(/^\s*\n/, '').split(/\n[ \t]*\n/)[0] ?? '';
    if (!firstParagraph.includes(BLOCK_MARKER)) continue;
    const next = /^#{1,2} /m.exec(rest);
    let stop = next === null ? text.length : bodyStart + next.index;
    while (stop > match.index && /\s/.test(text.charAt(stop - 1))) stop -= 1;
    return [match.index, stop];
  }
  return null;
}

export interface ProjectSetupPromptInput {
  readonly origin: string;
  readonly project: ProjectRef;
  /** The tool's instructions file, from `instructionsTarget` — `CLAUDE.md`, `AGENTS.md`, … */
  readonly path: string;
  /** {@link markedProjectBlock}, as it sits in the file (never the wrapper). */
  readonly block: string;
  /**
   * What the tool's file must start with when it is created — Cursor's rule
   * frontmatter — or `''` when nothing. Never repeated in a file that exists.
   */
  readonly preamble?: string;
}

/**
 * The Project setup prompt (plan §G, LAI-1052): the revision-2 successor to
 * {@link projectPrompt}, which the classic tab still uses unchanged.
 *
 * It **updates in place**: it reads the file first, touches only the Laika
 * block — {@link replaceLaikaBlock}'s rules, in words — shows the diff before
 * any replacement, and leaves every other line as the person wrote it. It
 * carries no token and asks for none, and it installs, pairs, configures and
 * commits nothing: the device and the tool were set up once, elsewhere.
 */
export function projectSetupPrompt({
  origin,
  project,
  path,
  block,
  preamble = '',
}: ProjectSetupPromptInput): string {
  return `Set this repository up for the Laika board (${origin}), project \`${project.slug}\`
(${project.name}), by updating ./${path}. Only the Laika block in that file is
yours to change; everything else in it belongs to the people who wrote it.

1. Read ./${path} first. Do not assume what is in it.
2. If it has a line starting "<!-- laika:begin revision=" with a revision of
   ${String(PROJECT_BLOCK_REVISION)} or more, it is already up to date: tell me so and stop.
3. If it has a Laika block — from "<!-- laika:begin" to "${BLOCK_END}", or,
   from before the markers existed, the "## Laika" section whose first
   paragraph says "${BLOCK_MARKER}", up to the next heading of the same or a
   higher level or the end of the file — show me the exact old and new text
   as a diff and wait for me to confirm. Then replace only that block. If I
   edited lines inside the old block, point them out in the diff so I can
   keep them.
4. If there is no Laika block, append the block below at the end, keeping
   everything already in the file. Create the file only if it does not exist.${
     preamble === ''
       ? ''
       : `
   A new file starts with these lines, before the block:

${preamble}
`
   }
5. Copy the block exactly. It contains no token and must never gain one: do
   not add a token, key or password anywhere, and do not ask me for one.
6. Change nothing else. Do not install, reinstall or update Laika, do not pair
   a device, do not edit any MCP configuration, and do not commit or push: I
   will review the change myself.
7. Report in one line: created the file, appended the block, updated it from
   revision N, or already up to date.

--- begin block ---
${block}
--- end block ---`;
}

/** The commands for someone who would rather not hand it to an agent. */
export function manualCommands(): string {
  return `git clone ${PLUGIN_REPO} ${PLUGIN_HOME}
${PLUGIN_HOME}/plugin/scripts/install.sh`;
}

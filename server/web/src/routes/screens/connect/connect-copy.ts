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
 *  - {@link setupPrompt} **carries the token.** It is pasted into a session, so
 *    the secret lands in that transcript. The owner chose that trade for a
 *    single paste; the page says so plainly and names the revoke path.
 *  - {@link claudeMdBlock} **must not.** It is committed to a git repository.
 *    A token in it is a leak, not a bug, and `connect-copy.test.ts` asserts its
 *    absence rather than trusting this paragraph.
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
 */
export function claudeMdBlock(origin: string, project: ProjectRef): string {
  return `## Laika

This project is tracked on a Laika board. Mirror work onto it as you go — the
board is the source of truth, not this transcript.

- Board: ${origin}
- Project slug: \`${project.slug}\` — the \`project\` argument for every Laika tool
- Task keys look like \`${project.prefix}-42\`. Use the key, never an id.

Every session working in this repo:

1. **Read first.** \`get_project_context\` for \`${project.slug}\` carries the brief,
   the open work, and who is on it.
2. **Claim before code.** \`list_ready_tasks\`, then \`start_working\`. One task at a
   time. A refusal means somebody already holds it — take another rather than
   forcing it.
3. **No task? Make one.** \`create_task\` before doing the work. Untracked work is
   invisible work.
4. **Say what happened.** \`add_comment\` on the task as you go — decisions and
   blockers, while they are fresh.
5. **Finish into review, never done.** \`finish_task\` hands it to a human. Agents
   do not close their own work.
6. **Stray findings** — a broken script, a stale dependency — go to
   \`log_unlisted_work\` so they are triaged rather than lost.

If the Laika tools are not available, this session is not connected: say so and
stop, rather than working untracked.`;
}

export interface PromptInput {
  readonly origin: string;
  /** The minted secret, or `undefined` before one exists. */
  readonly secret: string | undefined;
  readonly project: ProjectRef | undefined;
}

/**
 * The one paste that sets a machine up.
 *
 * Ordered so the first thing that can fail, fails first and alone — and it ends
 * by telling Claude **not** to use the tools it has just installed, because
 * Claude Code loads plugins at startup and they cannot exist in a session that
 * began before the install. Without that line a session spends ten minutes
 * calling a tool that is not there and reports the setup broken.
 */
export function setupPrompt({ origin, secret, project }: PromptInput): string {
  const token = secret ?? PLACEHOLDER_TOKEN;
  const block = project === undefined ? undefined : claudeMdBlock(origin, project);

  const claudeMdStep =
    block === undefined
      ? `4. Skip this step — no project was selected on the Connect page, so there
   is no board block to add yet.`
      : `4. Add the Laika block to this project's CLAUDE.md, so every future session in
   this repo mirrors its work onto the board without being asked. If ./CLAUDE.md
   exists, append the block and keep everything already there; if it does not,
   create it. Copy the block exactly — it deliberately contains no token, and it
   must not gain one.

--- begin block ---
${block}
--- end block ---`;

  return `Set up Laika on this machine and connect this project to the board.

Board:  ${origin}
Token:  ${token}

That token is a password. Do not write it into this repository, into .env, into
CLAUDE.md, or into any file git tracks. Do not echo it back to me.

Do these in order. Stop at the first one that fails and tell me what it said.

1. Get the plugin. It lives outside any project, so one copy serves every repo:

   git clone ${PLUGIN_REPO} ${PLUGIN_HOME} 2>/dev/null \\
     || git -C ${PLUGIN_HOME} pull --ff-only

2. Run the installer, feeding it the two answers on stdin so neither value ever
   appears as a command-line argument:

   ${PLUGIN_HOME}/plugin/scripts/install.sh <<'LAIKA_SETUP'
${origin}
${token}
LAIKA_SETUP

   It stores the settings readable only by me and puts a \`laika-claude\` command
   on my PATH. Show me its output as it is.

3. Check the board answers to that token:

   curl -sS -H "Authorization: Bearer ${token}" ${origin}/api/v1/me

   Tell me the name and email it returns. If it answers 401, stop — the token is
   wrong, expired or revoked, and nothing after this can work.

${claudeMdStep}

5. Report back in four lines and nothing else:
   - whether the installer finished, and where it put the \`laika-claude\` command
   - who the board says I am
   - whether CLAUDE.md now carries the block, and whether you created the file
     or appended to one
   - anything you had to change to make a step work

6. Then stop. Do not try to use the Laika tools in this session — Claude Code
   loads plugins at startup, so they cannot exist in a session that started
   before the install. I will quit and restart with \`laika-claude\`.`;
}

/** The commands for someone who would rather not hand it to an agent. */
export function manualCommands(): string {
  return `git clone ${PLUGIN_REPO} ${PLUGIN_HOME}
${PLUGIN_HOME}/plugin/scripts/install.sh`;
}

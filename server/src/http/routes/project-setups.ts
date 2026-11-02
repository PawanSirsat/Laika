import { Hono, type Context } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { registeredAgent } from '../../services/claims.ts';
import {
  listProjectSetups,
  recordProjectSetup,
  REPO_LABEL_MAX,
  type ProjectSetupView,
} from '../../services/project-setups.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, parseQuery, strictObject, z } from '../validation.ts';

export interface ProjectSetupRouteOptions {
  db: Db;
}

const ProjectSlug = z.string().trim().min(1).max(200);

/** A revision of the instructions template (`PROJECT_BLOCK_REVISION`). */
const TemplateRevision = z.number().int().min(1).max(1000);

/**
 * A path **relative to the repository**, from a short list of instructions
 * files: no leading `/` or `~`, no `..`, no backslash, no drive letter — so an
 * absolute path, and the username a home directory carries, cannot be stored.
 */
const InstructionsPath = z
  .string()
  .max(120)
  .regex(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);

/** The browser's *I've added it*, the owner signed in. */
const BrowserBody = strictObject({
  agent_id: z.string().min(1).max(64).nullable(),
  project_slug: ProjectSlug,
  template_revision: TemplateRevision,
  instructions_path: InstructionsPath.nullable().optional(),
});

/**
 * What `laika project check` read, on the agent's own token. The agent is the
 * token's — an `agent_id` here is refused `422` as an unknown field.
 */
const LocalCheckBody = strictObject({
  project_slug: ProjectSlug,
  /** SHA-256 of the normalised remote URL (or of the label), lower-case hex. */
  repo_key: z.string().regex(/^[0-9a-f]{64}$/),
  repo_label: z.string().trim().min(1).max(REPO_LABEL_MAX),
  instructions_path: InstructionsPath.nullable(),
  block_found: z.boolean(),
  template_revision: TemplateRevision.nullable(),
  block_project: z.string().min(1).max(200).nullable(),
  block_prefix: z.string().min(1).max(32).nullable(),
});

const ListQuery = z.object({
  project: ProjectSlug,
  agent_id: z.string().min(1).max(64).optional(),
});

function requireActor(c: Context<AppEnv>) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/**
 * Mounted at `/api/v1/project-setups` (§4.82, LAI-1066). The body a caller may
 * send follows who it is: an agent's token sends a local check, anyone else
 * the browser's record — and the service refuses the combinations that are
 * neither.
 */
export function projectSetupRoutes(options: ProjectSetupRouteOptions): Hono<AppEnv> {
  const { db } = options;
  const app = new Hono<AppEnv>();

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const raw: unknown = await c.req.json().catch(() => null);
    if (registeredAgent(actor) !== null) {
      const body = parseBody(LocalCheckBody, raw);
      return c.json<ProjectSetupView>(
        recordProjectSetup(db, actor, {
          source: 'local_check',
          projectSlug: body.project_slug,
          repoKey: body.repo_key,
          repoLabel: body.repo_label,
          instructionsPath: body.instructions_path,
          blockFound: body.block_found,
          templateRevision: body.template_revision,
          blockProject: body.block_project,
          blockPrefix: body.block_prefix,
        }),
        201,
      );
    }
    const body = parseBody(BrowserBody, raw);
    return c.json<ProjectSetupView>(
      recordProjectSetup(db, actor, {
        source: 'self_reported_browser',
        agentId: body.agent_id,
        projectSlug: body.project_slug,
        templateRevision: body.template_revision,
        instructionsPath: body.instructions_path ?? null,
      }),
      201,
    );
  });

  app.get('/', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(ListQuery, c.req.query());
    return c.json<{ data: ProjectSetupView[] }>({
      data: listProjectSetups(db, actor, query.project, query.agent_id),
    });
  });

  return app;
}

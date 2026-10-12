/**
 * The per-agent setup the Connect page hands people (LAI-737).
 *
 * Every shape asserted here is one `/tmp/agent-client-configs/REPORT.md`
 * verified against the client's own docs or source, quoted rather than
 * paraphrased: the key names are the part that differs between clients, and
 * the part a person cannot debug from a 401.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_GUIDES,
  guideFor,
  instructionsTarget,
  likelyCauses,
  setupBlocks,
  startGuide,
  type AgentChoice,
  type SetupBlock,
} from '../../../../src/routes/screens/connect/connect-agents.ts';
import { PLACEHOLDER_TOKEN } from '../../../../src/routes/screens/connect/connect-copy.ts';

const ORIGIN = 'http://board.example.test:9999';
const SECRET = 'lai_ThisIsTheWholeSecretAndMustNotEscape';
const ctx = { origin: ORIGIN, secret: SECRET };

const blocks = (id: AgentChoice): readonly SetupBlock[] => setupBlocks(id, ctx);
const block = (id: AgentChoice, key: string): SetupBlock => {
  const found = blocks(id).find((b) => b.key === key);
  assert.ok(found !== undefined, `${id} has no block "${key}"`);
  return found;
};
const json = (id: AgentChoice, key: string): Record<string, unknown> =>
  JSON.parse(block(id, key).text) as Record<string, unknown>;
/** `obj.a.b.c`, failing loudly on a missing step rather than reading undefined. */
function at(value: unknown, ...path: string[]): unknown {
  let here = value;
  for (const step of path) {
    assert.ok(typeof here === 'object' && here !== null, `no "${step}" in ${JSON.stringify(here)}`);
    here = (here as Record<string, unknown>)[step];
  }
  return here;
}

/** What the owner asked the picker to offer, by name. */
const WANTED: Readonly<Record<AgentChoice, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  'gemini-cli': 'Gemini CLI',
  vscode: 'VS Code / Copilot',
  windsurf: 'Windsurf',
  omnigent: 'Omnigent',
  hermes: 'Hermes',
  zed: 'Zed',
  cline: 'Cline / Roo Code',
  continue: 'Continue',
  'claude-desktop': 'Claude Desktop',
  kiro: 'Kiro',
  goose: 'Goose',
  amp: 'Amp',
  junie: 'JetBrains / Junie',
  warp: 'Warp',
  any: 'Any MCP client',
  rest: 'No MCP (REST / CLI)',
};

void describe('the picker offers every agent asked for, and nothing invented', () => {
  void test('names from both sides', () => {
    const offered = new Map(AGENT_GUIDES.map((g) => [g.id, g.name]));
    for (const [id, name] of Object.entries(WANTED)) {
      assert.equal(offered.get(id as AgentChoice), name, `${id} is not offered as "${name}"`);
    }
    for (const guide of AGENT_GUIDES) {
      assert.ok(guide.id in WANTED, `${guide.id} is offered and nobody asked for it`);
    }
  });

  void test('the primary agents come first, the rest after', () => {
    const firstMore = AGENT_GUIDES.findIndex((g) => !g.primary);
    assert.ok(firstMore > 0, 'nothing is primary, or nothing is under More');
    assert.ok(
      AGENT_GUIDES.slice(firstMore).every((g) => !g.primary),
      'a primary agent is listed among the More ones',
    );
    for (const id of ['claude-code', 'codex', 'cursor', 'any', 'rest'] as const) {
      assert.ok(guideFor(id).primary, `${id} is hidden under More`);
    }
  });

  void test('an unknown or missing choice falls back to Claude Code, never a blank page', () => {
    assert.equal(guideFor('teleporter').id, 'claude-code');
    assert.equal(guideFor(null).id, 'claude-code');
    assert.equal(guideFor('codex').id, 'codex');
    assert.equal(AGENT_GUIDES[0]?.id, 'claude-code', 'the default is no longer first');
  });

  void test('Antigravity says it is not yet verified', () => {
    // REPORT §7: agy sends `server/discover` before `initialize`, and three open
    // issues report failures against servers shaped like Laika's.
    assert.match(guideFor('antigravity').beta ?? '', /not yet verified/i);
  });
});

void describe('the token goes where it must and nowhere else', () => {
  void test('CONTROL: a block marked tokenless never carries the token', () => {
    for (const guide of AGENT_GUIDES) {
      for (const b of setupBlocks(guide.id, ctx)) {
        if (b.token !== 'none') continue;
        assert.ok(!b.text.includes(SECRET), `${guide.id}/${b.key} carries the secret`);
        assert.doesNotMatch(b.text, /lai_/, `${guide.id}/${b.key} carries a token shape`);
      }
    }
  });

  void test('a block that carries it really does, and an inline config says so', () => {
    for (const guide of AGENT_GUIDES) {
      for (const b of setupBlocks(guide.id, ctx)) {
        if (b.token === 'none') continue;
        assert.ok(b.text.includes(SECRET), `${guide.id}/${b.key} claims the token and lacks it`);
        if (b.token === 'inline') {
          assert.match(b.warn ?? '', /token/i, `${guide.id}/${b.key} inlines it without a warning`);
        }
      }
    }
  });

  void test('only clients that cannot read an environment variable get an inline config', () => {
    // REPORT: Antigravity and Zed have no env expansion; Junie and Warp are
    // unverified and documented with a literal; Kiro, Claude Desktop and
    // JetBrains AI Assistant go through the mcp-remote bridge, whose `env`
    // block is the only place a GUI-launched process can be handed a value.
    const inline = AGENT_GUIDES.filter((g) =>
      setupBlocks(g.id, ctx).some((b) => b.token === 'inline'),
    ).map((g) => g.id);
    assert.deepEqual(
      [...inline].sort(),
      ['antigravity', 'any', 'claude-desktop', 'junie', 'kiro', 'warp', 'zed'].sort(),
    );
  });

  void test('with no token minted, every block reads a placeholder, never `undefined`', () => {
    for (const guide of AGENT_GUIDES) {
      for (const b of setupBlocks(guide.id, { origin: ORIGIN, secret: undefined })) {
        assert.doesNotMatch(b.text, /\bundefined\b/, `${guide.id}/${b.key}`);
        if (b.token !== 'none')
          assert.ok(b.text.includes(PLACEHOLDER_TOKEN), `${guide.id}/${b.key}`);
      }
    }
  });

  void test('every block names this board, not one baked in', () => {
    for (const guide of AGENT_GUIDES) {
      const all = setupBlocks(guide.id, ctx)
        .map((b) => b.text)
        .join('\n');
      assert.doesNotMatch(all, /52\.72\.203\.206|kvelld\.internal/, guide.id);
    }
  });

  void test('every JSON block parses', () => {
    for (const guide of AGENT_GUIDES) {
      for (const b of setupBlocks(guide.id, ctx)) {
        if (b.lang !== 'json') continue;
        assert.doesNotThrow(() => JSON.parse(b.text), `${guide.id}/${b.key} is not JSON`);
      }
    }
  });
});

void describe('each client gets its own verified shape', () => {
  const URL = `${ORIGIN}/mcp`;

  void test('Claude Code keeps the plugin as the recommended path, `claude mcp add` beside it', () => {
    const keys = blocks('claude-code').map((b) => b.key);
    assert.equal(keys[0], 'claude-prompt', 'the plugin prompt is not first');
    assert.match(block('claude-code', 'claude-mcp-add').text, /claude mcp add --transport http/);
    const project = json('claude-code', 'claude-mcp-json');
    assert.equal(at(project, 'mcpServers', 'laika', 'type'), 'http');
    assert.equal(
      at(project, 'mcpServers', 'laika', 'headers', 'Authorization'),
      'Bearer ${LAIKA_TOKEN}',
    );
  });

  void test('Codex names the variable, and the URL literally', () => {
    const toml = block('codex', 'codex-toml').text;
    assert.match(toml, /^\[mcp_servers\.laika\]$/m);
    assert.match(toml, /^bearer_token_env_var = "LAIKA_TOKEN"$/m);
    assert.ok(toml.includes(`url = "${URL}"`), 'Codex does not interpolate the URL');
  });

  void test('Cursor uses ${env:…}', () => {
    const cfg = json('cursor', 'cursor-json');
    assert.equal(at(cfg, 'mcpServers', 'laika', 'url'), URL);
    assert.equal(
      at(cfg, 'mcpServers', 'laika', 'headers', 'Authorization'),
      'Bearer ${env:LAIKA_TOKEN}',
    );
  });

  void test('Gemini CLI uses type http and ${…}', () => {
    const cfg = json('gemini-cli', 'gemini-json');
    assert.equal(at(cfg, 'mcpServers', 'laika', 'type'), 'http');
    assert.equal(
      at(cfg, 'mcpServers', 'laika', 'headers', 'Authorization'),
      'Bearer ${LAIKA_TOKEN}',
    );
  });

  void test('OpenCode uses {env:…} with no dollar, type remote, OAuth off', () => {
    const cfg = json('opencode', 'opencode-json');
    assert.equal(at(cfg, 'mcp', 'laika', 'type'), 'remote');
    assert.equal(at(cfg, 'mcp', 'laika', 'oauth'), false);
    assert.equal(at(cfg, 'mcp', 'laika', 'headers', 'Authorization'), 'Bearer {env:LAIKA_TOKEN}');
  });

  void test('VS Code uses `servers` and a password input, so the file carries nothing', () => {
    const cfg = json('vscode', 'vscode-json');
    assert.equal(at(cfg, 'servers', 'laika', 'type'), 'http');
    assert.equal(
      at(cfg, 'servers', 'laika', 'headers', 'Authorization'),
      'Bearer ${input:laika-token}',
    );
    assert.equal(at(cfg, 'inputs', '0', 'password'), true);
  });

  void test('Antigravity uses serverUrl, and the token inline', () => {
    const cfg = json('antigravity', 'antigravity-json');
    assert.equal(at(cfg, 'mcpServers', 'laika', 'serverUrl'), URL);
    assert.equal(at(cfg, 'mcpServers', 'laika', 'headers', 'Authorization'), `Bearer ${SECRET}`);
  });

  void test('Windsurf uses serverUrl and ${env:…}', () => {
    const cfg = json('windsurf', 'windsurf-json');
    assert.equal(at(cfg, 'mcpServers', 'laika', 'serverUrl'), URL);
    assert.equal(
      at(cfg, 'mcpServers', 'laika', 'headers', 'Authorization'),
      'Bearer ${env:LAIKA_TOKEN}',
    );
  });

  void test('Cline wants streamableHttp; Roo wants streamable-http', () => {
    assert.equal(at(json('cline', 'cline-json'), 'mcpServers', 'laika', 'type'), 'streamableHttp');
    assert.equal(at(json('cline', 'roo-json'), 'mcpServers', 'laika', 'type'), 'streamable-http');
  });

  void test('Continue reads a secret, Omnigent a transport, Hermes its own prompt', () => {
    assert.match(
      block('continue', 'continue-yaml').text,
      /Bearer \$\{\{ secrets\.LAIKA_TOKEN \}\}/,
    );
    assert.match(block('omnigent', 'omnigent-sidecar').text, /^transport: http$/m);
    assert.match(block('omnigent', 'omnigent-sidecar').text, /Bearer \$\{LAIKA_TOKEN\}/);
    assert.match(
      block('hermes', 'hermes-add').text,
      /hermes mcp add laika --url \S+ --auth header/,
    );
  });

  void test('the bridge clients get mcp-remote, pinned, with --allow-http', () => {
    for (const id of ['kiro', 'claude-desktop', 'zed', 'junie', 'any'] as const) {
      const bridge = blocks(id).find((b) => b.key.endsWith('bridge'));
      assert.ok(bridge !== undefined, `${id} has no bridge`);
      for (const flag of [
        'mcp-remote@0.14.3',
        '--allow-http',
        'http-only',
        'Authorization:${LAIKA_AUTH}',
      ]) {
        assert.ok(bridge.text.includes(flag), `${id}'s bridge lacks ${flag}`);
      }
    }
  });

  void test('No MCP gets REST with a bearer and the laika CLI', () => {
    const all = blocks('rest')
      .map((b) => b.text)
      .join('\n');
    assert.match(all, /curl .*Authorization: Bearer \$LAIKA_TOKEN.*\/api\/v1\/me/);
    assert.match(all, /laika whoami/);
  });

  void test('the agents `laika connect` writes for are offered it', () => {
    for (const id of ['codex', 'cursor', 'gemini-cli', 'opencode', 'antigravity'] as const) {
      assert.match(block(id, 'cli').text, new RegExp(`laika connect ${id}$`, 'm'), id);
    }
  });
});

void describe('where the project instructions go', () => {
  void test('the file follows the agent', () => {
    const expect: Partial<Record<AgentChoice, string>> = {
      'claude-code': 'CLAUDE.md',
      codex: 'AGENTS.md',
      opencode: 'AGENTS.md',
      amp: 'AGENTS.md',
      goose: 'AGENTS.md',
      'gemini-cli': 'GEMINI.md',
      antigravity: 'GEMINI.md',
      cursor: '.cursor/rules/laika.mdc',
      vscode: '.github/copilot-instructions.md',
      windsurf: '.windsurf/rules/laika.md',
      cline: '.clinerules/laika.md',
      continue: '.continue/rules/laika.md',
      kiro: '.kiro/steering/laika.md',
    };
    for (const [id, path] of Object.entries(expect)) {
      assert.equal(instructionsTarget(id as AgentChoice).path, path, id);
    }
  });

  void test('a Cursor rule is always applied', () => {
    assert.match(
      instructionsTarget('cursor').wrap('BODY'),
      /^---\n[\s\S]*alwaysApply: true\n---\n\nBODY$/,
    );
  });

  void test('a plain markdown target takes the block as it is', () => {
    assert.equal(instructionsTarget('codex').wrap('BODY'), 'BODY');
  });
});

void describe('starting and diagnosing', () => {
  void test('every agent says how to start it and why it might not connect', () => {
    for (const guide of AGENT_GUIDES) {
      assert.ok(startGuide(guide.id).body.length > 20, `${guide.id} has no start guide`);
      assert.ok(likelyCauses(guide.id).length > 0, `${guide.id} has no likely causes`);
    }
  });

  void test('an env-reading agent names the unset variable as a cause', () => {
    for (const id of ['codex', 'cursor', 'gemini-cli', 'opencode', 'omnigent'] as const) {
      assert.ok(
        likelyCauses(id).some((cause) => cause.includes('LAIKA_TOKEN')),
        `${id}'s causes never mention LAIKA_TOKEN`,
      );
    }
  });
});

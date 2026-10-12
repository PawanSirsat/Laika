import { describe, expect, it } from 'vitest';
import {
  AGENT_CLIENTS,
  agentClientSlug,
  cleanClientName,
  CLIENT_NAME_MAX_LENGTH,
  isWeakClientName,
} from '../../src/auth/agent-clients.ts';

/**
 * Which coding agent is on the other end of a token (D-076, LAI-736).
 *
 * The client names are the ones measured from each agent's MCP `initialize`.
 * Codex and VS Code are the two not yet observed, so they are matched loosely.
 */

describe('a client name maps to its agent', () => {
  it.each([
    ['claude-code', 'claude-code'],
    ['Claude', 'claude-code'],
    ['codex-mcp-client', 'codex'],
    ['Codex', 'codex'],
    ['Cursor', 'cursor'],
    ['opencode', 'opencode'],
    ['gemini-cli-mcp-client', 'gemini-cli'],
    ['Visual Studio Code', 'vscode'],
    ['vscode', 'vscode'],
    ['Code - OSS', 'vscode'],
    ['Windsurf', 'windsurf'],
    ['codeium', 'windsurf'],
    ['Antigravity', 'antigravity'],
    ['agy', 'antigravity'],
    ['hermes-agent', 'hermes'],
    ['Omnigent', 'omnigent'],
    ['antigravity-client', 'antigravity'],
    ['cursor-vscode', 'cursor'],
    ['Zed', 'zed'],
    ['Cline', 'cline'],
    ['Roo Code', 'roo'],
    ['continue-client', 'continue'],
    ['Kiro', 'kiro'],
    ['goose', 'goose'],
    ['amp', 'amp'],
    ['Junie', 'junie'],
    ['Warp', 'warp'],
    ['claude-ai', 'claude-desktop'],
    ['Claude Desktop', 'claude-desktop'],
  ])('%s → %s', (name, slug) => {
    expect(agentClientSlug(name, 'whatever')).toBe(slug);
  });

  it('is case-insensitive', () => {
    expect(agentClientSlug('CLAUDE-CODE', null)).toBe('claude-code');
    expect(agentClientSlug('OpenCode', null)).toBe('opencode');
  });

  it('does not read a short name out of the middle of a word', () => {
    // `agy`, `zed`, `amp`… are short enough to sit inside an unrelated word.
    // Only a whole word counts.
    for (const name of [
      'stagyard',
      'authorized',
      'example',
      'decline',
      'broom',
      'kirov',
      'warped',
    ]) {
      expect(agentClientSlug(name, null), name).toBe('other');
    }
  });
});

describe('a generic or unknown client falls back to the token name', () => {
  it('reads the first word of the token name for a generic client', () => {
    // Omnigent sends `mcp`. The Connect screen names tokens "<agent> on <os>".
    expect(agentClientSlug('mcp', 'omnigent on macOS')).toBe('omnigent');
    expect(agentClientSlug('', 'codex on Linux')).toBe('codex');
    expect(agentClientSlug(null, 'cursor on Windows')).toBe('cursor');
  });

  it('recognises the names tokens already carry', () => {
    expect(agentClientSlug('mcp', 'laika-claude on macOS')).toBe('claude-code');
  });

  it('reads only the first word, not the rest of the name', () => {
    // "my codex token" is a person's description, not an agent's name.
    expect(agentClientSlug('mcp', 'agent for codex')).toBe('other');
  });

  it('prefers a recognised client over the token name', () => {
    expect(agentClientSlug('Cursor', 'codex on Linux')).toBe('cursor');
  });

  it("answers 'other' when neither says", () => {
    expect(agentClientSlug('test-agent', 'agent')).toBe('other');
    expect(agentClientSlug(null, null)).toBe('other');
  });
});

describe('the vocabulary', () => {
  it('lists every slug the normaliser can return, and other last', () => {
    expect(AGENT_CLIENTS).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'opencode',
      'gemini-cli',
      'vscode',
      'windsurf',
      'antigravity',
      'hermes',
      'omnigent',
      'zed',
      'cline',
      'roo',
      'continue',
      'kiro',
      'goose',
      'amp',
      'junie',
      'warp',
      'claude-desktop',
      'other',
    ]);
  });
});

describe('a client name is cleaned before it is stored', () => {
  it('strips control and bidi characters', () => {
    // U+202E would reverse the rest of the line on the Tokens screen.
    expect(cleanClientName('\u202Eevil\u0007 client\u200B')).toBe('evil client');
  });

  it(`caps at ${String(CLIENT_NAME_MAX_LENGTH)} characters`, () => {
    expect(cleanClientName('x'.repeat(200))).toHaveLength(CLIENT_NAME_MAX_LENGTH);
    expect(CLIENT_NAME_MAX_LENGTH).toBe(64);
  });

  it('does not split a character in two at the cap', () => {
    const cleaned = cleanClientName('😀'.repeat(100));
    expect(cleaned).toBe('😀'.repeat(CLIENT_NAME_MAX_LENGTH));
  });

  it('strips line separators, lone surrogates and private-use characters', () => {
    expect(cleanClientName('a\u2028b\u2029c')).toBe('abc');
    expect(cleanClientName('x\uD800y')).toBe('xy');
    expect(cleanClientName('p\uE000q')).toBe('pq');
  });

  it('answers null for nothing left', () => {
    expect(cleanClientName('   ')).toBeNull();
    expect(cleanClientName('\u0000\u202E')).toBeNull();
    expect(cleanClientName(undefined)).toBeNull();
    expect(cleanClientName(42)).toBeNull();
  });
});

describe('Copilot is not VS Code', () => {
  it('leaves a bare Copilot name as other', () => {
    // Copilot also runs as a CLI and inside JetBrains; only VS Code's own name
    // says VS Code.
    expect(agentClientSlug('GitHub Copilot', null)).toBe('other');
    expect(agentClientSlug('copilot-cli', null)).toBe('other');
  });
});

describe('a weak client name', () => {
  it('is a generic SDK default, a probe, or nothing', () => {
    // Omnigent and Hermes send the Python SDK's `mcp`; Hermes also opens a
    // throwaway `hermes-probe` session before its real one.
    for (const name of ['mcp', 'MCP', 'hermes-probe', '', null]) {
      expect(isWeakClientName(name), String(name)).toBe(true);
    }
  });

  it('is not a name that identifies an agent', () => {
    for (const name of ['claude-code', 'Cursor', 'hermes-agent', 'mcp-remote']) {
      expect(isWeakClientName(name), name).toBe(false);
    }
  });
});

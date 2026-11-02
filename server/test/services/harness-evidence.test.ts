import { describe, expect, it } from 'vitest';
import { AGENT_CLIENTS, agentClientSlug, isWeakClientName } from '../../src/auth/agent-clients.ts';
import { CLIENT_CAPABILITIES } from '../../src/services/client-reports.ts';
import { HARNESS_EVIDENCE, harnessEvidence } from '../../src/services/harness-evidence.ts';

/**
 * `services/harness-evidence.ts` (D-125, LAI-1056): the one table that says
 * what "the tool itself connected" means for each harness. Names from both
 * sides, never a count.
 */

const GENERIC_NAMES: Record<string, string> = {
  // As measured (`auth/agent-clients.ts`): the Python SDK's default.
  omnigent: 'mcp',
  hermes: 'mcp',
};

describe('the harness evidence table', () => {
  it('has a row for every agent client, and none for anything else', () => {
    expect(Object.keys(HARNESS_EVIDENCE).sort()).toEqual([...AGENT_CLIENTS].sort());
  });

  it('marks generic exactly the harnesses whose MCP name is a weak one', () => {
    const generic = Object.entries(HARNESS_EVIDENCE)
      .filter(([, row]) => row.mcp_client_name === 'generic')
      .map(([harness]) => harness)
      .sort();
    expect(generic).toEqual(Object.keys(GENERIC_NAMES).sort());
    for (const [harness, name] of Object.entries(GENERIC_NAMES)) {
      // The name they send could never be read as them.
      expect(isWeakClientName(name)).toBe(true);
      expect(agentClientSlug(name, null)).not.toBe(harness);
    }
  });

  it('every specific harness has a name the normaliser reads as it', () => {
    for (const [harness, row] of Object.entries(HARNESS_EVIDENCE)) {
      if (row.mcp_client_name !== 'specific') continue;
      expect(agentClientSlug(harness, null), harness).toBe(harness);
    }
  });

  it('a generic harness needs capabilities; the rest need none; all come from the vocabulary', () => {
    for (const [harness, row] of Object.entries(HARNESS_EVIDENCE)) {
      for (const cap of row.required_capabilities) {
        expect((CLIENT_CAPABILITIES as readonly string[]).includes(cap), `${harness}: ${cap}`).toBe(
          true,
        );
      }
      expect(row.required_capabilities.length > 0, harness).toBe(row.mcp_client_name === 'generic');
    }
  });

  it('reads an unknown harness, and `other`, as never verifiable', () => {
    expect(harnessEvidence('other').mcp_client_name).toBe('unverifiable');
    expect(harnessEvidence('not-a-harness').mcp_client_name).toBe('unverifiable');
  });
});

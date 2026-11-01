import type { MeProfile } from '../../../../api/me.ts';
import { AgentsTab } from '../AgentsTab.tsx';

export interface DevicesTabProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
}

/**
 * Developer access V3 → Devices (LAI-1048, plan §B.3), first cut: the
 * classic Agents tab **re-hosted unchanged** — the registered agents grouped
 * under *Your devices*, every action they had. Its redesign (tools nested
 * under each device, ⋯ menus) is slice D3; the Add device and Add tool
 * wizards are D4.
 *
 * Until then the addresses those slices will own already work:
 *
 * - `?add=device` and `?add=tool` open the registration wizard, which asks for
 *   the device and the tool together — today's model, where a device is the
 *   label its agents share. `?tool=<id>` starts it on that tool, which is how
 *   an old `?tab=connect&agent=<id>` link arrives here.
 * - `?agent=<id>` brings that agent's row into view and focuses it.
 *
 * Closing the wizard drops `add` and `tool` from the address (a `replace`), so
 * a reload does not reopen what the reader just closed.
 */
export function DevicesTab({ me, origin, params, setParams }: DevicesTabProps) {
  const add = params.get('add');
  const agent = params.get('agent');
  return (
    <div className="dev-body">
      <AgentsTab
        me={me}
        origin={origin}
        openWizard={add === 'device' || add === 'tool'}
        initialGuide={params.get('tool') ?? undefined}
        focusAgentId={agent === null || agent === '' ? undefined : agent}
        onWizardClosed={() => {
          if (!params.has('add') && !params.has('tool')) return;
          const next = new URLSearchParams(params);
          next.delete('add');
          next.delete('tool');
          setParams(next);
        }}
      />
    </div>
  );
}

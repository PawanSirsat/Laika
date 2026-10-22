import { useState } from 'react';
import { EmbeddedScreen, ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { canManageOrg } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import { ShareActivity } from '../connect/ShareActivity.tsx';
import { TokensScreen } from '../tokens/TokensScreen.tsx';
import { ConnectCard } from './ConnectCard.tsx';
import './developer.css';

export interface DeveloperScreenProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly onNavigate: (to: string) => void;
}

/**
 * Developer access (LAI-796): connecting an agent and your own tokens, on one
 * page — what Connect (LAI-622) and Tokens (LAI-410) were.
 *
 * The card is the wizard at a glance and opens it; the list below is the
 * Tokens screen itself, its *New token* in this page's header. Nothing either
 * page could do is lost: the wizard keeps every agent, every step and every
 * optional section at `/developer/connect`, and the list mints, reveals once
 * and revokes exactly as before.
 */
export function DeveloperScreen({ me, origin, onNavigate }: DeveloperScreenProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="page dev-page">
      <ScreenHeader
        variant="page"
        title="Developer access"
        description="A token lets a tool act as you — point your coding agent at this board, or call the API. It carries your permissions, so treat it like your password."
        onActionsSlot={setSlot}
      />
      <div className="dev-body">
        <ConnectCard me={me} origin={origin} onNavigate={onNavigate} />
        <section className="dev-card dev-sharing" aria-labelledby="dev-sharing-title">
          <div className="dev-card-head">
            <h2 className="dev-card-title" id="dev-sharing-title">
              Share local activity
            </h2>
          </div>
          <ShareActivity canManageOrg={canManageOrg(me?.org_role ?? '')} origin={origin} />
        </section>
        <div className="dev-card dev-tokens">
          <EmbeddedScreen slot={slot} titled>
            <TokensScreen me={me} />
          </EmbeddedScreen>
        </div>
      </div>
    </div>
  );
}

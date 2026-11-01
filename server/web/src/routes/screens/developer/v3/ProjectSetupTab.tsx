import { Help } from '../../../../components/wizard/Help.tsx';
import { ProjectsTab } from '../ProjectsTab.tsx';

export interface ProjectSetupTabProps {
  readonly origin: string;
  readonly onNavigate: (to: string) => void;
}

/**
 * Developer access V3 → Project setup (LAI-1048, plan §B.4, §G), first cut:
 * the classic Projects card **re-hosted unchanged** — the block for the
 * repository's instructions file and the prompt that writes it. Which tool may
 * reach the project is still set per tool, so the page says where. Its
 * redesign around a connected tool is slice D2.
 */
export function ProjectSetupTab({ origin, onNavigate }: ProjectSetupTabProps) {
  const devices = '/developer?tab=devices';
  return (
    <div className="dev-body">
      <Help tone="info" className="dev-v3-help">
        Each tool reaches only the projects it was given. To change that, open the tool under{' '}
        <a
          href={devices}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(devices);
          }}
        >
          Devices
        </a>{' '}
        and choose <em>Manage access</em>.
      </Help>
      <ProjectsTab origin={origin} />
    </div>
  );
}

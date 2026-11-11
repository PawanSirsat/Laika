import type { ReactNode } from 'react';
import { DesignChip } from './DesignChip.tsx';
import { DxIcon, type DxIconName } from './DxIcon.tsx';
import { SETUP_CHIPS, type SetupChipKey } from './overview-state.ts';
import {
  deviceLine,
  repoMeta,
  repoTitle,
  type RepoDevice,
  type RepoGroup,
  type RepoTool,
} from './repo-groups.ts';
import './repo-rows.css';

const SETUP_ICON: Readonly<Record<SetupChipKey, DxIconName>> = {
  checked: 'check',
  recorded: 'repo',
  'update-available': 'alert',
  missing: 'alert',
};

export interface RepoRowsProps {
  readonly groups: readonly RepoGroup[];
  /** A project's name, by its id; the record's slug where the list has not got it. */
  readonly projectName: (group: RepoGroup) => string;
  /** One tool's own action on its device's line, where the screen has one. */
  readonly toolAction?: (group: RepoGroup, device: RepoDevice, tool: RepoTool) => ReactNode;
}

/**
 * *Your repository setups* as one row per repository (LAI-321), drawn alike
 * on the Overview and on Project setup's list: the repository's name — once,
 * when it is named after its project — the project and instructions file
 * under it, and its chip; then each device that set it up, with its tools and
 * its own chip. The rows are `<li>`s for the screen's own `.dx-records` list,
 * after whatever first row it offers.
 */
export function RepoRows({ groups, projectName, toolAction }: RepoRowsProps) {
  return groups.map((group) => {
    const name = projectName(group);
    const title = repoTitle(group, name);
    const meta = repoMeta(group, name);
    const chip = SETUP_CHIPS[group.chip];
    return (
      <li
        key={group.key}
        className="dx-record dx-repo"
        data-setup={group.chip}
        data-repo={group.key}
      >
        <div className="dx-repo-head">
          <span className="dx-icon">
            <DxIcon name={SETUP_ICON[group.chip]} />
          </span>
          <div className="dx-record-main">
            <strong className="dx-record-title" title={title}>
              {title}
            </strong>
            <span className="dx-record-sub" title={meta}>
              {meta}
            </span>
          </div>
          <div className="dx-record-end">
            <DesignChip tone={chip.tone}>{chip.word}</DesignChip>
          </div>
        </div>
        <ul className="dx-repo-devices" aria-label={`Devices that set up ${title}`}>
          {group.devices.map((device) => {
            const own = SETUP_CHIPS[device.chip];
            const line = deviceLine(device);
            return (
              <li
                key={device.device}
                className="dx-repo-device"
                data-device={device.device}
                data-state={device.chip}
              >
                <span className="dx-repo-device-text">
                  <strong className="dx-repo-device-name">{device.device}</strong>
                  <span className="dx-repo-device-line" title={line}>
                    {line}
                  </span>
                </span>
                <span className="dx-repo-device-end">
                  <DesignChip tone={own.tone}>{own.word}</DesignChip>
                  {toolAction !== undefined &&
                    device.tools.map((tool) => toolAction(group, device, tool))}
                </span>
              </li>
            );
          })}
        </ul>
      </li>
    );
  });
}

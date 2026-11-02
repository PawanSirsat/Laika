export type DxIconName = 'device' | 'cloud' | 'tool' | 'repo' | 'check' | 'key' | 'link' | 'alert';

/**
 * The Developer access design's glyphs (LAI-1078): a computer, a cloud
 * runner, a coding tool, a repository, a tick, a key, a link and an alert.
 * Drawn on the sidebar's 24px grid and stroke (`NavIcon`), so they read as one
 * family — no icon package, which no task names (CLAUDE.md §5).
 *
 * Always beside words that say the same, so every one is `aria-hidden`.
 */
const PATHS: Readonly<Record<DxIconName, readonly string[]>> = {
  // A laptop: the computer a person works on.
  device: ['M5.5 5.5h13a1.5 1.5 0 0 1 1.5 1.5v8.5H4V7a1.5 1.5 0 0 1 1.5-1.5z', 'M2.5 18.5h19'],
  // A cloud: a runner somebody else hosts.
  cloud: ['M7.5 18.5h9.75a3.75 3.75 0 0 0 .3-7.49A5.5 5.5 0 0 0 6.9 10.2a4.15 4.15 0 0 0 .6 8.3z'],
  // A prompt in a window: a coding tool.
  tool: [
    'M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    'm7.5 9.5 2.5 2.5-2.5 2.5M12.5 14.5h4',
  ],
  // A folder: a repository.
  repo: ['M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  check: ['m5.5 12.5 4 4 9-9'],
  // As the sidebar's Developer access key.
  key: ['M8 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M10.9 12.6 19.5 4', 'm16 7.5 2.5 2.5M13.5 10l2 2'],
  // Two links of a chain: a project a tool reaches.
  link: [
    'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.1 1.1',
    'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.1-1.1',
  ],
  // A triangle with a mark: something needs the reader.
  alert: [
    'M10.3 4.6 3 17.5a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z',
    'M12 9.5v4M12 17h.01',
  ],
};

export interface DxIconProps {
  readonly name: DxIconName;
  readonly size?: number;
}

export function DxIcon({ name, size = 18 }: DxIconProps) {
  return (
    <svg
      className="dx-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

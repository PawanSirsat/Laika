import { useId } from 'react';
import {
  AGENT_CLIENT_MONOGRAMS,
  AGENT_CLIENT_TONES,
  type AgentClient,
} from '../../api/agent-clients.ts';
import { agentLogo, type AgentLogo, type LogoPaint } from './agent-logos.ts';
import './agent-mark.css';

export interface AgentMarkProps {
  readonly client: AgentClient;
  /**
   * `sm` sits in a line of text or a chip; `md` in a list row; `lg` on a
   * compact tile; `xl` (34px) on Connect's agent picker.
   */
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * A coding agent's mark: its real brand mark on a light tile where it has one
 * (LAI-740), two letters on a tinted tile where it does not (LAI-737).
 *
 * Every mark is vendored path data from `agent-logos.ts` — drawn inline, never
 * fetched — and `NOTICE.md` records where each came from.
 *
 * **Decoration, always.** The mark is `aria-hidden` and the monogram's letters
 * are drawn by CSS from `data-mono`, so neither is in the element's text:
 * every place that shows a mark also says the agent's name in words, and a
 * screen reader, `innerText` or a copy-paste of the row reads that name once.
 */
export function AgentMark({ client, size = 'md' }: AgentMarkProps) {
  const logo = agentLogo(client);
  if (logo !== undefined) {
    return (
      <span
        className={`agent-mark agent-mark-${size} agent-mark-logo`}
        data-client={client}
        aria-hidden="true"
      >
        <LogoSvg logo={logo} />
      </span>
    );
  }
  return (
    <span
      className={`agent-mark agent-mark-${size} agent-mark-${AGENT_CLIENT_TONES[client]}`}
      data-mono={AGENT_CLIENT_MONOGRAMS[client]}
      data-client={client}
      aria-hidden="true"
    />
  );
}

/**
 * The SVG itself. Gradient and mask ids are prefixed per instance, because a
 * page shows the same mark more than once and a repeated `id` makes the
 * second copy paint with the first one's definitions — or none.
 */
function LogoSvg({ logo }: { readonly logo: AgentLogo }) {
  const prefix = `agent-logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ref = (id: string): string => `${prefix}-${id}`;
  const fill = (paint: LogoPaint): string =>
    paint === 'ink'
      ? 'currentColor'
      : typeof paint === 'string'
        ? paint
        : `url(#${ref(paint.gradient)})`;
  const maskId = ref('mask');

  return (
    <svg
      className="agent-mark-svg"
      viewBox={logo.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      {(logo.gradients !== undefined || logo.mask !== undefined) && (
        <defs>
          {logo.gradients?.map((g) => (
            <linearGradient
              key={g.id}
              id={ref(g.id)}
              gradientUnits="userSpaceOnUse"
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
            >
              {g.stops.map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          ))}
          {logo.mask !== undefined && (
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <path
                d={logo.mask.d}
                fill="white"
                {...(logo.mask.fillRule !== undefined ? { fillRule: logo.mask.fillRule } : {})}
              />
            </mask>
          )}
        </defs>
      )}
      {logo.shapes.map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill={fill(shape.paint)}
          {...(shape.fillRule !== undefined ? { fillRule: shape.fillRule } : {})}
          {...(shape.opacity !== undefined ? { opacity: shape.opacity } : {})}
          {...(shape.masked === true ? { mask: `url(#${maskId})` } : {})}
        />
      ))}
    </svg>
  );
}

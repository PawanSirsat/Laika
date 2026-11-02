import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SidePanel } from '../../../../components/SidePanel.tsx';
import { DesignChip, type ChipTone } from './DesignChip.tsx';
import {
  DEVICE_ORDER,
  DEVICE_STATUS,
  DUPLICATE,
  TOOL_ORDER,
  TOOL_STATUS,
  UPDATE_ORDER,
  UPDATE_STATUS,
  type StatusCopy,
} from './status-vocabulary.ts';
import './status-legend.css';

/**
 * What every status on Tools and Devices means (LAI-1086): a chip that says
 * why **this** row reads as it does, and a legend of every status there is.
 * Both are drawn from `status-vocabulary.ts`, so neither can say something
 * the other does not.
 */

// ------------------------------------------------------------------ one chip

export interface HintChipProps {
  readonly word: string;
  readonly tone: ChipTone;
  /** This row's own reason and what to do — the chip's accessible description. */
  readonly description: string;
}

/**
 * A status chip that explains itself: focusable, described by its row's
 * reason (`aria-describedby`), and showing it as a tooltip on hover **and**
 * on focus. Escape hides the tooltip without moving focus or closing what
 * the chip sits in; it comes back on the next hover or focus.
 */
export function HintChip({ word, tone, description }: HintChipProps) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Escape' || hidden) return;
    // The tooltip goes first; a panel around it closes on the next Escape.
    event.preventDefault();
    event.stopPropagation();
    setHidden(true);
  };
  return (
    <span
      className="dv3-hint"
      data-hidden={hidden || undefined}
      onMouseLeave={() => {
        setHidden(false);
      }}
    >
      <span
        className="dv3-hint-anchor"
        tabIndex={0}
        aria-describedby={id}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setHidden(false);
        }}
      >
        <DesignChip tone={tone}>{word}</DesignChip>
      </span>
      <span className="dv3-hint-tip" role="tooltip" id={id}>
        {description}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ the legend

/** The link beside a tab's heading that opens the legend. */
export const LEGEND_LINK = 'What do these statuses mean?';
export const LEGEND_TITLE = 'What these statuses mean';

function Entry({ copy, keyName }: { readonly copy: StatusCopy; readonly keyName: string }) {
  return (
    <div className="dv3-legend-entry" data-legend={keyName}>
      <dt>
        <DesignChip tone={copy.tone}>{copy.word}</DesignChip>
      </dt>
      <dd>
        <p className="dv3-legend-meaning">{copy.meaning}</p>
        <p className="dv3-legend-todo">
          <span className="dv3-legend-todo-label">What to do:</span> {copy.todo}
        </p>
      </dd>
    </div>
  );
}

function Group({
  title,
  id,
  entries,
}: {
  readonly title: string;
  readonly id: string;
  readonly entries: readonly (readonly [string, StatusCopy])[];
}) {
  return (
    <section className="side-panel-section" aria-labelledby={id} data-legend-group={id}>
      <h3 className="side-panel-label" id={id}>
        {title}
      </h3>
      <dl className="dv3-legend">
        {entries.map(([key, copy]) => (
          <Entry key={key} keyName={key} copy={copy} />
        ))}
      </dl>
    </section>
  );
}

/**
 * Every status, in three groups: a tool's connection, its helper's version,
 * and a device. The group for the tab it was opened from comes first.
 */
export function StatusLegend({
  from,
  onClose,
  restore,
}: {
  readonly from: 'tools' | 'devices';
  readonly onClose: () => void;
  readonly restore: () => HTMLElement | null | undefined;
}) {
  const tools = (
    <Group
      key="tools"
      title="A tool"
      id="dv3-legend-tools"
      entries={[
        ...TOOL_ORDER.map((key) => [key, TOOL_STATUS[key]] as const),
        ['duplicate', DUPLICATE] as const,
      ]}
    />
  );
  const helper = (
    <Group
      key="helper"
      title="Its Laika helper"
      id="dv3-legend-helper"
      entries={UPDATE_ORDER.map((key) => [key, UPDATE_STATUS[key]] as const)}
    />
  );
  const devices = (
    <Group
      key="devices"
      title="A device"
      id="dv3-legend-devices"
      entries={DEVICE_ORDER.map((key) => [key, DEVICE_STATUS[key]] as const)}
    />
  );
  return (
    <SidePanel
      title={LEGEND_TITLE}
      titleId="dv3-legend-title"
      subtitle="Every status these lists can show, what it means and what to do. Hover over or focus a chip on a row for that row’s own reason."
      onClose={onClose}
      restore={restore}
      panel="status-legend"
    >
      {from === 'tools' ? [tools, helper, devices] : [devices, helper, tools]}
    </SidePanel>
  );
}

/** *What do these statuses mean?* — a button, and the legend it opens. */
export function StatusLegendLink({ from }: { readonly from: 'tools' | 'devices' }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        ref={button}
        className="dx-btn dx-btn-sm dx-btn-ghost dv3-legend-link"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-legend-link={from}
        onClick={() => {
          setOpen(true);
        }}
      >
        {LEGEND_LINK}
      </button>
      {open && (
        <StatusLegend
          from={from}
          onClose={() => {
            setOpen(false);
          }}
          restore={() => button.current}
        />
      )}
    </>
  );
}

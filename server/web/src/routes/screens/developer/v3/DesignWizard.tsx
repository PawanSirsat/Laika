import type { ReactNode, Ref } from 'react';
import { StepRail, type RailStep } from '../../../../components/wizard/StepRail.tsx';
import { WizardCard } from '../../../../components/wizard/WizardCard.tsx';

export interface DesignWizardProps {
  /** The rail card's title — *Connect a device*. */
  readonly railTitle: string;
  /** Its sentence — *Set up your laptop once.* — and the rail's intro. */
  readonly railIntro: string;
  /** The rail's landmark name, such as *Device setup steps*. */
  readonly railLabel: string;
  readonly steps: readonly RailStep[];
  readonly current: number;
  readonly onSelect: (n: number) => void;

  /** The step on show: its number, of how many, and what is being set up. */
  readonly step: number;
  readonly total: number;
  readonly kind: string;
  readonly title: string;
  readonly line: string;
  readonly titleId: string;
  readonly titleRef?: Ref<HTMLHeadingElement> | undefined;

  /** The footer band's sentence, on the left; it wraps, the buttons never do. */
  readonly note: ReactNode;
  /** The note's id, so the primary can be described by it. */
  readonly noteId?: string;
  /** *Back* and the primary, on the right. */
  readonly actions: ReactNode;
  /** Cards beside the step, such as *What stays separate*. Hidden ≤ 1040px. */
  readonly aside?: ReactNode;
  /** A `data-wizard` hook naming the wizard. */
  readonly wizard?: string;
  readonly children: ReactNode;
}

/**
 * A wizard in the Developer access design (LAI-1078): a rail card — title,
 * sentence, every step — then the step's card with its eyebrow (*Step 2 of 3 ·
 * Device*), title and line in a top band, the body, and a footer band with a
 * note and the actions, and optionally an aside.
 *
 * The rail and the card are Connect's shared parts (LAI-1044), unchanged; the
 * design's look is `design.css`, scoped under `dx-` classes so Connect's
 * golden test never sees it.
 */
export function DesignWizard({
  railTitle,
  railIntro,
  railLabel,
  steps,
  current,
  onSelect,
  step,
  total,
  kind,
  title,
  line,
  titleId,
  titleRef,
  note,
  noteId,
  actions,
  aside,
  wizard,
  children,
}: DesignWizardProps) {
  return (
    <div className="dx-wizard" data-aside={aside !== undefined} data-wizard={wizard}>
      <div className="dx-rail-card">
        <p className="dx-rail-title">{railTitle}</p>
        <StepRail
          label={railLabel}
          intro={railIntro}
          steps={steps}
          current={current}
          onSelect={onSelect}
        />
      </div>
      <WizardCard
        step={step}
        total={total}
        kind={kind}
        title={title}
        line={line}
        titleId={titleId}
        titleRef={titleRef}
        footer={
          <footer className="dx-wizard-foot">
            <p className="dx-wizard-note" id={noteId}>
              {note}
            </p>
            <div className="dx-actions">{actions}</div>
          </footer>
        }
      >
        {children}
      </WizardCard>
      {aside !== undefined && <aside className="dx-aside">{aside}</aside>}
    </div>
  );
}

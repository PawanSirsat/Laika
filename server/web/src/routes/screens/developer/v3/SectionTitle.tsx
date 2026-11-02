import type { ReactNode, Ref } from 'react';

export interface SectionTitleProps {
  readonly title: string;
  /** The heading's id, so a region can be labelled by it. */
  readonly titleId: string;
  /** One sentence under the title. */
  readonly sub?: ReactNode;
  /** Buttons on the right, such as *+ Add device*. */
  readonly actions?: ReactNode;
  /** Focus lands on the heading after a wizard or panel closes. */
  readonly headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * A section's title in the Developer access design (LAI-1078): the heading and
 * its sentence on the left, its actions on the right — *Devices* with *+ Add
 * device*, *Add device* with *Back to devices*.
 */
export function SectionTitle({ title, titleId, sub, actions, headingRef }: SectionTitleProps) {
  return (
    <div className="dx-section-title">
      <div>
        <h2 className="dx-section-heading" id={titleId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {sub !== undefined && <p className="dx-section-sub">{sub}</p>}
      </div>
      {actions !== undefined && <div className="dx-section-actions">{actions}</div>}
    </div>
  );
}

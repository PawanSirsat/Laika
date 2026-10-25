import './day-states.css';

/**
 * The page while the day is being read (the owner's `MyDay.dc.html`,
 * `bd.loading`, LAI-513): the Timeline card's shape in skeleton — its head,
 * the axis, the lane column and a row of blocks — and a second card under it.
 */
export function DaySkeleton({ label }: { readonly label: string }) {
  return (
    <div className="dstate-loading" data-day-loading>
      <section className="myday-card dstate-card" aria-busy="true" aria-label={label}>
        <div className="dstate-skel-head">
          <span className="dstate-skel-title">Timeline</span>
          <span className="myday-quiet">{label}…</span>
        </div>
        <div className="dstate-skel dstate-skel-axis" />
        <div className="dstate-skel-grid">
          <div className="dstate-skel dstate-skel-lanes" />
          <div className="dstate-skel-track">
            <div className="dstate-skel dstate-skel-signals" />
            <div className="dstate-skel-blocks">
              <div className="dstate-skel" style={{ flex: 3 }} />
              <div className="dstate-skel" style={{ flex: 1 }} />
              <div className="dstate-skel" style={{ flex: 2 }} />
              <div className="dstate-skel" style={{ flex: 4 }} />
            </div>
            <div className="dstate-skel dstate-skel-signals" />
          </div>
        </div>
      </section>
      <section className="myday-card dstate-card dstate-second" aria-hidden="true">
        <div className="dstate-skel dstate-skel-line" style={{ width: '7.5rem' }} />
        <div className="dstate-skel dstate-skel-text" />
        <div className="dstate-skel dstate-skel-text" style={{ width: '80%' }} />
        <div className="dstate-skel dstate-skel-text" style={{ width: '90%' }} />
      </section>
    </div>
  );
}

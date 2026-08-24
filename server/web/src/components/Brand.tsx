/**
 * The Laika mark and wordmark.
 *
 * Extracted from `Sidebar` because the identity outlives the navigation: a
 * signed-out page carries no app nav (LAI-062) but must still say what it is.
 * Keeping it inside the sidebar meant removing the nav also removed the name.
 */
export function Brand() {
  return (
    <div className="sidebar-brand">
      <span className="sidebar-mark" aria-hidden="true" />
      <span className="sidebar-wordmark">Laika</span>
    </div>
  );
}

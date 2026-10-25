import { AppShell } from './components/AppShell.tsx';
import { ConfirmProvider } from './components/ConfirmProvider.tsx';

/**
 * The app is the shell (LAI-019). Routing, the sidebar and the screen frame all
 * live there; this stays a single line so there is one obvious place to add a
 * provider when one is needed.
 */
export function App() {
  // The one yes-or-no every screen asks with (LAI-522).
  return (
    <ConfirmProvider>
      <AppShell />
    </ConfirmProvider>
  );
}

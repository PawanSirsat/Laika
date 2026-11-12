import { AppShell } from './components/AppShell.tsx';
import { ConfirmProvider } from './components/ConfirmProvider.tsx';
import { ToastProvider } from './components/toast/ToastProvider.tsx';

/**
 * The app is the shell (LAI-019). Routing, the sidebar and the screen frame all
 * live there; this stays a single line so there is one obvious place to add a
 * provider when one is needed.
 */
export function App() {
  // The one yes-or-no every screen asks with (LAI-522), and the one toast
  // every screen says what happened with (LAI-1129).
  return (
    <ConfirmProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </ConfirmProvider>
  );
}

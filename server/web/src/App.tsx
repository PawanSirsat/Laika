import { AppShell } from './components/AppShell.tsx';

/**
 * The app is the shell (LAI-019). Routing, the sidebar and the screen frame all
 * live there; this stays a single line so there is one obvious place to add a
 * provider when one is needed.
 */
export function App() {
  return <AppShell />;
}

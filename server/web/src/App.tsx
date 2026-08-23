/**
 * The scaffold's only route.
 *
 * It states what exists and what does not, and it holds no fake data on
 * purpose: CLAUDE.md §5.1 makes mockup fixtures a defect even when they look
 * right, and an empty shell that says so is more honest than a dashboard of
 * invented numbers.
 *
 * LAI-019 replaces this with the real router and app shell.
 */
export function App() {
  return (
    <main>
      <h1>Laika</h1>
      <p>
        Frontend scaffold — React, TypeScript and Vite, building into <code>server/public/</code>.
        There are no screens yet.
      </p>
      <p>
        The theme system lands in LAI-018, the app shell and routing in LAI-019. Nothing here calls
        the API.
      </p>
    </main>
  );
}

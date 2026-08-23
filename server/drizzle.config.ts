import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit only generates migration files here; it never applies them.
 * Applying is the server's job at boot (`src/db/migrate.ts`), forward-only.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});

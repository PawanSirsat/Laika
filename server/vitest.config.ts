import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Every suite starts from the same place; no test may lean on another's spies.
    restoreMocks: true,
    clearMocks: true,
  },
});

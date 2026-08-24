import { describe, expect, it } from 'vitest';

/**
 * LAI-001's proof of life. This suite exists to show that the runner runs and
 * that it runs *TypeScript* under the strict settings in tsconfig.base.json —
 * `pnpm test` failing here means the toolchain is broken, not the product.
 */
describe('toolchain', () => {
  it('runs a test file written in TypeScript', () => {
    expect(1 + 1).toBe(2);
  });

  it('type-checks index access as possibly undefined (noUncheckedIndexedAccess)', () => {
    const names: string[] = ['laika'];
    // Annotated deliberately: this only compiles because indexed access widens
    // to `| undefined`. Drop the flag and this line becomes a type error.
    const first: string | undefined = names[0];

    expect(first).toBe('laika');
    expect(names[1]).toBeUndefined();
  });

  it('has async support wired up', async () => {
    await expect(Promise.resolve('ok')).resolves.toBe('ok');
  });
});

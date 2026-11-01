// THROWAWAY (LAI-1030): proves a failing server shard turns the gate red. Reverted.
import { expect, it } from 'vitest';

it('fails on purpose to prove the aggregate gate goes red', () => {
  expect('LAI-1030 deliberate red').toBe('green');
});

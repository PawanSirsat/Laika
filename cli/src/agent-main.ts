#!/usr/bin/env node
import { agent } from './agent.ts';

/**
 * `laika agent …` on its own entry (LAI-542). The installed hooks and the
 * background watcher run this rather than `index.ts`, which loads every other
 * command first — measured at 0.4 s a start, paid on every tool call.
 */
agent(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause: unknown) => {
    process.stderr.write(
      `laika agent: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  });

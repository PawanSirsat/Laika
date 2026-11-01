/**
 * One contender for the launcher's lock (LAI-558, review B1): waits for the
 * shared start instant, calls `takePid` once, prints `won` or `lost`, then
 * holds whatever it got for a while so a later contender sees a live holder.
 */

import { takePid } from '../../src/agent-launcher.ts';

const [home, goAt, holdMs] = process.argv.slice(2);
while (Date.now() < Number(goAt)) {
  // Spin to the shared instant, so every contender calls at once.
}
process.stdout.write(takePid(home!) ? 'won\n' : 'lost\n');
setTimeout(() => process.exit(0), Number(holdMs));

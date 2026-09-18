/**
 * One Grok CLI process on the box at a time.
 *
 * Calories, trainer, and inbox all shell out to the same binary. Each call is
 * a process; a burst of them buries a small machine (and the subscription).
 * The next job starts when the current one returns or is killed.
 *
 * Node timers are 32-bit: do not `setInterval` a 30-day delay. It overflows
 * and fires continuously, which is how a "monthly" cluster pass once spawned
 * hundreds of Grok processes.
 */

let tail: Promise<unknown> = Promise.resolve();

export function runGrok<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

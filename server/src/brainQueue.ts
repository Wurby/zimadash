/**
 * One brain CLI process on the box at a time.
 *
 * Calories, trainer, and inbox all shell out to the same binary (`claude -p`).
 * Each call is a process; a burst of them buries a small machine (and the
 * subscription). The next job starts when the current one returns or is
 * killed. Plain deterministic code — the brain is never involved in managing
 * its own queue.
 *
 * Node timers are 32-bit: do not `setInterval` a 30-day delay. It overflows
 * and fires continuously, which is how a "monthly" cluster pass once spawned
 * hundreds of processes.
 */

let tail: Promise<unknown> = Promise.resolve();

export function runBrain<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

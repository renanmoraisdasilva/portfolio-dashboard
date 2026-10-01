/**
 * The scheduled jobs' timers, and the one way to clear them.
 *
 * Every `setInterval` returns a handle that keeps the event loop alive. Nothing
 * collected them, so the worker could only be stopped by the process exiting —
 * which meant it never ran the clean database close that checkpoints the WAL, and
 * a SIGTERM could not stop it gracefully at all.
 *
 * A separate module rather than part of `index.ts` so the job files can register
 * their timers without importing the aggregator that starts them.
 */
const timers: NodeJS.Timeout[] = [];

/**
 * Registers a repeating task.
 *
 * `unref` so a job can never be the reason the process stays alive: whether the
 * process exits is `shutdown`'s decision, not a timer's. Without it, the worker
 * would ignore Ctrl-C until something forced it.
 */
export function schedule(name: string, intervalMs: number, task: () => void): void {
  const timer = setInterval(task, intervalMs);
  timer.unref();
  timers.push(timer);
  console.log(`[jobs] ${name} scheduled every ${formatInterval(intervalMs)}`);
}

/** Clears every scheduled job. Idempotent, and safe to call when none ran. */
export function stopWorkerJobs(): void {
  // `splice` empties the array, so the handles are read before the length is used
  // — iterating `timers` afterwards would clear nothing.
  const handles = timers.splice(0);
  for (const timer of handles) clearInterval(timer);
  if (handles.length > 0) console.log(`[jobs] stopped ${handles.length} scheduled job(s)`);
}

function formatInterval(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 60_000)}min`;
}

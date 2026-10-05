const timers: NodeJS.Timeout[] = [];

export function schedule(name: string, intervalMs: number, task: () => void): void {
  const timer = setInterval(task, intervalMs);
  timers.push(timer);
  console.log(`[jobs] ${name} scheduled every ${formatInterval(intervalMs)}`);
}

export function stopWorkerJobs(): void {
  const handles = timers.splice(0);
  for (const timer of handles) clearInterval(timer);
  if (handles.length > 0) console.log(`[jobs] stopped ${handles.length} scheduled job(s)`);
}

function formatInterval(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 60_000)}min`;
}

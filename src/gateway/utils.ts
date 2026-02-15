/**
 * Shared utilities for gateway operations
 */

/**
 * Wait for a sandbox process to complete
 *
 * @param proc - Process object with status and getStatus() method
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check status (default 500ms)
 */
export async function waitForProcess(
  proc: { status: string; getStatus?: () => Promise<string> },
  timeoutMs: number,
  pollIntervalMs: number = 500,
): Promise<void> {
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  let attempts = 0;
  let currentStatus = proc.status;
  while ((currentStatus === 'running' || currentStatus === 'starting') && attempts < maxAttempts) {
    // eslint-disable-next-line no-await-in-loop -- intentional sequential polling
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    // proc.status is a snapshot; must call getStatus() to refresh
    currentStatus = proc.getStatus ? await proc.getStatus() : proc.status; // eslint-disable-line no-await-in-loop -- intentional sequential polling
    attempts++;
  }
}

/**
 * Race a promise against a timeout. If the promise doesn't resolve in time,
 * rejects with a TimeoutError so the caller can recover instead of hanging forever.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

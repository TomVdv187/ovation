/**
 * Concurrency and pacing for model calls.
 *
 * A 500-guest campaign is 500 model calls. Fired at once they would blow the
 * account's rate limit and take the whole batch down with them, so calls run
 * through a small pool with a floor on the gap between starts. The SDK's own
 * retry-with-backoff handles the 429s that still slip through; this keeps the
 * number of them near zero.
 */

export interface LimiterOptions {
  /** How many model calls may be in flight at once. */
  concurrency: number;
  /** Minimum gap between two call starts, in milliseconds. */
  minIntervalMs: number;
}

export const DEFAULT_LIMITS: LimiterOptions = { concurrency: 4, minIntervalMs: 250 };

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export function createLimiter(options: Partial<LimiterOptions> = {}): Limiter {
  const { concurrency, minIntervalMs } = { ...DEFAULT_LIMITS, ...options };
  const slots = Math.max(1, Math.floor(concurrency));
  const gap = Math.max(0, minIntervalMs);

  let inFlight = 0;
  let nextStart = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    inFlight--;
    queue.shift()?.();
  };

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      const start = (): void => {
        inFlight++;
        resolve();
      };
      if (inFlight < slots) start();
      else queue.push(start);
    });

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      const now = Date.now();
      const waitFor = Math.max(0, nextStart - now);
      nextStart = Math.max(now, nextStart) + gap;
      await sleep(waitFor);
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Map over items through a limiter, keeping input order in the results.
 * Rejections propagate — callers decide per item whether a failure is fatal.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limiter: Limiter,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  return Promise.all(items.map((item, index) => limiter(() => fn(item, index))));
}

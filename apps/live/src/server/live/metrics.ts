/**
 * Latency instrumentation for the one path with a hard budget.
 *
 * The brief says "target < 2.5s per scan, P95 — measure it; do not assume it",
 * so every check-in records its server-side handler time here and the
 * simulation records the client-observed round trip on its side. Both numbers
 * are reported: the gap between them is network, and at the door that gap is
 * the part that actually hurts.
 */

const CAPACITY = 5_000;

export interface Sample {
  at: number;
  ms: number;
  outcome: string;
  lane: string;
  offlineSynced: boolean;
}

interface MetricsState {
  samples: Sample[];
}

const globalForMetrics = globalThis as unknown as {
  ovationLiveMetrics?: MetricsState;
};

const state: MetricsState = (globalForMetrics.ovationLiveMetrics ??= {
  samples: [],
});

export function record(sample: Sample): void {
  state.samples.push(sample);
  if (state.samples.length > CAPACITY) {
    state.samples.splice(0, state.samples.length - CAPACITY);
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: P95 of 100 samples is the 95th slowest, which is the number
  // an ops person means when they say "95% of scans were faster than this".
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export function summary(sinceMs?: number) {
  const cutoff = sinceMs ?? 0;
  const window = state.samples.filter((s) => s.at >= cutoff);
  const ms = window.map((s) => s.ms);
  const byOutcome: Record<string, number> = {};
  for (const s of window) byOutcome[s.outcome] = (byOutcome[s.outcome] ?? 0) + 1;

  return {
    count: window.length,
    p50: round(percentile(ms, 50)),
    p95: round(percentile(ms, 95)),
    p99: round(percentile(ms, 99)),
    max: round(ms.length ? Math.max(...ms) : 0),
    mean: round(ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0),
    byOutcome,
    firstAt: window[0]?.at ?? null,
    lastAt: window[window.length - 1]?.at ?? null,
  };
}

export function reset(): void {
  state.samples = [];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

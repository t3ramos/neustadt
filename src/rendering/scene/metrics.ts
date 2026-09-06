/** Bounded timing aggregates exposed through scene diagnostics; no per-frame logs. */
export function createSceneMetrics() {
  const timings = new Map<
    string,
    { count: number; lastMs: number; maxMs: number; totalMs: number }
  >();
  function record(name: string, ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const t = timings.get(name) ?? { count: 0, lastMs: 0, maxMs: 0, totalMs: 0 };
    t.count++;
    t.lastMs = ms;
    t.maxMs = Math.max(t.maxMs, ms);
    t.totalMs += ms;
    timings.set(name, t);
  }
  return {
    record,
    measure<T>(name: string, action: () => T): T {
      const start = performance.now();
      try {
        return action();
      } finally {
        record(name, performance.now() - start);
      }
    },
    snapshot() {
      return Object.fromEntries(
        [...timings].map(([name, t]) => [
          name,
          { count: t.count, lastMs: t.lastMs, maxMs: t.maxMs, meanMs: t.totalMs / t.count },
        ]),
      );
    },
  };
}

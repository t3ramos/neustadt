import type { WebGLRenderer } from 'three';

/** Optional asynchronous GPU elapsed queries. Never waits for a query result;
 * unsupported browsers simply report available:false. */
export function createGpuTiming(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null,
    count = 0,
    lastMs = 0,
    maxMs = 0,
    totalMs = 0;
  return {
    begin() {
      if (!extension) return;
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      if (disjoint) {
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        return;
      }
      while (pending.length) {
        const query = pending[0];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) {
          lastMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
          maxMs = Math.max(maxMs, lastMs);
          totalMs += lastMs;
          count++;
        }
        gl.deleteQuery(query);
      }
      if (pending.length >= 4) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(extension.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!extension || !active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    snapshot: () => ({
      available: !!extension,
      count,
      lastMs,
      maxMs,
      meanMs: count ? totalMs / count : 0,
      pending: pending.length,
    }),
    dispose() {
      if (extension && active) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        gl.deleteQuery(active);
        active = null;
      }
      for (const query of pending) gl.deleteQuery(query);
      pending.length = 0;
    },
  };
}

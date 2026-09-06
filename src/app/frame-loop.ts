export interface Frame {
  delta: number;
  fps: number;
  count: number;
}
/** Owns RAF and visibility timing; the application decides what a frame does. */

export function startFrameLoop(onFrame: (frame: Frame) => void): () => void {
  let previous = performance.now();
  let count = 0;
  let handle = 0;
  const reset = () => {
    previous = performance.now();
  };
  const frame = (time: number) => {
    const elapsed = Math.max(0, (time - previous) / 1000);
    const delta = Math.min(elapsed, 0.25);
    previous = time;
    onFrame({
      delta,
      fps: 1 / Math.max(0.001, elapsed),
      count: ++count,
    });
    handle = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', reset);
  handle = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', reset);
  };
}

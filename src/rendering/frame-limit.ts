/** Keep display callbacks phase-aligned without rendering catch-up frames after a pause. */
export function createFrameLimiter(fps = 60): (timestamp: number) => boolean {
  const interval = 1000 / fps;
  let nextFrame: number | undefined;
  return (timestamp) => {
    if (nextFrame === undefined) {
      nextFrame = timestamp + interval;
      return true;
    }
    if (timestamp + 1e-7 < nextFrame) return false;
    nextFrame += interval;
    if (nextFrame <= timestamp) nextFrame = timestamp + interval;
    return true;
  };
}

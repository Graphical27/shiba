import { finite, InputError } from './validation.ts';
import type { RainCube } from './types.ts';
/** Global translation optical-flow approximation, not pySTEPS STEPS. */
export function advectRain(
  input: Record<string, unknown>,
): RainCube & { motionPixelsPerStep: [number, number] } {
  const width = finite(input.width, 'width', 4, 64),
    height = finite(input.height, 'height', 4, 64),
    step = finite(
      input.observationStepMinutes,
      'observationStepMinutes',
      1,
      30,
    );
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new InputError('Grid dimensions must be integers');
  const observations = input.observations;
  if (!Array.isArray(observations) || observations.length !== 3)
    throw new InputError(
      'Three equally spaced observed rain-rate arrays are required',
    );
  for (const frame of observations) {
    if (!Array.isArray(frame) || frame.length !== width * height)
      throw new InputError('Observation dimensions mismatch');
    for (const v of frame) finite(v, 'observed rainfall', 0, 500);
  }
  const observed = String(input.observedThrough ?? '');
  if (!Number.isFinite(Date.parse(observed)))
    throw new InputError('observedThrough must be an ISO timestamp');
  const data = observations as number[][];
  let best = Infinity,
    motion: [number, number] = [0, 0];
  // Search the same interior for every shift so candidates have equal coverage.
  const margin = Math.min(3, Math.floor((Math.min(width, height) - 2) / 2));
  for (let dy = -margin; dy <= margin; dy++)
    for (let dx = -margin; dx <= margin; dx++) {
      let error = 0,
        count = 0;
      for (let f = 0; f < 2; f++)
        for (let y = margin; y < height - margin; y++)
          for (let x = margin; x < width - margin; x++) {
            error +=
              (data[f][(y - dy) * width + x - dx] -
                data[f + 1][y * width + x]) **
              2;
            count++;
          }
      const score = error / Math.max(1, count) + (dx * dx + dy * dy) * 1e-7;
      if (score < best) {
        best = score;
        motion = [dx, dy];
      }
    }
  const latest = data[2],
    sample = (x: number, y: number): number | null => {
      if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
      const x0 = Math.floor(x),
        y0 = Math.floor(y),
        x1 = Math.min(width - 1, x0 + 1),
        y1 = Math.min(height - 1, y0 + 1),
        fx = x - x0,
        fy = y - y0;
      return (
        latest[y0 * width + x0] * (1 - fx) * (1 - fy) +
        latest[y0 * width + x1] * fx * (1 - fy) +
        latest[y1 * width + x0] * (1 - fx) * fy +
        latest[y1 * width + x1] * fx * fy
      );
    };
  const frames = Array.from({ length: 13 }, (_, f) =>
    Array.from({ length: width * height }, (_, i) =>
      sample(
        (i % width) - (motion[0] * f * 15) / step,
        Math.floor(i / width) - (motion[1] * f * 15) / step,
      ),
    ),
  );
  return {
    issuedAt: observed,
    observedThrough: observed,
    source:
      'Uploaded observations / global translation optical flow and semi-Lagrangian advection',
    mode: 'replay',
    unit: 'mm/h',
    width,
    height,
    stepMinutes: 15,
    frames,
    motionPixelsPerStep: motion,
  };
}

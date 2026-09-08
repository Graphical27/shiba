import type { CityId, Dataset, RainCube, Scenario } from './types.ts';
export class InputError extends Error {
  status = 400;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new InputError('Expected a JSON object');
  return v as Record<string, unknown>;
};
export const finite = (v: unknown, name: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new InputError(
      `${name} must be a finite number between ${min} and ${max}`,
    );
  return v;
};
export function validateScenario(value: unknown): Scenario {
  const v = object(value),
    city = v.city ?? 'mumbai';
  if (!['mumbai', 'delhi', 'chennai'].includes(String(city)))
    throw new InputError('city must be mumbai, delhi or chennai');
  return {
    city: city as CityId,
    rainfallMmHr: finite(v.rainfallMmHr ?? 80, 'rainfallMmHr', 0, 200),
    blockage: finite(v.blockage ?? 0.3, 'blockage', 0, 1),
    tailwaterM: finite(v.tailwaterM ?? 0, 'tailwaterM', 0, 4),
  };
}
export function scenarioFromURL(request: Request) {
  const q = new URL(request.url).searchParams;
  return validateScenario({
    city: q.get('city') ?? 'mumbai',
    ...Object.fromEntries(
      ['rainfallMmHr', 'blockage', 'tailwaterM']
        .filter((k) => q.has(k))
        .map((k) => [k, Number(q.get(k))]),
    ),
  });
}
export function validateRain(value: unknown, dataset: Dataset): RainCube {
  const v = object(value),
    n = dataset.grid.width * dataset.grid.height;
  if (
    v.unit !== 'mm/h' ||
    v.width !== dataset.grid.width ||
    v.height !== dataset.grid.height ||
    v.stepMinutes !== 15
  )
    throw new InputError(
      'Rainfall grid must match terrain and use mm/h at 15-minute intervals.',
    );
  if (!Array.isArray(v.frames) || v.frames.length !== 13)
    throw new InputError('Rainfall requires 13 frames at 0,15,...,180 minutes');
  for (const frame of v.frames) {
    if (!Array.isArray(frame) || frame.length !== n)
      throw new InputError('Rainfall dimensions do not match terrain');
    for (const cell of frame) {
      if (cell === null)
        throw new InputError(
          'Missing rainfall coverage: null cannot be treated as dry.',
          422,
        );
      finite(cell, 'rainfall cell', 0, 500);
    }
  }
  if (
    !['synthetic', 'replay', 'live', 'weather_model'].includes(String(v.mode))
  )
    throw new InputError('Invalid rainfall data mode');
  if (typeof v.source !== 'string' || !v.source.trim() || v.source.length > 500)
    throw new InputError(
      'Rainfall source is required (maximum 500 characters)',
    );
  for (const key of v.mode === 'weather_model'
    ? ['issuedAt']
    : ['issuedAt', 'observedThrough'])
    if (
      typeof v[key] !== 'string' ||
      !Number.isFinite(Date.parse(v[key] as string))
    )
      throw new InputError(`${key} must be an ISO timestamp`);
  if (v.mode === 'weather_model') {
    if (v.observedThrough !== null)
      throw new InputError(
        'Weather-model forecasts must not invent observation timestamps',
      );
    const provenance = object(v.provenance);
    for (const key of [
      'provider',
      'product',
      'sourceUrl',
      'temporalMethod',
      'spatialMethod',
      'attribution',
    ]) {
      if (
        typeof provenance[key] !== 'string' ||
        !provenance[key] ||
        (provenance[key] as string).length > 1000
      )
        throw new InputError(`Weather forecast ${key} is required`);
    }
    if (
      typeof provenance.retrievedAt !== 'string' ||
      !Number.isFinite(Date.parse(provenance.retrievedAt))
    )
      throw new InputError('Forecast retrieval time is required');
    for (const key of ['modelRunTime', 'observationTime']) {
      if (
        provenance[key] !== null &&
        (typeof provenance[key] !== 'string' ||
          !Number.isFinite(Date.parse(provenance[key] as string)))
      )
        throw new InputError(`${key} must be a timestamp or null when unknown`);
    }
  }
  if (
    v.mode !== 'weather_model' &&
    Date.parse(v.observedThrough as string) > Date.parse(v.issuedAt as string)
  )
    throw new InputError('Observation time cannot follow issue time');
  if (
    v.mode === 'live' &&
    (Date.now() - Date.parse(v.observedThrough as string) > 20 * 60000 ||
      Date.parse(v.issuedAt as string) > Date.now() + 60000)
  )
    throw new InputError(
      'Live rainfall must have observations within 20 minutes and a valid issue time',
      422,
    );
  return v as unknown as RainCube;
}
export function validateDataset(value: unknown): Dataset {
  const v = object(value),
    g = object(v.grid),
    w = finite(g.width, 'grid.width', 4, 64),
    h = finite(g.height, 'grid.height', 4, 64);
  if (!Number.isInteger(w) || !Number.isInteger(h))
    throw new InputError('Grid dimensions must be integers');
  finite(g.cellSizeM, 'cellSizeM', 5, 500);
  const n = w * h;
  if (!Array.isArray(g.origin) || g.origin.length !== 2)
    throw new InputError('Grid origin must be [longitude, latitude]');
  finite(g.origin[0], 'longitude', -180, 180);
  finite(g.origin[1], 'latitude', -80, 80);
  for (const [key, min, max] of [
    ['elevationM', -100, 9000],
    ['imperviousness', 0, 1],
    ['roughness', 0.008, 0.5],
  ] as const) {
    if (!Array.isArray(g[key]) || g[key].length !== n)
      throw new InputError(`${key} must contain width × height cells`);
    for (const cell of g[key]) finite(cell, key, min, max);
  }
  for (const key of ['drains', 'pipes', 'roadNodes', 'roads'])
    if (!Array.isArray(v[key]) || v[key].length > 1000)
      throw new InputError(`${key} must be an array with at most 1000 entries`);
  for (const key of ['id', 'name', 'provenance'])
    if (
      typeof v[key] !== 'string' ||
      !v[key] ||
      (v[key] as string).length > 1000
    )
      throw new InputError(`Dataset ${key} is required`);
  validateScenario({ city: v.city });
  if (!['synthetic', 'replay'].includes(String(v.mode)))
    throw new InputError('Dataset mode must be synthetic or replay');
  const validCell = (c: unknown) => {
    finite(c, 'cell index', 0, n - 1);
    if (!Number.isInteger(c))
      throw new InputError('Cell indices must be integers');
  };
  const ids = (arr: unknown[]) => {
    const seen = new Set<string>();
    for (const raw of arr) {
      const i = object(raw);
      if (
        typeof i.id !== 'string' ||
        !i.id ||
        i.id.length > 100 ||
        seen.has(i.id) ||
        ['__proto__', 'constructor', 'prototype'].includes(i.id)
      )
        throw new InputError('Graph IDs must be unique nonempty safe strings');
      seen.add(i.id);
    }
    return seen;
  };
  const drains = v.drains as unknown[],
    nodes = v.roadNodes as unknown[],
    pipes = v.pipes as unknown[],
    roads = v.roads as unknown[];
  const drainIds = ids(drains),
    nodeIds = ids(nodes);
  ids(pipes);
  ids(roads);
  for (const raw of drains) {
    const d = object(raw);
    validCell(d.cell);
    finite(d.invertM, 'invertM', -110, 9000);
    finite(d.rimM, 'rimM', -100, 9000);
    if (
      (d.rimM as number) <= (d.invertM as number) ||
      Math.abs(
        (d.rimM as number) - (g.elevationM as number[])[d.cell as number],
      ) > 0.01
    )
      throw new InputError(
        'Drain rim must match its terrain cell and exceed the invert',
      );
    finite(d.storageAreaM2, 'storageAreaM2', 0.1, 1000);
    finite(d.inletAreaM2, 'inletAreaM2', 0.001, 10);
    if (typeof d.outfall !== 'boolean')
      throw new InputError('outfall must be boolean');
  }
  for (const raw of pipes) {
    const p = object(raw);
    if (
      !drainIds.has(String(p.from)) ||
      !drainIds.has(String(p.to)) ||
      p.from === p.to
    )
      throw new InputError('Pipe references unknown or identical nodes');
    finite(p.diameterM, 'diameterM', 0.05, 10);
    finite(p.lengthM, 'lengthM', 1, 20000);
    finite(p.roughness, 'roughness', 0.008, 0.1);
    finite(p.blockage, 'blockage', 0, 1);
  }
  for (const raw of nodes) {
    const p = object(raw);
    validCell(p.cell);
    if (typeof p.name !== 'string')
      throw new InputError('Road node name required');
    if (!Array.isArray(p.coordinate) || p.coordinate.length !== 2)
      throw new InputError('Road coordinates must be [longitude,latitude]');
    finite(p.coordinate[0], 'longitude', -180, 180);
    finite(p.coordinate[1], 'latitude', -80, 80);
  }
  for (const raw of roads) {
    const r = object(raw);
    if (
      !nodeIds.has(String(r.from)) ||
      !nodeIds.has(String(r.to)) ||
      r.from === r.to
    )
      throw new InputError('Road references unknown or identical nodes');
    finite(r.lengthM, 'lengthM', 1, 50000);
    if (
      typeof r.name !== 'string' ||
      !Array.isArray(r.cells) ||
      !r.cells.length ||
      r.cells.length > 4096
    )
      throw new InputError('Road name and sampled cells required');
    r.cells.forEach(validCell);
    if (
      !Array.isArray(r.coordinates) ||
      r.coordinates.length < 2 ||
      r.coordinates.length > 4096
    )
      throw new InputError('Road geometry requires at least two coordinates');
    for (const c of r.coordinates) {
      if (!Array.isArray(c) || c.length !== 2)
        throw new InputError('Invalid road coordinate');
      finite(c[0], 'longitude', -180, 180);
      finite(c[1], 'latitude', -80, 80);
    }
    for (const key of ['closed', 'oneWay'])
      if (r[key] !== undefined && typeof r[key] !== 'boolean')
        throw new InputError(`${key} must be boolean`);
  }
  return v as unknown as Dataset;
}
export async function readBody(request: Request | Response) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > 2000000) throw new InputError('Request exceeds 2 MB', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('JSON body required');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw new InputError('Request exceeds 2 MB', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError('Malformed JSON');
  }
}
export function errorResponse(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof InputError
          ? e.message
          : 'Simulation failed. Check input data and retry.',
    },
    {
      status: e instanceof InputError ? e.status : 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
  );
}

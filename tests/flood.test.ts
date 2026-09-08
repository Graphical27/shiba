import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate,
  exchangeVolumes,
  pipeCapacity,
} from '../lib/flood/engine.ts';
import { makeDataset, makeRainCube } from '../lib/flood/fixtures.ts';
import { getForecast } from '../lib/flood/service.ts';
import {
  validateDataset,
  validateRain,
  validateScenario,
} from '../lib/flood/validation.ts';
import { routeForecast } from '../lib/flood/routing.ts';
import { advectRain } from '../lib/flood/nowcast.ts';
import type {
  Dataset,
  Forecast,
  RainCube,
  Scenario,
} from '../lib/flood/types.ts';
const scenario: Scenario = {
  city: 'mumbai',
  rainfallMmHr: 80,
  blockage: 0.3,
  tailwaterM: 0,
};
function flat(): Dataset {
  return {
    id: 'test',
    city: 'mumbai',
    name: 'Test',
    mode: 'synthetic',
    provenance: 'Analytic fixture',
    grid: {
      width: 4,
      height: 4,
      cellSizeM: 100,
      origin: [72, 19],
      elevationM: Array(16).fill(3),
      imperviousness: Array(16).fill(1),
      roughness: Array(16).fill(0.03),
    },
    drains: [],
    pipes: [],
    roadNodes: [],
    roads: [],
  };
}
function uniform(dataset: Dataset, rate: number): RainCube {
  return {
    issuedAt: '2026-09-08T00:00:00Z',
    observedThrough: '2026-09-08T00:00:00Z',
    source: 'test',
    mode: 'synthetic',
    unit: 'mm/h',
    width: dataset.grid.width,
    height: dataset.grid.height,
    stepMinutes: 15,
    frames: Array.from({ length: 13 }, () =>
      Array(dataset.grid.width * dataset.grid.height).fill(rate),
    ),
  };
}
const defaultForecast = getForecast(scenario);
test('13 exact output frames and finite nonnegative state', () => {
  assert.deepEqual(
    defaultForecast.frames.map((f) => f.minute),
    Array.from({ length: 13 }, (_, i) => i * 15),
  );
  for (const f of defaultForecast.frames)
    for (const value of [...f.depthsCm, ...f.drainDepthsM])
      assert.ok(Number.isFinite(value) && value >= -1e-10);
});
test('Coupled closed-surface mass accounting conserves rain, infiltration, outfall and storage', () => {
  assert.ok(defaultForecast.massBalance.relativeError < 1e-9);
  assert.ok(defaultForecast.massBalance.infiltrationM3 > 0);
  assert.ok(defaultForecast.massBalance.outfallM3 > 0);
});
test('Dry start remains dry with no rain or tailwater', () => {
  const ds = flat(),
    f = simulate(ds, uniform(ds, 0), { ...scenario, rainfallMmHr: 0 });
  assert.equal(f.massBalance.storedM3, 0);
  assert.ok(f.frames.every((frame) => frame.depthsCm.every((d) => d === 0)));
});
test('Uniform rain on flat impermeable terrain matches analytic depth and volume', () => {
  const ds = flat(),
    f = simulate(ds, uniform(ds, 80), scenario);
  assert.ok(Math.abs(f.massBalance.rainfallM3 - 16 * 10000 * 0.24) < 1e-6);
  for (const d of f.frames[12].depthsCm) assert.ok(Math.abs(d - 24) < 1e-8);
});
test('Donor limiter cannot create negative volume with multiple outflows', () => {
  const v = new Float64Array([1, 0, 0]);
  const transferred = exchangeVolumes(v, [
    [0, 1, 5],
    [0, 2, 5],
  ]);
  assert.deepEqual(Array.from(v), [0, 0.5, 0.5]);
  assert.deepEqual(transferred, [0.5, 0.5]);
});
test('Fully blocked pipe network has exactly zero pipe flow', () => {
  const ds = makeDataset('mumbai'),
    s = { ...scenario, blockage: 1 },
    f = simulate(ds, makeRainCube(ds, s), s);
  assert.ok(
    f.frames.every((frame) => frame.pipeFlowsM3s.every((q) => q === 0)),
  );
  assert.ok(f.massBalance.relativeError < 1e-9);
});
test('High tailwater produces boundary inflow and surcharge without rain', () => {
  const ds = flat();
  ds.drains = [
    {
      id: 'd',
      cell: 5,
      name: 'Inlet',
      invertM: 1,
      rimM: 3,
      storageAreaM2: 35,
      inletAreaM2: 0.12,
      outfall: true,
    },
  ];
  const f = simulate(ds, uniform(ds, 0), {
    ...scenario,
    rainfallMmHr: 0,
    tailwaterM: 4,
  });
  assert.ok(f.massBalance.boundaryInflowM3 > 0);
  assert.ok(f.frames.some((frame) => frame.surchargeM3[0] > 0));
  assert.ok(f.frames[12].summary.surfaceVolumeM3 > 0);
  assert.ok(f.massBalance.relativeError < 1e-9);
});
test('Manning full-pipe capacity matches independent arithmetic', () => {
  const expected =
    (((Math.PI * 0.65 * 0.65) / 4) *
      Math.pow(0.65 / 4, 2 / 3) *
      Math.sqrt(0.001)) /
    0.014;
  assert.ok(Math.abs(pipeCapacity(0.65, 0.014, 0.001) - expected) < 1e-12);
  assert.equal(pipeCapacity(0.65, 0.014, 0), 0);
});
test('Halving internal timestep gives similar final peak, with independent conservation', () => {
  const ds = makeDataset('mumbai'),
    f = simulate(ds, makeRainCube(ds, scenario), scenario, {
      maxStepSeconds: 5,
    });
  assert.ok(f.massBalance.relativeError < 1e-9);
  const a = defaultForecast.frames[12].summary.peakDepthCm,
    b = f.frames[12].summary.peakDepthCm;
  assert.ok(Math.abs(a - b) / Math.max(1, a) < 0.05, `${a} vs ${b}`);
});
function routeFixture(): Forecast {
  const f = structuredClone(defaultForecast),
    ds = flat();
  ds.roadNodes = ['A', 'B', 'C', 'D'].map((id, i) => ({
    id,
    cell: i,
    name: id,
    coordinate: [72 + i * 0.001, 19],
  }));
  ds.roads = [
    ['AB', 'A', 'B', 100],
    ['BD', 'B', 'D', 100],
    ['AC', 'A', 'C', 200],
    ['CD', 'C', 'D', 200],
  ].map(([id, from, to, length]) => ({
    id: String(id),
    from: String(from),
    to: String(to),
    name: String(id),
    lengthM: Number(length),
    cells: [0, 1],
    coordinates: [
      [72, 19],
      [72.001, 19],
    ],
  }));
  f.dataset = ds;
  for (const frame of f.frames) {
    frame.streetDepthsCm = { AB: 0, BD: 0, AC: 0, CD: 0 };
    frame.streetIntervalMaxCm = { AB: 0, BD: 0, AC: 0, CD: 0 };
  }
  return f;
}
test('Dry routing uses the shortest path; flooded shortcut forces a detour', () => {
  const f = routeFixture();
  assert.deepEqual(routeForecast(f, 'A', 'D', 0).safer?.edgeIds, ['AB', 'BD']);
  f.frames[1].streetIntervalMaxCm.BD = 30;
  const r = routeForecast(f, 'A', 'D', 0);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.safer?.edgeIds, ['AC', 'CD']);
  assert.ok(r.safer?.edgeIds.every((id) => !r.excludedEdges.includes(id)));
});
test('No eligible route returns null, never flooded baseline', () => {
  const f = routeFixture();
  for (const frame of f.frames) {
    frame.streetIntervalMaxCm.BD = 30;
    frame.streetIntervalMaxCm.CD = 30;
  }
  const r = routeForecast(f, 'A', 'D', 0);
  assert.equal(r.status, 'no_route');
  assert.equal(r.safer, null);
  assert.ok(r.baseline);
});
test('Future interval maximum blocks a road even if snapshot appears dry', () => {
  const f = routeFixture();
  f.frames[2].streetIntervalMaxCm.BD = 30;
  assert.deepEqual(routeForecast(f, 'A', 'D', 0).safer?.edgeIds, ['AC', 'CD']);
});
test('Missing, nonfinite and exhausted forecast coverage never becomes dry', () => {
  for (const version of ['empty', 'gap', 'nonfinite', 'expired']) {
    const f = routeFixture();
    if (version === 'empty') f.frames = [];
    if (version === 'gap')
      f.frames = f.frames.filter((frame) => frame.minute !== 15);
    if (version === 'nonfinite') f.frames[1].streetIntervalMaxCm.BD = NaN;
    const r = routeForecast(f, 'A', 'D', version === 'expired' ? 180 : 0);
    assert.equal(r.status, 'insufficient_data', version);
    assert.equal(r.safer, null);
  }
});
test('Shorter eligible route is found when risk optimum exceeds travel window', () => {
  const f = routeFixture();
  f.dataset.roads[0].lengthM = 6500;
  f.dataset.roads[1].lengthM = 6500;
  f.dataset.roads[2].lengthM = 4500;
  f.dataset.roads[3].lengthM = 4500;
  for (const frame of f.frames) {
    frame.streetIntervalMaxCm.AC = 10;
    frame.streetIntervalMaxCm.CD = 10;
  }
  const r = routeForecast(f, 'A', 'D', 0);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.safer?.edgeIds, ['AC', 'CD']);
  assert.ok(r.safer!.durationMinutes <= 30);
});
test('One-way roads and closed roads are respected', () => {
  const f = routeFixture();
  for (const r of f.dataset.roads) r.oneWay = true;
  assert.equal(routeForecast(f, 'D', 'A', 0).status, 'no_route');
  f.dataset.roads[0].closed = true;
  assert.deepEqual(routeForecast(f, 'A', 'D', 0).safer?.edgeIds, ['AC', 'CD']);
});
test('Scenario and dataset validation rejects malformed, unsafe and nonfinite fields', () => {
  assert.throws(() => validateScenario({ city: 'unknown' }));
  assert.throws(() => validateScenario({ blockage: NaN }));
  assert.throws(() => validateScenario({ rainfallMmHr: 201 }));
  const ds = makeDataset('delhi');
  assert.equal(validateDataset(ds).city, 'delhi');
  ds.pipes[0].to = 'unknown';
  assert.throws(() => validateDataset(ds));
});
test('Rain validation preserves missing coverage and rejects stale live data', () => {
  const ds = flat(),
    rain = uniform(ds, 80);
  rain.frames[0][0] = null;
  assert.throws(() => validateRain(rain, ds), /Missing rainfall coverage/);
  rain.frames[0][0] = 80;
  rain.mode = 'live';
  assert.throws(() => validateRain(rain, ds), /Live rainfall/);
});
test('Advection recovers translating rain and leaves unknown boundaries null', () => {
  const width = 12,
    height = 12,
    observations = [0, 1, 2].map((f) =>
      Array.from(
        { length: 144 },
        (_, i) =>
          40 *
          Math.exp(
            -(((i % width) - 4 - f) ** 2 + (Math.floor(i / width) - 6) ** 2) /
              3,
          ),
      ),
    );
  const r = advectRain({
    width,
    height,
    observationStepMinutes: 15,
    observedThrough: '2026-09-08T00:00:00Z',
    observations,
  });
  assert.deepEqual(r.motionPixelsPerStep, [1, 0]);
  assert.equal(r.frames.length, 13);
  assert.equal(r.frames[1][0], null);
  assert.ok(
    Math.abs(r.frames[1][6 * width + 7]! - observations[2][6 * width + 6]) <
      1e-9,
  );
});

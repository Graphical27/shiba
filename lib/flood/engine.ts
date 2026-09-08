import type { Dataset, Forecast, Frame, RainCube, Scenario } from './types.ts';
import { MODEL_VERSION } from './types.ts';
import { InputError } from './validation.ts';
const G = 9.81;
export function pipeCapacity(
  diameterM: number,
  roughness: number,
  slope: number,
) {
  return (
    (((Math.PI * diameterM ** 2) / 4) *
      Math.pow(diameterM / 4, 2 / 3) *
      Math.sqrt(Math.max(0, slope))) /
    roughness
  );
}
export function exchangeVolumes(
  volumes: Float64Array,
  transfers: [number, number, number][],
) {
  const outgoing = new Float64Array(volumes.length);
  for (const [from, , amount] of transfers) outgoing[from] += amount;
  const scales = outgoing.map((q, i) =>
    q > 0 ? Math.min(1, volumes[i] / q) : 1,
  );
  const actual: number[] = [];
  for (const [from, to, amount] of transfers) {
    const v = amount * scales[from];
    volumes[from] -= v;
    volumes[to] += v;
    actual.push(v);
  }
  return actual;
}
/** Reduced-order bidirectional storage graph, NOT full Saint-Venant pipe routing. */
export function simulate(
  dataset: Dataset,
  rain: RainCube,
  scenario: Scenario,
  options: { maxStepSeconds?: number } = {},
): Forecast {
  const started = performance.now(),
    grid = dataset.grid,
    n = grid.width * grid.height,
    nn = dataset.drains.length,
    area = grid.cellSizeM ** 2;
  const volume = new Float64Array(n + nn),
    z = grid.elevationM,
    faces: { a: number; b: number; q: number; rough: number }[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const a = y * grid.width + x;
      if (x + 1 < grid.width)
        faces.push({
          a,
          b: a + 1,
          q: 0,
          rough: (grid.roughness[a] + grid.roughness[a + 1]) / 2,
        });
      if (y + 1 < grid.height)
        faces.push({
          a,
          b: a + grid.width,
          q: 0,
          rough: (grid.roughness[a] + grid.roughness[a + grid.width]) / 2,
        });
    }
  const indices = new Map(dataset.drains.map((d, i) => [d.id, i]));
  const pipes = dataset.pipes.map((p) => ({
    ...p,
    a: indices.get(p.from)!,
    b: indices.get(p.to)!,
  }));
  const degree = new Uint16Array(nn);
  for (const p of pipes) {
    degree[p.a]++;
    degree[p.b]++;
  }
  const pipeFlow = new Float64Array(pipes.length),
    intervalMax = new Float64Array(n),
    surcharge = new Float64Array(nn);
  let rainTotal = 0,
    infiltrationTotal = 0,
    outfallTotal = 0,
    boundaryIn = 0,
    time = 0;
  const frames: Frame[] = [];
  const save = () => {
    const depthsCm = Array.from(volume.slice(0, n), (v) => (v / area) * 100);
    const streetDepthsCm: Record<string, number> = {},
      streetIntervalMaxCm: Record<string, number> = {};
    for (const road of dataset.roads) {
      streetDepthsCm[road.id] = Math.max(...road.cells.map((c) => depthsCm[c]));
      streetIntervalMaxCm[road.id] = Math.max(
        ...road.cells.map((c) => intervalMax[c]),
      );
    }
    const rf = rain.frames[Math.min(12, Math.floor(time / 900))];
    frames.push({
      minute: time / 60,
      rainMmHr: rf.reduce<number>((s, v) => s + (v ?? 0), 0) / n,
      depthsCm,
      intervalMaxCm: Array.from(intervalMax),
      streetDepthsCm,
      streetIntervalMaxCm,
      drainDepthsM: dataset.drains.map(
        (d, i) => volume[n + i] / d.storageAreaM2,
      ),
      surchargeM3: Array.from(surcharge),
      pipeFlowsM3s: Array.from(pipeFlow),
      summary: {
        peakDepthCm: Math.max(0, ...Object.values(streetDepthsCm)),
        streetsAtRisk: Object.values(streetDepthsCm).filter((d) => d >= 15)
          .length,
        surchargedNodes: Array.from(surcharge).filter((v) => v > 0.001).length,
        surfaceVolumeM3: volume.slice(0, n).reduce((s, v) => s + v, 0),
        drainVolumeM3: volume.slice(n).reduce((s, v) => s + v, 0),
      },
    });
    intervalMax.set(depthsCm);
    surcharge.fill(0);
  };
  save();
  let workUnits = 0;
  while (time < 10800) {
    workUnits += n + nn + pipes.length;
    if (workUnits > 16000000) {
      throw new InputError(
        'This resolution and scenario exceed the bounded simulation budget. Use a smaller catchment or an external model runner.',
        422,
      );
    }
    let maxH = 0.001;
    for (let i = 0; i < n; i++) maxH = Math.max(maxH, volume[i] / area);
    const dt = Math.min(
      options.maxStepSeconds ?? 10,
      (0.4 * grid.cellSizeM) / Math.sqrt(G * maxH),
      900 - (time % 900),
      10800 - time,
    );
    const rates = rain.frames[Math.min(11, Math.floor(time / 900))];
    for (let i = 0; i < n; i++) {
      const added = ((rates[i] as number) / 3600000) * area * dt;
      volume[i] += added;
      rainTotal += added;
      const horton =
        ((3 + 17 * Math.exp(-time / 3600)) * (1 - grid.imperviousness[i])) /
        3600000;
      const removed = Math.min(volume[i], horton * area * dt);
      volume[i] -= removed;
      infiltrationTotal += removed;
    }
    const transfers: [number, number, number][] = [];
    const faceTransfer: { face: number; transfer: number; sign: number }[] = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi],
        ha = z[f.a] + volume[f.a] / area,
        hb = z[f.b] + volume[f.b] / area,
        hf = Math.max(0, Math.max(ha, hb) - Math.max(z[f.a], z[f.b]));
      if (hf < 1e-7) {
        f.q = 0;
        continue;
      }
      const q =
        (f.q - (G * hf * dt * (hb - ha)) / grid.cellSizeM) /
        (1 + (G * f.rough ** 2 * dt * Math.abs(f.q)) / hf ** (7 / 3));
      const from = q >= 0 ? f.a : f.b,
        to = q >= 0 ? f.b : f.a;
      // Limit transfer to partial equalization; suppress wet/dry overshoot.
      const equalize = (Math.abs(ha - hb) * area) / 2;
      const amount = Math.min(
        Math.abs(q) * grid.cellSizeM * dt,
        equalize * 0.8,
      );
      faceTransfer.push({
        face: fi,
        transfer: transfers.length,
        sign: q >= 0 ? 1 : -1,
      });
      transfers.push([from, to, amount]);
    }
    const actual = exchangeVolumes(volume, transfers);
    for (const f of faceTransfer)
      faces[f.face].q = (f.sign * actual[f.transfer]) / (dt * grid.cellSizeM);
    const pipeTransfers: [number, number, number][] = [],
      pipeRefs: { index: number; sign: number; transfer: number }[] = [];
    pipeFlow.fill(0);
    for (let pi = 0; pi < pipes.length; pi++) {
      const p = pipes[pi],
        a = dataset.drains[p.a],
        b = dataset.drains[p.b];
      const ha = a.invertM + volume[n + p.a] / a.storageAreaM2,
        hb = b.invertM + volume[n + p.b] / b.storageAreaM2;
      const sign = ha >= hb ? 1 : -1,
        from = sign === 1 ? p.a : p.b,
        to = sign === 1 ? p.b : p.a;
      const donor = dataset.drains[from],
        receiver = dataset.drains[to],
        depth = volume[n + from] / donor.storageAreaM2;
      const wetDepth = Math.max(
        0,
        Math.min(
          p.diameterM,
          Math.max(ha, hb) - Math.max(a.invertM, b.invertM),
          depth,
        ),
      );
      const theta = 2 * Math.acos(1 - (2 * wetDepth) / p.diameterM),
        wetArea = (p.diameterM ** 2 / 8) * (theta - Math.sin(theta)),
        perimeter = (p.diameterM * theta) / 2;
      const q =
        perimeter > 0
          ? ((wetArea * (wetArea / perimeter) ** (2 / 3)) / p.roughness) *
            Math.sqrt(Math.abs(ha - hb) / p.lengthM) *
            (1 - p.blockage) *
            (1 - scenario.blockage)
          : 0;
      const equalize =
        Math.abs(ha - hb) /
        (1 / donor.storageAreaM2 + 1 / receiver.storageAreaM2);
      pipeRefs.push({ index: pi, sign, transfer: pipeTransfers.length });
      pipeTransfers.push([
        n + from,
        n + to,
        Math.min(
          q * dt,
          (equalize * 0.8) / Math.max(degree[from], degree[to], 1),
        ),
      ]);
    }
    const pipeActual = exchangeVolumes(volume, pipeTransfers);
    for (const r of pipeRefs)
      pipeFlow[r.index] = (r.sign * pipeActual[r.transfer]) / dt;
    for (let i = 0; i < nn; i++) {
      const d = dataset.drains[i],
        cell = d.cell,
        hs = z[cell] + volume[cell] / area,
        hd = d.invertM + volume[n + i] / d.storageAreaM2;
      const surfaceDonor = hs >= hd,
        high = Math.max(hs, hd),
        low = Math.max(Math.min(hs, hd), d.rimM),
        head = Math.max(0, high - low);
      const q = Math.min(
        0.62 * d.inletAreaM2 * Math.sqrt(2 * G * head),
        1.7 * 4 * Math.sqrt(d.inletAreaM2) * head ** 1.5,
      );
      const equalize = Math.abs(hs - hd) / (1 / area + 1 / d.storageAreaM2);
      const from = surfaceDonor ? cell : n + i,
        to = surfaceDonor ? n + i : cell;
      const amount = Math.min(q * dt, equalize * 0.8, volume[from]);
      volume[from] -= amount;
      volume[to] += amount;
      if (!surfaceDonor) surcharge[i] += amount;
      if (d.outfall) {
        const h = d.invertM + volume[n + i] / d.storageAreaM2,
          tail = d.invertM + scenario.tailwaterM,
          delta = h - tail;
        const qOut = pipeCapacity(0.65, 0.014, Math.abs(delta) / 80),
          equal = Math.abs(delta) * d.storageAreaM2;
        if (delta > 0) {
          const v = Math.min(qOut * dt, volume[n + i], equal * 0.8);
          volume[n + i] -= v;
          outfallTotal += v;
        } else {
          const v = Math.min(qOut * dt, equal * 0.8);
          volume[n + i] += v;
          boundaryIn += v;
        }
      }
    }
    for (let i = 0; i < n; i++)
      intervalMax[i] = Math.max(intervalMax[i], (volume[i] / area) * 100);
    time += dt;
    if (Math.abs(time / 900 - Math.round(time / 900)) < 1e-8) save();
  }
  const stored = volume.reduce((s, v) => s + v, 0),
    residual =
      rainTotal + boundaryIn - infiltrationTotal - outfallTotal - stored;
  return {
    id: `${dataset.id}-${scenario.rainfallMmHr}-${scenario.blockage}-${scenario.tailwaterM}`,
    modelVersion: MODEL_VERSION,
    generatedAt: rain.issuedAt,
    validUntil: new Date(Date.parse(rain.issuedAt) + 10800000).toISOString(),
    dataMode: rain.mode,
    calibrated: false,
    scenario,
    dataset,
    frames,
    massBalance: {
      rainfallM3: rainTotal,
      infiltrationM3: infiltrationTotal,
      outfallM3: outfallTotal,
      boundaryInflowM3: boundaryIn,
      storedM3: stored,
      residualM3: residual,
      relativeError: Math.abs(residual) / Math.max(1, rainTotal + boundaryIn),
    },
    runtimeMs: performance.now() - started,
    warnings: [
      'Research model; not calibrated or validated for operational flood depths or navigation.',
      dataset.provenance,
      'Closed surface boundaries; open head-driven outfalls. Reduced-order storage graph omits full pipe momentum.',
      'Display resolution is not measurement accuracy. No machine-learning surrogate is trained or used.',
    ],
  };
}

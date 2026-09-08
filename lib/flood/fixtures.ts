import type { CityId, Dataset, Grid, RainCube, Scenario } from './types.ts';
import { cellCoordinate } from './types.ts';
export const CITY_INFO = {
  mumbai: {
    name: 'Mumbai',
    origin: [72.823, 19.007] as [number, number],
    area: 'Dadar · Parel',
    roads: [
      'Prabhadevi Road',
      'Senapati Bapat Marg',
      'Elphinstone Road',
      'Hindmata junction',
      'Dr. Ambedkar Road',
      'Dadar TT',
      'Matunga Road',
    ],
  },
  delhi: {
    name: 'Delhi',
    origin: [77.185, 28.613] as [number, number],
    area: 'Central Delhi',
    roads: [
      'Mandir Marg',
      'Panchkuian Road',
      'Minto Road',
      'Connaught Place',
      'Barakhamba Road',
      'Tilak Marg',
      'Bahadur Shah Zafar Marg',
    ],
  },
  chennai: {
    name: 'Chennai',
    origin: [80.211, 13.023] as [number, number],
    area: 'T. Nagar · West Mambalam',
    roads: [
      'Lake View Road',
      'Usman Road',
      'Duraisamy Road',
      'Ranganathan Street',
      'Thyagaraya Road',
      'Venkatnarayana Road',
      'Anna Salai',
    ],
  },
};
export function makeDataset(city: CityId): Dataset {
  const info = CITY_INFO[city],
    width = 32,
    height = 32,
    cellSizeM = 100;
  const elevationM: number[] = [],
    imperviousness: number[] = [],
    roughness: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const road =
        (x >= 3 && x <= 27 && (x - 3) % 4 === 0) ||
        (y >= 3 && y <= 27 && (y - 3) % 4 === 0);
      const bowl =
        1.8 * Math.exp(-((x - 15) ** 2 + (y - 15) ** 2) / 26) +
        1.1 * Math.exp(-((x - 23) ** 2 + (y - 11) ** 2) / 14);
      elevationM.push(
        4 +
          y * 0.028 +
          x * 0.008 +
          0.09 * Math.sin(x * 0.7) * Math.cos(y * 0.4) -
          bowl +
          (road ? 0 : 0.18),
      );
      imperviousness.push(road ? 0.97 : 0.65);
      roughness.push(road ? 0.025 : 0.08);
    }
  const grid: Grid = {
    width,
    height,
    cellSizeM,
    origin: info.origin,
    elevationM,
    imperviousness,
    roughness,
  };
  const dataset: Dataset = {
    id: `${city}-illustrative-v1`,
    city,
    name: info.name,
    mode: 'synthetic',
    provenance:
      'Synthetic 100 m terrain, illustrative street geometry and assumed drains. Place names provide city context; geometry is not surveyed.',
    grid,
    roadNodes: [],
    roads: [],
    drains: [],
    pipes: [],
  };
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const cell = (y * 4 + 3) * width + x * 4 + 3,
        id = `n${y * 7 + x}`;
      dataset.roadNodes.push({
        id,
        cell,
        name: `${info.roads[y]} / sector ${x + 1}`,
        coordinate: cellCoordinate(grid, cell),
      });
      dataset.drains.push({
        id,
        cell,
        name: `MH-${String(y * 7 + x + 1).padStart(3, '0')}`,
        invertM: elevationM[cell] - 1.8,
        rimM: elevationM[cell],
        storageAreaM2: 35,
        inletAreaM2: 0.12,
        outfall: y === 0,
      });
    }
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const index = y * 7 + x;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        if (x + dx >= 7 || y + dy >= 7) continue;
        const a = dataset.roadNodes[index],
          b = dataset.roadNodes[(y + dy) * 7 + x + dx];
        const cells = Array.from(
          { length: 5 },
          (_, k) => a.cell + k * (dx ? 1 : width),
        );
        const id = `e${dataset.roads.length}`;
        dataset.roads.push({
          id,
          from: a.id,
          to: b.id,
          name: info.roads[dy ? x : y],
          cells,
          lengthM: 400,
          coordinates: cells.map((c) => cellCoordinate(grid, c)),
        });
        dataset.pipes.push({
          id: `p${dataset.pipes.length}`,
          from: b.id,
          to: a.id,
          diameterM: dy ? 0.65 : 0.45,
          lengthM: 400,
          roughness: 0.014,
          blockage: x === 3 && y === 3 ? 0.35 : 0,
        });
      }
    }
  return dataset;
}
export function makeRainCube(dataset: Dataset, scenario: Scenario): RainCube {
  const { width, height } = dataset.grid;
  return {
    issuedAt: new Date().toISOString(),
    observedThrough: new Date().toISOString(),
    source: 'Deterministic translating synthetic storm',
    mode: 'synthetic',
    unit: 'mm/h',
    width,
    height,
    stepMinutes: 15,
    frames: Array.from({ length: 13 }, (_, f) =>
      Array.from({ length: width * height }, (_, i) => {
        const x = i % width,
          y = Math.floor(i / width),
          storm = Math.exp(
            -((x - (10 + f * 1.3)) ** 2 + (y - (20 - f * 0.65)) ** 2) / 210,
          );
        return (
          scenario.rainfallMmHr *
          (0.25 + 0.85 * storm) *
          (0.6 + 0.4 * Math.sin(((f + 2) / 15) * Math.PI))
        );
      }),
    ),
  };
}

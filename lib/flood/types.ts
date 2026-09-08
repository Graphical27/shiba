export type CityId = 'mumbai' | 'delhi' | 'chennai';
export type Point = [number, number];
export interface Grid {
  width: number;
  height: number;
  cellSizeM: number;
  origin: Point;
  elevationM: number[];
  imperviousness: number[];
  roughness: number[];
}
export interface DrainNode {
  id: string;
  cell: number;
  name: string;
  invertM: number;
  rimM: number;
  storageAreaM2: number;
  inletAreaM2: number;
  outfall: boolean;
}
export interface Pipe {
  id: string;
  from: string;
  to: string;
  diameterM: number;
  lengthM: number;
  roughness: number;
  blockage: number;
}
export interface RoadNode {
  id: string;
  cell: number;
  name: string;
  coordinate: Point;
}
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  cells: number[];
  lengthM: number;
  coordinates: Point[];
  closed?: boolean;
  oneWay?: boolean;
}
export interface Dataset {
  id: string;
  city: CityId;
  name: string;
  mode: 'synthetic' | 'replay';
  provenance: string;
  grid: Grid;
  drains: DrainNode[];
  pipes: Pipe[];
  roadNodes: RoadNode[];
  roads: RoadEdge[];
}
export interface Scenario {
  city: CityId;
  rainfallMmHr: number;
  blockage: number;
  tailwaterM: number;
}
export interface RainfallProvenance {
  provider: string;
  product: string;
  sourceUrl: string;
  retrievedAt: string;
  modelRunTime: string | null;
  observationTime: string | null;
  temporalMethod: string;
  spatialMethod: string;
  attribution: string;
  requestedPoint?: Point;
  weatherGridPoint?: Point;
}
export interface RainCube {
  issuedAt: string;
  observedThrough: string | null;
  source: string;
  mode: 'synthetic' | 'replay' | 'live' | 'weather_model';
  provenance?: RainfallProvenance;
  unit: 'mm/h';
  width: number;
  height: number;
  stepMinutes: 15;
  frames: (number | null)[][];
}
export interface Frame {
  minute: number;
  rainMmHr: number;
  depthsCm: number[];
  intervalMaxCm: number[];
  streetDepthsCm: Record<string, number>;
  streetIntervalMaxCm: Record<string, number>;
  drainDepthsM: number[];
  surchargeM3: number[];
  pipeFlowsM3s: number[];
  summary: {
    peakDepthCm: number;
    streetsAtRisk: number;
    surchargedNodes: number;
    surfaceVolumeM3: number;
    drainVolumeM3: number;
  };
}
export interface Forecast {
  id: string;
  modelVersion: string;
  generatedAt: string;
  validUntil: string;
  dataMode: RainCube['mode'];
  forcing?: RainfallProvenance;
  calibrated: false;
  scenario: Scenario;
  dataset: Dataset;
  frames: Frame[];
  massBalance: {
    rainfallM3: number;
    infiltrationM3: number;
    outfallM3: number;
    boundaryInflowM3: number;
    storedM3: number;
    residualM3: number;
    relativeError: number;
  };
  runtimeMs: number;
  warnings: string[];
}
export const MODEL_VERSION = 'varsha-coupled-0.1.0';
export function cellCoordinate(grid: Grid, cell: number): Point {
  const x = cell % grid.width,
    y = Math.floor(cell / grid.width);
  return [
    grid.origin[0] +
      ((x + 0.5) * grid.cellSizeM) /
        (111320 * Math.cos((grid.origin[1] * Math.PI) / 180)),
    grid.origin[1] + ((y + 0.5) * grid.cellSizeM) / 111320,
  ];
}
export function depthColor(cm: number) {
  return cm >= 30
    ? '#de6b62'
    : cm >= 15
      ? '#ee9562'
      : cm >= 5
        ? '#e3bb59'
        : '#8fbba4';
}

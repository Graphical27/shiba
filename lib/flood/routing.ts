import type { Forecast, Point, RoadEdge } from './types.ts';
import { InputError, finite } from './validation.ts';
export interface RoutePath {
  edgeIds: string[];
  coordinates: Point[];
  distanceM: number;
  durationMinutes: number;
  maxDepthCm: number;
}
export interface RouteResult {
  status: 'ok' | 'no_route' | 'insufficient_data';
  reason: string;
  safer: RoutePath | null;
  baseline: RoutePath | null;
  excludedEdges: string[];
  scenarioId: string;
  dataMode: string;
  validUntil: string;
  thresholdCm: number;
  departureMinute: number;
  policy: string;
}
export function routeForecast(
  f: Forecast,
  from: string | Point,
  to: string | Point,
  departureMinute: number,
  mode: 'commuter' | 'transit' | 'emergency' = 'commuter',
): RouteResult {
  finite(departureMinute, 'departureMinute', 0, 180);
  if (!['commuter', 'transit', 'emergency'].includes(mode))
    throw new InputError('Invalid travel mode');
  const nodes = f.dataset.roadNodes,
    edges = f.dataset.roads,
    thresholdCm = { commuter: 15, transit: 10, emergency: 20 }[mode],
    speed = { commuter: 25, transit: 20, emergency: 30 }[mode];
  const snap = (p: string | Point) => {
    if (typeof p === 'string') {
      if (!nodes.some((n) => n.id === p))
        throw new InputError(`Unknown road node: ${p}`);
      return p;
    }
    if (!Array.isArray(p) || p.length !== 2)
      throw new InputError(
        'Endpoint must be a node ID or [longitude,latitude]',
      );
    finite(p[0], 'longitude', -180, 180);
    finite(p[1], 'latitude', -80, 80);
    let best = '',
      distance = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(
        (n.coordinate[0] - p[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180),
        (n.coordinate[1] - p[1]) * 111320,
      );
      if (d < distance) {
        distance = d;
        best = n.id;
      }
    }
    if (distance > 250)
      throw new InputError(
        'Endpoint is outside coverage or more than 250 m from a modeled junction',
        422,
      );
    return best;
  };
  const start = snap(from),
    end = snap(to),
    windowEnd = Math.min(180, departureMinute + 30),
    depths: Record<string, number> = {};
  const requiredMinutes: number[] = [];
  for (
    let m = 15 * (Math.floor(departureMinute / 15) + 1);
    m <= 15 * Math.ceil(windowEnd / 15);
    m += 15
  )
    requiredMinutes.push(m);
  const requiredFrames = requiredMinutes.map((m) =>
    f.frames.find((frame) => frame.minute === m),
  );
  let missingCoverage = requiredFrames.some((frame) => !frame);
  for (const edge of edges) {
    let peak = 0;
    for (const frame of requiredFrames) {
      const d = frame?.streetIntervalMaxCm[edge.id];
      if (d === undefined || !Number.isFinite(d)) {
        peak = Infinity;
        missingCoverage = true;
        break;
      }
      peak = Math.max(peak, d);
    }
    depths[edge.id] = peak;
  }
  const excluded = edges
      .filter(
        (e) =>
          e.closed ||
          depths[e.id] >= thresholdCm ||
          !Number.isFinite(depths[e.id]),
      )
      .map((e) => e.id),
    blocked = new Set(excluded);
  const solve = (avoid: boolean, penalize = true): RoutePath | null => {
    const distance = new Map<string, number>([[start, 0]]),
      previous = new Map<string, { node: string; edge: RoadEdge }>(),
      visited = new Set<string>();
    while (true) {
      let current: string | undefined,
        cost = Infinity;
      for (const [n, d] of distance)
        if (!visited.has(n) && d < cost) {
          current = n;
          cost = d;
        }
      if (!current) break;
      if (current === end) break;
      visited.add(current);
      for (const edge of edges) {
        if (edge.closed || (avoid && blocked.has(edge.id))) continue;
        let next: string | undefined;
        if (edge.from === current) next = edge.to;
        else if (edge.to === current && !edge.oneWay) next = edge.from;
        if (!next) continue;
        const risk =
            avoid && penalize
              ? 1 + (Math.max(0, depths[edge.id]) / thresholdCm) * 0.7
              : 1,
          candidate = cost + edge.lengthM * risk;
        if (candidate < (distance.get(next) ?? Infinity)) {
          distance.set(next, candidate);
          previous.set(next, { node: current, edge });
        }
      }
    }
    if (!distance.has(end)) return null;
    const path: { edge: RoadEdge; reverse: boolean }[] = [];
    let cursor = end;
    while (cursor !== start) {
      const p = previous.get(cursor);
      if (!p) return null;
      path.unshift({ edge: p.edge, reverse: p.edge.from !== p.node });
      cursor = p.node;
    }
    const coordinates: Point[] = [],
      edgeIds: string[] = [];
    let length = 0,
      maxDepth = 0;
    for (const { edge, reverse } of path) {
      const coords = reverse
        ? [...edge.coordinates].reverse()
        : edge.coordinates;
      coordinates.push(...(coordinates.length ? coords.slice(1) : coords));
      edgeIds.push(edge.id);
      length += edge.lengthM;
      maxDepth = Math.max(maxDepth, depths[edge.id]);
    }
    if (!coordinates.length) {
      const c = nodes.find((n) => n.id === start)!.coordinate;
      coordinates.push(c, c);
    }
    return {
      edgeIds,
      coordinates,
      distanceM: length,
      durationMinutes: length / ((speed * 1000) / 60),
      maxDepthCm: Number.isFinite(maxDepth) ? maxDepth : -1,
    };
  };
  const baseline = solve(false);
  let candidate = solve(true);
  const budget = Math.min(30, 180 - departureMinute);
  if (candidate && candidate.durationMinutes > budget)
    candidate = solve(true, false);
  const duration = candidate?.durationMinutes ?? baseline?.durationMinutes ?? 0;
  const insufficient =
    missingCoverage ||
    departureMinute >= 180 ||
    duration > 30 ||
    departureMinute + duration > 180 ||
    ((f.dataMode === 'live' || f.dataMode === 'weather_model') &&
      Date.now() > Date.parse(f.validUntil));
  const status = insufficient
    ? 'insufficient_data'
    : candidate
      ? 'ok'
      : 'no_route';
  return {
    status,
    reason:
      status === 'ok'
        ? 'Lower modeled flood exposure. Illustrative network; this is not a navigation safety guarantee.'
        : status === 'no_route'
          ? 'No route meets the selected flood-depth policy. Do not substitute the flooded baseline.'
          : 'Forecast intervals are missing, stale, or do not cover the trip within the supported 30-minute travel window.',
    safer: status === 'ok' ? candidate : null,
    baseline,
    excludedEdges: excluded,
    scenarioId: f.id,
    dataMode: f.dataMode,
    validUntil: f.validUntil,
    thresholdCm,
    departureMinute,
    policy:
      'Hard exclusions at depth threshold; risk penalty below threshold; maximum interval depths across next 30 minutes. Thresholds are unvalidated demo policies.',
  };
}

import { makeDataset, makeRainCube } from './fixtures.ts';
import { simulate } from './engine.ts';
import type { Forecast, Scenario } from './types.ts';
const cache = new Map<string, { time: number; forecast: Forecast }>();
export function getForecast(scenario: Scenario): Forecast {
  const key = JSON.stringify(scenario),
    hit = cache.get(key);
  if (hit && Date.now() - hit.time < 300000) return hit.forecast;
  const dataset = makeDataset(scenario.city),
    forecast = simulate(dataset, makeRainCube(dataset, scenario), scenario);
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, { time: Date.now(), forecast });
  return forecast;
}

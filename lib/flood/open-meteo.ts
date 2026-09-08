import type { Dataset, Forecast, RainCube, Scenario } from './types.ts';
import { cellCoordinate } from './types.ts';
import { makeDataset } from './fixtures.ts';
import { simulate } from './engine.ts';
import { InputError, readBody, validateRain } from './validation.ts';
const STEP_SECONDS = 900;
const CACHE_MS = 5 * 60000;
const cache = new Map<string, { at: number; forecast: Forecast }>();
const pending = new Map<string, Promise<Forecast>>();

export function openMeteoURL(dataset: Dataset): string {
  const grid = dataset.grid;
  const center = cellCoordinate(
    grid,
    Math.floor(grid.height / 2) * grid.width + Math.floor(grid.width / 2),
  );
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: center[1].toFixed(5),
    longitude: center[0].toFixed(5),
    minutely_15: 'precipitation',
    forecast_minutely_15: '16',
    timeformat: 'unixtime',
    timezone: 'GMT',
    precipitation_unit: 'mm',
  }).toString();
  return url.toString();
}

/** Open-Meteo stamps accumulation at the END of the preceding 15-minute interval. */
export function normalizeOpenMeteo(
  payload: unknown,
  dataset: Dataset,
  retrievedAt: Date,
  sourceUrl = openMeteoURL(dataset),
): RainCube {
  const fail = (detail: string): never => {
    throw new InputError(`Open-Meteo: ${detail}`, 502);
  };
  if (!payload || typeof payload !== 'object') return fail('invalid response');
  const data = payload as Record<string, unknown>;
  if (data.error) return fail('the provider rejected the forecast request');
  const latitude = data.latitude,
    longitude = data.longitude;
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    return fail('invalid weather grid coordinates');
  const units = data.minutely_15_units as Record<string, unknown> | undefined;
  if (units?.precipitation !== 'mm' || units?.time !== 'unixtime')
    return fail('expected millimetres and Unix timestamps');
  const values = data.minutely_15 as
    | { time?: unknown; precipitation?: unknown }
    | undefined;
  if (
    !Array.isArray(values?.time) ||
    !Array.isArray(values?.precipitation) ||
    values.time.length !== values.precipitation.length ||
    values.time.length > 500
  )
    return fail('missing or mismatched forecast arrays');
  const samples = new Map<number, number | null>();
  let previous = -Infinity;
  for (let i = 0; i < values.time.length; i++) {
    const t = values.time[i],
      amount = values.precipitation[i];
    if (
      typeof t !== 'number' ||
      !Number.isInteger(t) ||
      t <= previous ||
      t % STEP_SECONDS !== 0
    )
      return fail('timestamps must be increasing UTC quarter-hours');
    if (
      amount !== null &&
      (typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 125)
    )
      return fail('invalid rainfall accumulation');
    samples.set(t, amount);
    previous = t;
  }
  const start =
    Math.floor(retrievedAt.getTime() / 1000 / STEP_SECONDS) * STEP_SECONDS;
  const frames: number[][] = [];
  for (let i = 0; i < 13; i++) {
    // Cube frame i is the RATE during [start+i*900, start+(i+1)*900).
    const amount = samples.get(start + (i + 1) * STEP_SECONDS);
    if (amount === null || amount === undefined)
      return fail(
        'incomplete or stale coverage for the next three hours; no synthetic fallback was used',
      );
    frames.push(
      Array(dataset.grid.width * dataset.grid.height).fill(amount * 4),
    );
  }
  const rainfall: RainCube = {
    issuedAt: new Date(start * 1000).toISOString(),
    observedThrough: null,
    source:
      'Open-Meteo weather-model precipitation; hourly data interpolated to 15 minutes in India; one forecast point applied uniformly to the synthetic catchment.',
    mode: 'weather_model',
    unit: 'mm/h',
    width: dataset.grid.width,
    height: dataset.grid.height,
    stepMinutes: 15,
    frames,
    provenance: {
      requestedPoint: [
        Number(new URL(sourceUrl).searchParams.get('longitude')),
        Number(new URL(sourceUrl).searchParams.get('latitude')),
      ],
      weatherGridPoint: [longitude, latitude],
      provider: 'Open-Meteo',
      product: 'Forecast API · best_match · minutely_15 precipitation',
      sourceUrl,
      retrievedAt: retrievedAt.toISOString(),
      modelRunTime: null,
      observationTime: null,
      temporalMethod:
        'Hourly weather-model output interpolated to 15 minutes in India. Interval-end accumulation in mm multiplied by 4 to obtain mm/h. Forecast zero time is the current UTC quarter-hour, not model initialization.',
      spatialMethod:
        'One weather-model grid point selected near the catchment centre, applied uniformly to all hydrology cells. No street-scale rainfall detail is inferred.',
      attribution:
        'Weather data by Open-Meteo.com · CC BY 4.0. Free hosted API for non-commercial use within its rate limits.',
    },
  };
  return validateRain(rainfall, dataset);
}

export async function getOpenMeteoForecast(
  scenario: Scenario,
): Promise<Forecast> {
  const now = Date.now();
  const slot = Math.floor(now / (STEP_SECONDS * 1000));
  // A new quarter-hour must not reuse the previous forecast origin.
  const key = `${scenario.city}:${scenario.blockage}:${scenario.tailwaterM}:${slot}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_MS) return cached.forecast;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  if (pending.size >= 6)
    throw new InputError(
      'Weather forecast requests are busy. Please retry shortly.',
      503,
    );
  const run = (async () => {
    const dataset = makeDataset(scenario.city),
      url = openMeteoURL(dataset);
    let response: Response;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 15000);
    try {
      response = await fetch(url, { signal: ac.signal });
    } catch (fetchErr) {
      const detail =
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      throw new InputError(
        `Open-Meteo could not be reached (${detail}). Retry, or select the synthetic demo explicitly.`,
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok)
      throw new InputError(
        response.status === 429
          ? 'Open-Meteo rate limit reached. Try again in a few minutes.'
          : 'Open-Meteo is temporarily unavailable.',
        response.status === 429 ? 503 : 502,
      );
    const rainfall = normalizeOpenMeteo(
      await readBody(response),
      dataset,
      new Date(),
    );
    const actualScenario = {
      ...scenario,
      rainfallMmHr: Math.max(
        ...rainfall.frames.map((frame) => frame[0] as number),
      ),
    };
    const forecast = simulate(dataset, rainfall, actualScenario);
    forecast.id = `open-meteo-${scenario.city}-${rainfall.issuedAt}-${scenario.blockage}-${scenario.tailwaterM}`;
    forecast.warnings.push(
      'Real weather-model rainfall with synthetic terrain, streets and drains. This is not a radar nowcast or a calibrated street flood warning.',
      rainfall.provenance!.spatialMethod,
    );
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), forecast });
    return forecast;
  })();
  pending.set(key, run);
  try {
    return await run;
  } finally {
    pending.delete(key);
  }
}

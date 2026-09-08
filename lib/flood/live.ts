import { simulate } from './engine.ts';
import {
  InputError,
  readBody,
  validateDataset,
  validateRain,
  validateScenario,
} from './validation.ts';
import type { Forecast } from './types.ts';
let cached: { time: number; url: string; forecast: Forecast } | null = null;
/** Operator-configured HTTPS input only. No user-supplied fetch URLs. */
export async function getLiveForecast(): Promise<Forecast> {
  const url = process.env.FLOOD_INPUT_URL;
  if (!url)
    throw new InputError(
      'Live feed is not configured. Set FLOOD_INPUT_URL to your authorized normalized rainfall and catchment feed.',
      503,
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InputError('Configured feed URL is invalid', 503);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new InputError(
      'The configured feed requires HTTPS and no credentials in its URL',
      503,
    );
  if (cached && cached.url === url && Date.now() - cached.time < 45000)
    return cached.forecast;
  const token = process.env.FLOOD_INPUT_TOKEN;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new InputError('The configured live feed could not be reached', 502);
  }
  if (!response.ok)
    throw new InputError('The configured live feed returned an error', 502);
  const input = await readBody(response),
    dataset = validateDataset(input.dataset),
    scenario = validateScenario(input.scenario ?? { city: dataset.city }),
    rain = validateRain(input.rainfall, dataset);
  if (rain.mode !== 'live')
    throw new InputError(
      'Live feed requires rainfall.mode="live" and current observations',
      422,
    );
  const forecast = simulate(dataset, rain, scenario);
  cached = { time: Date.now(), url, forecast };
  return forecast;
}

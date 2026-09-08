import { getLiveForecast } from '@/lib/flood/live';
import { simulate } from '@/lib/flood/engine';
import { makeRainCube } from '@/lib/flood/fixtures';
import { validateDataset, validateRain } from '@/lib/flood/validation';
import { getForecast } from '@/lib/flood/service';
import { routeForecast } from '@/lib/flood/routing';
import {
  errorResponse,
  readBody,
  validateScenario,
  InputError,
} from '@/lib/flood/validation';
import type { Point } from '@/lib/flood/types';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (body.from === undefined || body.to === undefined)
      throw new InputError('from and to are required');
    const scenario = validateScenario(body.scenario ?? {});
    const dataset = body.dataset ? validateDataset(body.dataset) : null;
    const forecast =
      body.source === 'live'
        ? await getLiveForecast()
        : dataset
          ? simulate(
              dataset,
              body.rainfall
                ? validateRain(body.rainfall, dataset)
                : makeRainCube(dataset, scenario),
              scenario,
            )
          : getForecast(scenario);
    const result = routeForecast(
      forecast,
      body.from as string | Point,
      body.to as string | Point,
      (body.departureMinute as number) ?? 0,
      (body.mode as 'commuter') ?? 'commuter',
    );
    return Response.json(
      {
        ...result,
        geometry: result.safer
          ? { type: 'LineString', coordinates: result.safer.coordinates }
          : null,
      },
      { headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

import { simulate } from '@/lib/flood/engine';
import { makeDataset, makeRainCube } from '@/lib/flood/fixtures';
import {
  errorResponse,
  readBody,
  validateScenario,
  validateDataset,
  validateRain,
} from '@/lib/flood/validation';
export async function POST(request: Request) {
  try {
    const body = await readBody(request),
      scenario = validateScenario(body.scenario ?? {}),
      dataset = body.dataset
        ? validateDataset(body.dataset)
        : makeDataset(scenario.city),
      rain = body.rainfall
        ? validateRain(body.rainfall, dataset)
        : makeRainCube(dataset, scenario);
    return Response.json(simulate(dataset, rain, scenario));
  } catch (e) {
    return errorResponse(e);
  }
}

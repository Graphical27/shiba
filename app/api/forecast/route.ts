import { getForecast } from '@/lib/flood/service';
import { scenarioFromURL, errorResponse } from '@/lib/flood/validation';
export async function GET(request: Request) {
  try {
    return Response.json(getForecast(scenarioFromURL(request)), {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

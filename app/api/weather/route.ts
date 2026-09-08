import { getOpenMeteoForecast } from '@/lib/flood/open-meteo';
import { errorResponse, scenarioFromURL } from '@/lib/flood/validation';
export async function GET(request: Request) {
  try {
    return Response.json(await getOpenMeteoForecast(scenarioFromURL(request)), {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getLiveForecast } from '@/lib/flood/live';
import { errorResponse } from '@/lib/flood/validation';
export async function GET() {
  try {
    return Response.json(await getLiveForecast(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

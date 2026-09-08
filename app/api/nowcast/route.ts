import { advectRain } from '@/lib/flood/nowcast';
import { readBody, errorResponse } from '@/lib/flood/validation';
export async function POST(request: Request) {
  try {
    return Response.json(advectRain(await readBody(request)));
  } catch (e) {
    return errorResponse(e);
  }
}

import { MODEL_VERSION } from '@/lib/flood/types';
export function GET() {
  return Response.json({
    status: 'ok',
    modelVersion: MODEL_VERSION,
    mode: 'synthetic',
    calibrated: false,
    liveFeedConfigured: !!process.env.FLOOD_INPUT_URL,
    adapters: {
      imdDwr: 'unconfigured: numeric authorized feed required',
      pysteps: 'external adapter: normalized rainfall cube accepted',
      imerg: 'unconfigured: delayed regional context only',
      dem: 'normalized surveyed grid accepted by /api/simulate',
    },
  });
}

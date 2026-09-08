export function GET() {
  return Response.json({
    openapi: '3.1.0',
    info: {
      title: 'Varsha Urban Flood API',
      version: '0.1.0',
      description:
        'Research prototype with Open-Meteo weather-model rainfall and synthetic catchments. Depths and route thresholds are unvalidated.',
    },
    paths: {
      '/api/weather': {
        get: {
          summary:
            'Open-Meteo rainfall coupled with the selected synthetic catchment; no API key',
          parameters: [
            {
              name: 'city',
              in: 'query',
              schema: { type: 'string', enum: ['mumbai', 'delhi', 'chennai'] },
            },
            {
              name: 'blockage',
              in: 'query',
              schema: { type: 'number', minimum: 0, maximum: 1 },
            },
            {
              name: 'tailwaterM',
              in: 'query',
              schema: { type: 'number', minimum: 0, maximum: 4 },
            },
          ],
          responses: {
            '200': {
              description:
                'Forecast with dataMode weather_model and rainfall provenance',
            },
            '400': { description: 'Invalid parameters' },
            '502': {
              description:
                'Weather provider unavailable or incomplete coverage',
            },
            '503': { description: 'Provider quota exceeded or requests busy' },
          },
        },
      },
      '/api/live': {
        get: {
          summary: 'Configured live input feed and coupled forecast',
          responses: {
            '200': { description: 'Validated forecast' },
            '422': { description: 'Stale or missing rainfall' },
            '503': { description: 'Feed not configured' },
            '502': { description: 'Feed unreachable' },
          },
        },
      },
      '/api/health': {
        get: {
          summary: 'Health and adapter status',
          responses: { '200': { description: 'OK' } },
        },
      },
      '/api/forecast': {
        get: {
          summary: '13 coupled flood frames from 0 to 180 minutes',
          parameters: [
            {
              name: 'city',
              in: 'query',
              schema: { type: 'string', enum: ['mumbai', 'delhi', 'chennai'] },
            },
            {
              name: 'rainfallMmHr',
              in: 'query',
              schema: { type: 'number', minimum: 0, maximum: 200, default: 80 },
            },
            {
              name: 'blockage',
              in: 'query',
              schema: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
            },
            {
              name: 'tailwaterM',
              in: 'query',
              schema: { type: 'number', minimum: 0, maximum: 4, default: 0 },
            },
          ],
          responses: {
            '200': { description: 'Dataset, frames, massBalance, provenance' },
            '400': { description: 'Invalid scenario' },
          },
        },
      },
      '/api/route': {
        post: {
          summary: 'Compare baseline and flood-aware routes',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['from', 'to'],
                  properties: {
                    source: {
                      type: 'string',
                      enum: ['live', 'open-meteo'],
                      description:
                        'Use the configured live feed or free Open-Meteo weather-model rainfall',
                    },
                    dataset: {
                      type: 'object',
                      description: 'Optional normalized custom catchment',
                    },
                    rainfall: {
                      type: 'object',
                      description: 'Optional normalized rainfall cube',
                    },
                    from: {
                      oneOf: [
                        { type: 'string' },
                        {
                          type: 'array',
                          items: { type: 'number' },
                          minItems: 2,
                          maxItems: 2,
                        },
                      ],
                    },
                    to: {
                      oneOf: [
                        { type: 'string' },
                        {
                          type: 'array',
                          items: { type: 'number' },
                          minItems: 2,
                          maxItems: 2,
                        },
                      ],
                    },
                    departureMinute: {
                      type: 'number',
                      minimum: 0,
                      maximum: 180,
                    },
                    mode: {
                      type: 'string',
                      enum: ['commuter', 'transit', 'emergency'],
                    },
                    scenario: { $ref: '#/components/schemas/Scenario' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                'status ok/no_route/insufficient_data; safer is null unless ok; GeoJSON geometry',
            },
            '400': { description: 'Invalid request' },
            '422': { description: 'Endpoint outside coverage' },
          },
        },
      },
      '/api/simulate': {
        post: {
          summary: 'Couple normalized rainfall and terrain/drain/road dataset',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scenario: { $ref: '#/components/schemas/Scenario' },
                    dataset: {
                      type: 'object',
                      description: 'See docs/DATA_CONTRACT.md',
                    },
                    rainfall: {
                      type: 'object',
                      description: 'See docs/DATA_CONTRACT.md',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Coupled forecast' },
            '400': { description: 'Invalid input' },
            '422': { description: 'Missing or stale rainfall coverage' },
            '413': { description: 'Body exceeds 2 MB' },
          },
        },
      },
      '/api/nowcast': {
        post: {
          summary:
            'Translate three rain-rate observations into a semi-Lagrangian rainfall cube',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'width',
                    'height',
                    'observations',
                    'observationStepMinutes',
                    'observedThrough',
                  ],
                  properties: {
                    width: { type: 'integer', minimum: 4, maximum: 64 },
                    height: { type: 'integer', minimum: 4, maximum: 64 },
                    observations: {
                      type: 'array',
                      minItems: 3,
                      maxItems: 3,
                      items: {
                        type: 'array',
                        items: { type: 'number', minimum: 0, maximum: 500 },
                      },
                    },
                    observationStepMinutes: {
                      type: 'number',
                      minimum: 1,
                      maximum: 30,
                    },
                    observedThrough: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                '13 rainfall frames, null at unknown advected boundaries',
            },
            '400': { description: 'Invalid observations' },
          },
        },
      },
    },
    components: {
      schemas: {
        Scenario: {
          type: 'object',
          properties: {
            city: { type: 'string', enum: ['mumbai', 'delhi', 'chennai'] },
            rainfallMmHr: { type: 'number', minimum: 0, maximum: 200 },
            blockage: { type: 'number', minimum: 0, maximum: 1 },
            tailwaterM: { type: 'number', minimum: 0, maximum: 4 },
          },
        },
      },
    },
  });
}

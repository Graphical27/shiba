import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenMeteo, openMeteoURL } from '../lib/flood/open-meteo.ts';
import { makeDataset } from '../lib/flood/fixtures.ts';
import { simulate } from '../lib/flood/engine.ts';
import { validateRain } from '../lib/flood/validation.ts';
const dataset = makeDataset('mumbai');
const zero = Date.parse('2026-09-08T14:00:00Z') / 1000;
function response() {
  return {
    latitude: 19.0158,
    longitude: 72.8698,
    generationtime_ms: 0.12,
    minutely_15_units: { time: 'unixtime', precipitation: 'mm' },
    minutely_15: {
      time: Array.from({ length: 16 }, (_, i) => zero + i * 900),
      precipitation: Array.from({ length: 16 }, (_, i) => i / 10) as (
        | number
        | null
      )[],
    },
  };
}
test('Open-Meteo conversion uses interval-end accumulation × 4, including final displayed rate', () => {
  const rain = normalizeOpenMeteo(
    response(),
    dataset,
    new Date('2026-09-08T14:06:00Z'),
  );
  assert.equal(rain.issuedAt, '2026-09-08T14:00:00.000Z');
  assert.equal(rain.frames.length, 13);
  assert.equal(rain.frames[0][0], 0.4);
  assert.equal(rain.frames[12][0], 5.2);
  assert.ok(rain.frames[5].every((v) => v === 2.4));
});
test('Weather-model provenance never invents observed or model-initialization timestamps', () => {
  const rain = normalizeOpenMeteo(
    response(),
    dataset,
    new Date('2026-09-08T14:06:00Z'),
  );
  assert.equal(rain.mode, 'weather_model');
  assert.equal(rain.observedThrough, null);
  assert.equal(rain.provenance?.modelRunTime, null);
  assert.equal(rain.provenance?.observationTime, null);
  assert.equal(rain.provenance?.retrievedAt, '2026-09-08T14:06:00.000Z');
  assert.deepEqual(rain.provenance?.weatherGridPoint, [72.8698, 19.0158]);
  const forecast = simulate(dataset, rain, {
    city: 'mumbai',
    rainfallMmHr: 5.2,
    blockage: 0.3,
    tailwaterM: 0,
  });
  assert.equal(forecast.dataMode, 'weather_model');
  assert.equal(forecast.forcing?.provider, 'Open-Meteo');
  assert.ok(forecast.massBalance.relativeError < 1e-9);
});
test('Quarter-hour request crossings use timestamps rather than fixed array offsets', () => {
  const rain = normalizeOpenMeteo(
    response(),
    dataset,
    new Date('2026-09-08T14:15:01Z'),
  );
  assert.equal(rain.issuedAt, '2026-09-08T14:15:00.000Z');
  assert.equal(rain.frames[0][0], 0.8);
  assert.equal(rain.frames[12][0], 5.6);
});
test('Dry weather remains dry without synthetic amplification', () => {
  const data = response();
  data.minutely_15.precipitation.fill(0);
  const rain = normalizeOpenMeteo(data, dataset, new Date(zero * 1000));
  assert.ok(rain.frames.every((frame) => frame.every((v) => v === 0)));
});
test('Missing, null, nonfinite and negative weather values fail rather than becoming dry', () => {
  for (const value of [null, NaN, Infinity, -1]) {
    const data = response();
    data.minutely_15.precipitation[4] = value;
    assert.throws(() =>
      normalizeOpenMeteo(data, dataset, new Date(zero * 1000)),
    );
  }
  const gap = response();
  gap.minutely_15.time.splice(4, 1);
  gap.minutely_15.precipitation.splice(4, 1);
  assert.throws(
    () => normalizeOpenMeteo(gap, dataset, new Date(zero * 1000)),
    /incomplete or stale/,
  );
  assert.throws(
    () =>
      normalizeOpenMeteo(response(), dataset, new Date('2026-09-08T18:00:00Z')),
    /incomplete or stale/,
  );
});
test('Unit, ordering, coordinates and malformed responses are rejected', () => {
  const wrongUnit = response();
  wrongUnit.minutely_15_units.precipitation = 'inch';
  assert.throws(
    () => normalizeOpenMeteo(wrongUnit, dataset, new Date(zero * 1000)),
    /millimetres/,
  );
  const duplicate = response();
  duplicate.minutely_15.time[4] = duplicate.minutely_15.time[3];
  assert.throws(
    () => normalizeOpenMeteo(duplicate, dataset, new Date(zero * 1000)),
    /increasing/,
  );
  const coord = response();
  coord.latitude = NaN;
  assert.throws(
    () => normalizeOpenMeteo(coord, dataset, new Date(zero * 1000)),
    /coordinates/,
  );
  for (const body of [null, {}, { error: true }])
    assert.throws(() =>
      normalizeOpenMeteo(body, dataset, new Date(zero * 1000)),
    );
});
test('Every city uses its catchment location with no API key or global bounding box', () => {
  const urls = ['mumbai', 'delhi', 'chennai'].map(
    (city) => new URL(openMeteoURL(makeDataset(city as 'mumbai'))),
  );
  assert.equal(
    new Set(urls.map((url) => url.searchParams.get('latitude'))).size,
    3,
  );
  for (const url of urls) {
    assert.equal(url.origin, 'https://api.open-meteo.com');
    assert.equal(url.searchParams.get('forecast_minutely_15'), '16');
    assert.equal(url.searchParams.get('minutely_15'), 'precipitation');
    assert.equal(url.searchParams.get('apikey'), null);
    assert.equal(url.searchParams.get('bounding_box'), null);
  }
});
test('Weather-model import requires honest metadata without weakening live-observation checks', () => {
  const rain = normalizeOpenMeteo(response(), dataset, new Date(zero * 1000));
  rain.observedThrough = rain.issuedAt;
  assert.throws(() => validateRain(rain, dataset), /invent observation/);
  rain.observedThrough = null;
  rain.mode = 'live';
  assert.throws(() => validateRain(rain, dataset), /observedThrough/);
});

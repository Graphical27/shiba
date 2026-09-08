# Data contract

All JSON bodies are bounded to 2 MB before parsing. Custom simulations accept `{scenario, dataset, rainfall}`. Omit dataset for a city demo, and omit rainfall for a synthetic storm over the supplied grid. A live feed requires both dataset and rainfall. The complete TypeScript schema is `lib/flood/types.ts`; strict validation is in `lib/flood/validation.ts`.

## Dataset

```ts
{
  id: string, name: string, city: 'mumbai' | 'delhi' | 'chennai',
  mode: 'synthetic' | 'replay',
  provenance: string, // include survey date, horizontal/vertical datum and accuracy
  grid: {
    width: number, height: number, // integer 4..64
    cellSizeM: number,            // 5..500; local metric square cells
    origin: [longitude, latitude], // SOUTHWEST OUTER CORNER
    elevationM: number[],        // width*height; shared vertical datum with drains
    imperviousness: number[],    // width*height; fractions 0..1
    roughness: number[]          // Manning n, width*height, 0.008..0.5
  },
  drains: [{
    id: string, name: string, cell: number,
    invertM: number, rimM: number, // rim must match cell elevation
    storageAreaM2: number, inletAreaM2: number,
    outfall: boolean
  }],
  pipes: [{
    id: string, from: string, to: string, // valid drain IDs; nominal direction
    diameterM: number, lengthM: number, roughness: number,
    blockage: number // fraction 0..1 of assumed conductance loss
  }],
  roadNodes: [{ id: string, name: string, cell: number, coordinate: [lon,lat] }],
  roads: [{
    id: string, from: string, to: string, // road node IDs
    name: string, cells: number[],       // sample every crossed grid cell
    lengthM: number, coordinates: [lon,lat][],
    closed?: boolean, oneWay?: boolean
  }]
}
```

**Array orientation:** row-major, west-to-east within each row; rows go **south-to-north**. Index = y*width+x. GIS rasters commonly arrive north-to-south; reverse rows on ingestion. Coordinates refer to cell centers at `(x+.5,y+.5)`. Do not silently transpose or flip radar/DEM grids. Drain inverts, rims and DEM must share a vertical datum.

Grid resolution describes numerical cell size, not sensor precision. Upsampling a 30 m DEM cannot recreate street kerbs. The demo grid is 32×32 at 100 m, covering about 10.24 km², with 49 drainage nodes, 84 pipes and 84 road edges. Imported arrays may use finer resolution for a smaller domain. A large operational domain needs tiled/compiled solvers outside this bounded request model.

Road/drain IDs must be unique within each collection. Graph references, physical ranges, grid dimensions and finite values are checked. Road-to-grid alignment and actual survey correctness are input-provider responsibilities. Crossing roads must not be connected without a real junction. Bridge/underpass height treatment must be resolved before sampling flood depths.

## Rainfall cube

```ts
{
  issuedAt: string,          // ISO UTC, forecast zero time
  observedThrough: string,  // latest true observation; <= issuedAt
  source: string,            // numeric product, version and provenance
  mode: 'synthetic' | 'replay' | 'live',
  unit: 'mm/h',
  width: number, height: number, // exactly match terrain grid
  stepMinutes: 15,
  frames: (number | null)[][]  // 13 arrays, width*height each
}
```

Frames 0..11 provide piecewise-constant rainfall rate during [0,15), [15,30), ..., [165,180). Frame 12 is the displayed terminal rain-rate estimate. Arrays must already be reprojected/resampled to the terrain grid and the same south-to-north row order. The source field must retain native sensor resolution; resampling does not improve observational detail.

Rain values are 0..500 mm/h. `0` means dry; `null` means unknown. The coupled solver rejects null coverage with HTTP 422. Never replace missing cells with zero. A larger radar domain is needed to cover storm inflow beyond the hydrology catchment. Live feeds require observations within 20 minutes and reject future issue timestamps.

## Rainfall nowcast adapter

`POST /api/nowcast` accepts `{width,height,observations,observationStepMinutes,observedThrough}`. `observations` must contain exactly three equally spaced, oldest-first finite rain-rate arrays on the same grid. The method finds a global translation over ±3 cells per observation step and advects the latest field using bilinear interpolation. It assumes constant motion and no storm growth/decay; this is an explicit approximation, not pySTEPS STEPS.

The output uses replay mode. Advected values outside the observation domain stay null. Prepare a larger observation domain, nowcast it upstream, then crop and align all 13 frames to the smaller catchment before coupling. Alternatively provide a normalized forecast from a real pySTEPS adapter. Direct numeric IMD data needs an authorized importer; radar screenshots are not precipitation measurements.

## Routing custom or live datasets

`POST /api/route` can include `dataset` and `rainfall` using the same schema as `/api/simulate`. The server computes the hazard before routing. Set `source: 'live'` to route against the configured live feed. No client-provided arbitrary depth arrays are trusted by this endpoint. Without these fields it uses the demo scenario.

## API limits and failures

- Scenario rain peak 0..200 mm/h, conductance loss 0..1, tailwater 0..4 m above each outfall invert.
- An adaptive simulation work budget of 16 million cell/graph updates rejects overly expensive scenarios with HTTP 422; use an external model runner for larger domains.
- At most 64×64 cells and 1000 entries per graph collection; bodies at most 2 MB.
- Inputs are validated atomically. A failed dashboard import retains the previously loaded forecast and displays the error.
- HTTP 400 malformed inputs; 413 body too large; 422 missing, stale or out-of-coverage inputs; 502 configured feed unavailable; 503 live feed not configured.
- `no_route` and `insufficient_data` are valid route results with HTTP 200 and null `safer`/`geometry`.

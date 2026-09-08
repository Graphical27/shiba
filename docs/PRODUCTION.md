# Production integration and deployment

## Required city inputs

1. Authorized numeric DWR volume/rain-rate data with timestamps and quality masks. Implement the instrument-specific reader, reflectivity-to-rainfall conversion, attenuation/clutter correction and gauge correction outside the prototype.
2. Optional pySTEPS worker: regular equally spaced history, a motion field, projection metadata, and a 0–3 hour ensemble. Convert its numeric outputs to the normalized rainfall contract. Its ODIM importer applies only if the supplied instrument files actually follow that format.
3. Surveyed, hydrologically conditioned terrain, preferably bare earth, with kerbs, walls, underpasses, culverts and true outlets. Include verified horizontal and vertical datums and acquisition/accuracy metadata.
4. Drain asset survey: inlet opening, invert/rim levels, pipe shape/size/length, outfalls, pumps, flap gates, blockage history and tide/tailwater observations. OSM drain tags are insufficient for underground hydraulic capacity.
5. Road network with access/one-way/turn restrictions, bridge levels, underpasses and live closures. The built-in graph routing utility is an integration reference, not an OSRM/Valhalla import or municipal road database.
6. Observed water levels and flood extents for calibration and withheld-event validation. Evaluate depth bias, flood extent, lead-time skill, false alarms and route exposure; a low mass residual alone proves none of these.

## Source realities

- [IMD Radar Data Supply Portal](https://radarapi.imd.gov.in/dsp/frontend/contact) provides the access path for numeric radar supply. The public API documentation should not be treated as proof of an open quantitative radar endpoint.
- [pySTEPS IO documentation](https://pysteps.readthedocs.io/en/stable/pysteps_reference/io.html) describes supported formats; [STEPS forecast](https://pysteps.readthedocs.io/en/stable/generated/pysteps.nowcasts.steps.forecast.html) specifies history and motion inputs.
- [NASA IMERG](https://gpm.nasa.gov/data/imerg) provides half-hourly regional products at about 0.1°; Early latency is approximately four hours. Use delayed context/replay, not a live street-scale predictor. V07 HDF5 uses `Grid/precipitation`; verify product metadata and units. GIS translations may encode scaled interval accumulation instead of mm/h.
- [USGS SRTM](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-srtm-mission-summary) has roughly 30 m posting. [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) is a surface model. Neither should be represented as a surveyed kerb/inlet model.
- [OSM drain semantics](https://wiki.openstreetmap.org/wiki/Tag:waterway=drain) describe mapped channels, not a complete municipal pipe survey. Preserve attribution when importing [OpenStreetMap data](https://www.openstreetmap.org/copyright), and cache extracts rather than issuing Overpass queries per user route.

## Compute and deployment

`npm run build` emits a Worker fetch entrypoint and browser assets under `dist/`. The Sites manifest is `.openai/hosting.json`. The exact source and build can be privately deployed through Sites. For other Cloudflare accounts, use the generated Wrangler configuration and set the feed secrets in that environment. `npm start` runs the production Worker locally.

The coupled demo takes roughly a second of local CPU (hardware dependent). [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) distinguish Free HTTP CPU limits from paid compute. Production simulation should run on an appropriate CPU budget or dedicated worker/queue and publish cached frames; do not assume a free request budget supports the solver. Large 5 m city domains need spatial decomposition, compiled solvers and an external model runner. The in-memory cache is per isolate and is not a shared durable cache.

For shared operational deployment, add authentication, request quotas, durable forecast/run storage, instrument health monitoring, ingestion logs, observability, geospatial tiling and feed-replay jobs. Imported data is currently session-local. Keep the source in a private repository where required by survey licences. Never put bearer tokens in browser bundles.

## Model extensions

Replace the reduced pipe solver with a validated SWMM dynamic-wave or equivalent Saint-Venant implementation, including pumps, flap gates, detailed cross sections, losses and pressure dynamics. Validate terrain conditioning and couple on hydraulic heads with appropriate substeps.

An ML surrogate is not included. To add one responsibly, generate paired inputs/outputs from the validated physics model, split training/validation by independent storm events and geography, retain uncertainty and out-of-distribution checks, and compare mass balance and operational skill. Do not present an untrained model or arbitrary depth scaling as a trained accelerator.

## Verification scope

Automated tests cover conservation, analytic rainfall depth, nonnegativity, blocked pipes, tailwater surcharge, timestep sensitivity, optical-flow translation, missing observations, closed/one-way routes, interval peaks, missing forecast intervals and route-duration constraints. Type checking and HTTP endpoint smoke checks supplement these tests. These are software/numerical checks, not empirical flood accuracy validation.

The UI is responsive and uses accessible installed primitives. Browser interaction testing was not requested. Optional WebMCP APIs are feature-detected; no supported page-scoped WebMCP validation context was available during implementation, so that optional integration remains unverified.

# Numerical model and units

All internal states use metres, seconds, square metres and cubic metres. Rain rates enter as mm/h and are divided by 3,600,000. Centimetres are an output-only conversion. Surface cell volume is V=A h. Drain volume is stored separately, with a linear storage area that approximates manhole and connected pipe storage.

## Surface

The rectangular raster is a local metric grid. State is row-major with rows from **south to north** and columns west to east. Elevation is bare-earth terrain under the input contract. Grid-to-geographic coordinates use a local equirectangular approximation at the origin latitude; this is appropriate only for small catchments.

Each internal face retains unit-width discharge q (m²/s). For water-surface elevation eta=z+h, the wet face depth is max(0,max(etaA,etaB)-max(zA,zB)). A local-inertial update applies pressure-gradient forcing and semi-implicit Manning friction:

```
qNext = (q - g * hf * dt * (etaB-etaA) / dx)
        / (1 + g * n² * dt * abs(q) / hf^(7/3))
Q = qNext * dx
```

Dry faces have zero flow. Internal dt is at most 10 seconds, further restricted to 0.4 dx / sqrt(g hMax) and exact output boundaries. A head-equalization cap and central donor-volume limiter bound exchanges. The same actual transfer is subtracted from one cell and added to its neighbor. The limited discharge is carried into the next step. These regularizations make this a reduced-order research solver, not a benchmarked hydraulic engine.

Horton infiltration capacity is (3 + 17 exp(-t/3600)) mm/h on the pervious fraction and is capped by available water. Parameters are demonstration assumptions. Surface domain boundaries are closed; only configured drain outfalls discharge or admit boundary water.

## Drain graph and coupling

Nodes have invert, rim, storage area and inlet opening. Hydraulic head is invert + volume/storageArea. Circular-pipe partial wetted area and wetted perimeter determine hydraulic radius. Flow magnitude uses Manning conveyance times sqrt(abs(headDifference)/length). Flow can reverse relative to the directed graph. Nominal full-pipe capacity uses nonnegative invert slope.

Blockage multiplies conductance by (1-pipeBlockage)(1-scenarioBlockage). It does not change the geometry of the remaining opening. Junction-degree-aware equalization caps prevent the sum of multiple pipe exchanges from artificially overshooting the incident heads.

Surface/drain exchange uses the lower of a submerged-orifice discharge and a shallow weir discharge. An inlet only transfers water above its rim. The higher hydraulic head determines direction. Donor-volume and head-equalization limits keep the transfer conservative. Surcharge is actual drain-to-surface water volume per output interval, not an assumed flood penalty.

Outfalls use a fixed tailwater above the outfall invert. Positive drain-to-boundary head discharges; negative head adds boundary inflow. Both directions enter the mass ledger. Pipes omit inertial momentum, minor losses and detailed pressurization; use a calibrated SWMM dynamic-wave model for engineering-grade assessment.

## Output and routing

Frames are saved at exactly 0,15,...,180 minutes. The numerical timestep is never 15 minutes. Each frame contains snapshot cell depths plus maximum depths over the preceding output interval. A street is assigned the maximum depth of all cells sampled by the segment. The supplied road-to-cell mapping must cover its full geometry and must account for bridge/underpass elevations upstream.

Routing uses Dijkstra search with hard exclusions at example depth cutoffs (10/15/20 cm for transit/commuter/emergency) and a modest penalty below those cutoffs. It conservatively considers interval maxima over the next 30 minutes. Exact interval coverage is required. Unknown coverage returns insufficient_data. If the risk-weighted path exceeds the travel-time window, the solver attempts the shortest eligible path before rejecting the request. Neither path waits for water to recede. Speeds are fixed demo assumptions.

## Mass ledger

```
residual = rain + boundaryInflow - infiltration - outfall - finalStored
relativeError = abs(residual) / max(1, rain + boundaryInflow)
```

A small residual verifies bookkeeping, not physical accuracy. Tests include a flat impermeable analytic rainfall case, dry state, extreme blockage, tailwater surcharge, nonnegative volumes, timestep-halving sensitivity, missing-data failures and time-window route exclusions.

## Sources

- [EPA SWMM hydraulic reference](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P100S9AS.TXT): conduit, orifice and hydraulic routing concepts.
- [Local-inertial formulation in a peer-reviewed hydraulic application](https://iris.unime.it/retrieve/de3e52b3-f1e3-762d-e053-3705fe0a30e0/hyp.10749.pdf).
- [USACE diffusion-wave numerical considerations](https://www.hec.usace.army.mil/confluence/rasdocs/hecras/latest/technical-reference/hydraulic-equations/diffusion-wave-equation).

No empirical flood-depth accuracy, lead-time skill score or safety guarantee has been established.

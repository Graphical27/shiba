'use client';
import { useState } from 'react';
import {
  Upload,
  ArrowUpRight,
  CheckCircle2,
  Database,
  CloudRain,
  Mountain,
  Network,
  Route,
  Copy,
  Download,
} from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import type { Forecast, Frame } from '@/lib/flood/types';
import type { RouteResult } from '@/lib/flood/routing';
import { pipeCapacity } from '@/lib/flood/engine';
export function DrainageView({
  forecast,
  frame,
}: {
  forecast: Forecast;
  frame: Frame;
}) {
  const [filter, setFilter] = useState('all');
  const { dataset } = forecast;
  return (
    <section className="wide-card">
      <div className="section-bar">
        <div>
          <h2>Underground, connected.</h2>
          <p>
            {dataset.drains.length} inlets & outfalls · {dataset.pipes.length}{' '}
            directed pipes · arrows show nominal downstream direction
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => v && setFilter(v)}>
          <SelectTrigger aria-label="Filter drainage pipes">
            <SelectValue>
              {filter === 'all' ? 'All pipes' : 'Blocked pipes'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All pipes</SelectItem>
            <SelectItem value="blocked">Blocked pipes</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pipe / direction</TableHead>
              <TableHead>Diameter</TableHead>
              <TableHead>Reference capacity</TableHead>
              <TableHead>Current flow</TableHead>
              <TableHead>Conductance loss</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataset.pipes.map((p, i) => {
              const a = dataset.drains.find((n) => n.id === p.from)!,
                b = dataset.drains.find((n) => n.id === p.to)!,
                loss = 1 - (1 - p.blockage) * (1 - forecast.scenario.blockage),
                capacity = pipeCapacity(
                  p.diameterM,
                  p.roughness,
                  Math.max(0, (a.invertM - b.invertM) / p.lengthM),
                );
              if (filter === 'blocked' && loss <= 0) return null;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <strong>{p.id.toUpperCase()}</strong>
                    <small className="table-secondary">
                      {a.name} → {b.name}
                    </small>
                  </TableCell>
                  <TableCell>{(p.diameterM * 1000).toFixed(0)} mm</TableCell>
                  <TableCell>{capacity.toFixed(3)} m³/s</TableCell>
                  <TableCell>{frame.pipeFlowsM3s[i].toFixed(3)} m³/s</TableCell>
                  <TableCell>
                    <div className="loss-cell">
                      <span>{Math.round(loss * 100)}%</span>
                      <Progress
                        aria-label={`Conductance loss for ${p.id}`}
                        value={loss * 100}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        'status-chip ' +
                        (loss === 1
                          ? 'red-chip'
                          : frame.pipeFlowsM3s[i] < -0.0001
                            ? 'orange-chip'
                            : 'green-chip')
                      }
                    >
                      {loss === 1
                        ? 'Blocked'
                        : frame.pipeFlowsM3s[i] < -0.0001
                          ? 'Reverse flow'
                          : 'Connected'}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="card-note">
        Signed flow is relative to pipe direction. Reference capacity uses
        full-pipe Manning flow at invert slope; the head-driven model can
        reverse flow. Blockage is a conductance-loss assumption.
      </p>
    </section>
  );
}
export function RoutingPanel({
  forecast,
  result,
  onRoute,
  busy,
}: {
  forecast: Forecast;
  result: RouteResult | null;
  onRoute: (from: string, to: string, mode: string) => void;
  busy: boolean;
}) {
  const nodes = forecast.dataset.roadNodes;
  const [from, setFrom] = useState(nodes[0]?.id ?? ''),
    [to, setTo] = useState(nodes[nodes.length - 1]?.id ?? ''),
    [mode, setMode] = useState('commuter');
  const choices = (value: string, set: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={(v) => v && set(v)}>
      <SelectTrigger className="route-select" aria-label={label}>
        <SelectValue>
          {nodes.find((n) => n.id === value)?.name ?? 'Select junction'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem value={n.id} key={n.id}>
            {n.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <section className="route-form-card">
      <div className="section-title">
        <h2>Find a lower-risk route</h2>
        <Route size={19} />
      </div>
      <p className="muted">Uses the selected forecast time as departure.</p>
      <label>Origin junction</label>
      {choices(from, setFrom, 'Origin junction')}
      <label>Destination junction</label>
      {choices(to, setTo, 'Destination junction')}
      <label>Travel profile</label>
      <Select value={mode} onValueChange={(v) => v && setMode(v)}>
        <SelectTrigger className="route-select" aria-label="Travel profile">
          <SelectValue>
            {mode === 'commuter'
              ? 'Commuter'
              : mode === 'transit'
                ? 'Public transit'
                : 'Emergency vehicle'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="commuter">Commuter</SelectItem>
          <SelectItem value="transit">Public transit</SelectItem>
          <SelectItem value="emergency">Emergency vehicle</SelectItem>
        </SelectContent>
      </Select>
      <button
        className="primary-button route-submit"
        disabled={busy || !from || !to}
        onClick={() => onRoute(from, to, mode)}
      >
        {busy ? 'Calculating…' : 'Compare routes'}
        <ArrowUpRight size={16} />
      </button>
      {result && (
        <div className="route-results" aria-live="polite">
          <h3>
            {result.status === 'ok'
              ? 'Route comparison'
              : result.status === 'no_route'
                ? 'No eligible route'
                : 'Forecast coverage ends'}
          </h3>
          {result.baseline && (
            <div className="route-result">
              <span className="baseline-line" />
              <div>
                Shortest baseline
                <small>
                  {(result.baseline.distanceM / 1000).toFixed(1)} km ·{' '}
                  {Math.ceil(result.baseline.durationMinutes)} min ·{' '}
                  {result.baseline.maxDepthCm < 0
                    ? 'Unknown depth'
                    : `${result.baseline.maxDepthCm.toFixed(1)} cm peak`}
                </small>
              </div>
            </div>
          )}
          {result.safer && (
            <div className="route-result">
              <span className="safer-line" />
              <div>
                Lower flood exposure
                <small>
                  {(result.safer.distanceM / 1000).toFixed(1)} km ·{' '}
                  {Math.ceil(result.safer.durationMinutes)} min ·{' '}
                  {result.safer.maxDepthCm.toFixed(1)} cm peak
                </small>
              </div>
            </div>
          )}
          <p>
            {result.excludedEdges.length} segments excluded at ≥{' '}
            {result.thresholdCm} cm.
          </p>
          <p className="route-reason">{result.reason}</p>
        </div>
      )}
      <p className="card-note">
        Demo thresholds: transit 10 cm, commuter 15 cm, emergency 20 cm. These
        are unvalidated policy examples, not safe driving depths. No live road
        closures are available.
      </p>
    </section>
  );
}
const sources = [
  {
    icon: CloudRain,
    title: 'Doppler weather radar',
    type: 'Awaiting numeric feed',
    body: 'Import georeferenced rain-rate observations or a pySTEPS rainfall cube. No live IMD radar feed is connected.',
    url: 'https://radarapi.imd.gov.in/dsp/frontend/contact',
  },
  {
    icon: Mountain,
    title: 'Terrain & land cover',
    type: 'Synthetic · 100 m grid',
    body: 'Replace the demonstration elevation and imperviousness arrays with conditioned survey data. SRTM alone cannot resolve kerbs and inlets.',
    url: 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-srtm-mission-summary',
  },
  {
    icon: Network,
    title: 'Stormwater drainage',
    type: 'Assumed network',
    body: 'Directed pipes connect inlets and outfalls. Pipe size, inverts, roughness and blockage require municipal survey records.',
    url: 'https://www.epa.gov/water-research/storm-water-management-model-swmm',
  },
  {
    icon: Database,
    title: 'GPM IMERG',
    type: 'Delayed context · not connected',
    body: 'About 10 km and half-hourly; Early product latency is about 4 hours. Not a real-time street-scale rainfall forecast.',
    url: 'https://gpm.nasa.gov/data/imerg',
  },
];
export function DataView({
  forecast,
  onImport,
  importing,
  onLive,
}: {
  forecast: Forecast;
  onImport: (file: File) => void;
  importing: boolean;
  onLive: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const b = forecast.massBalance;
  const sample = {
    scenario: {
      city: 'mumbai',
      rainfallMmHr: 80,
      blockage: 0.3,
      tailwaterM: 0,
    },
    from: 'n0',
    to: 'n48',
    departureMinute: 60,
    mode: 'commuter',
  };
  return (
    <div className="data-view">
      <section className="wide-card model-overview">
        <div className="section-title">
          <h2>A coupled model, with visible assumptions.</h2>
          <span className="tag">{forecast.modelVersion}</span>
        </div>
        <p>
          Surface water and the drainage graph exchange water in both
          directions. All displayed depths come from the model. The
          demonstration is uncalibrated.
        </p>
        <div className="pipeline-flow">
          {[
            'Rainfall advection',
            '2D surface flow',
            '1D drain graph',
            'Street depths',
            'Flood-aware routing',
          ].map((text, i) => (
            <div key={text}>
              <span>0{i + 1}</span>
              <strong>{text}</strong>
              {i < 4 && <ArrowUpRight size={18} />}
            </div>
          ))}
        </div>
        <div className="model-metrics">
          <div>
            <span>3-hour run time</span>
            <strong>{forecast.runtimeMs.toFixed(0)} ms</strong>
          </div>
          <div>
            <span>Water-balance relative error</span>
            <strong>{(b.relativeError * 100).toExponential(2)}%</strong>
          </div>
          <div>
            <span>Forecast frames</span>
            <strong>13 × 15 min</strong>
          </div>
          <div>
            <span>Training / calibration</span>
            <strong>Not calibrated</strong>
          </div>
        </div>
      </section>
      <div className="source-grid">
        {sources.map(({ icon: Icon, ...s }) => (
          <section className="wide-card source-card" key={s.title}>
            <Icon size={24} />
            <span className="source-status">{s.type}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <a href={s.url} target="_blank" rel="noreferrer">
              Source documentation <ArrowUpRight size={14} />
            </a>
          </section>
        ))}
      </div>
      <div className="data-bottom">
        <section className="wide-card padded-card">
          <div className="section-title">
            <h2>Bring your own catchment</h2>
            <button className="text-button" onClick={onLive}>
              Load configured live feed ↗
            </button>
          </div>
          <p>
            Import a normalized JSON file with a <code>dataset</code>,{' '}
            <code>rainfall</code> and <code>scenario</code>. Missing rain
            coverage is rejected. Maximum 2 MB.
          </p>
          <label className="upload-button">
            <Upload size={16} />
            {importing ? 'Validating & simulating…' : 'Import simulation JSON'}
            <input
              type="file"
              accept="application/json,.json"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="text-button"
            onClick={() =>
              downloadJson(
                { dataset: forecast.dataset, scenario: forecast.scenario },
                `${forecast.dataset.city}-dataset-template.json`,
              )
            }
          >
            <Download size={14} /> Download dataset template
          </button>
          <p className="card-note">
            Omit rainfall to run a synthetic storm on your terrain. Full input
            specification is included in the project documentation.
          </p>
        </section>
        <section className="wide-card padded-card">
          <div className="section-title">
            <h2>Routing API</h2>
            <a href="/api/openapi" target="_blank" rel="noreferrer">
              API specification ↗
            </a>
          </div>
          <p>
            POST <code>/api/route</code> · JSON request · GeoJSON route response
          </p>
          <pre>{JSON.stringify(sample, null, 2)}</pre>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(sample, null, 2),
                );
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={14} />
            {copied ? 'Copied request' : 'Copy request'}
          </button>
        </section>
      </div>
      <section className="wide-card padded-card">
        <h2>Water balance · full 3-hour simulation</h2>
        <div className="balance-grid">
          {[
            ['Rainfall', b.rainfallM3],
            ['Boundary inflow', b.boundaryInflowM3],
            ['Infiltration', b.infiltrationM3],
            ['Outfall discharge', b.outfallM3],
            ['Stored water', b.storedM3],
            ['Residual', b.residualM3],
          ].map(([label, v]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <strong>
                {Number(v).toLocaleString(undefined, {
                  maximumFractionDigits: 3,
                })}{' '}
                m³
              </strong>
            </div>
          ))}
        </div>
        <p className="card-note">
          Reduced-order local-inertial surface flow with volume limiters;
          head-driven Manning drainage; Horton infiltration; orifice/weir
          exchange. No trained ML surrogate. Survey calibration and a full
          dynamic-wave benchmark remain necessary.
        </p>
      </section>
    </div>
  );
}
export function downloadJson(value: unknown, name: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

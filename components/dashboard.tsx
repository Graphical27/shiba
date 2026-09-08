'use client';
import { useState, useEffect, useRef } from 'react';
import {
  Waves,
  LayoutDashboard,
  Network,
  Route,
  Database,
  ArrowUpRight,
  CloudRain,
  MapPin,
  Radio,
  Play,
  Pause,
  Clock,
  ChevronRight,
  Download,
  ShieldCheck,
  Activity,
  SlidersHorizontal,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import FloodMap from '@/components/flood-map';
import {
  DrainageView,
  RoutingPanel,
  DataView,
  downloadJson,
} from '@/components/workspace-views';
import type { CityId, Forecast, Scenario } from '@/lib/flood/types';
import { CITY_INFO } from '@/lib/flood/fixtures';
import type { RouteResult } from '@/lib/flood/routing';
import { routeForecast } from '@/lib/flood/routing';
const nav: [LucideIcon, string, string][] = [
  [LayoutDashboard, 'Overview', 'overview'],
  [Network, 'Drainage network', 'drainage'],
  [Route, 'Safe routing', 'routing'],
  [Database, 'Data & model', 'data'],
];
const initial: Scenario = {
  city: 'mumbai',
  rainfallMmHr: 80,
  blockage: 0.3,
  tailwaterM: 0,
};
export default function Dashboard() {
  const [scenario, setScenario] = useState<Scenario>(initial),
    [draft, setDraft] = useState(initial),
    [minute, setMinute] = useState(60),
    [view, setView] = useState('overview'),
    [drains, setDrains] = useState(false),
    [layer, setLayer] = useState('flood'),
    [playing, setPlaying] = useState(false),
    [autoRefresh, setAutoRefresh] = useState(false),
    [refresh, setRefresh] = useState(0),
    [forecast, setForecast] = useState<Forecast | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [route, setRoute] = useState<RouteResult | null>(null),
    [routeBusy, setRouteBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [importing, setImporting] = useState(false),
    [custom, setCustom] = useState(false),
    [live, setLive] = useState(false);
  const requestId = useRef(0),
    state = useRef({ forecast, minute });
  state.current = { forecast, minute };
  useEffect(() => {
    const id = ++requestId.current,
      controller = new AbortController();
    setLoading(true);
    setError('');
    setRoute(null);
    setSelected(null);
    setCustom(false);
    const query = new URLSearchParams(
      Object.entries(scenario).map(([k, v]) => [k, String(v)]),
    );
    fetch(live ? '/api/live' : `/api/forecast?${query}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = (await r.json()) as Forecast & { error?: string };
        if (!r.ok) throw new Error(body.error ?? 'Forecast unavailable');
        return body as Forecast;
      })
      .then((f) => {
        if (id === requestId.current) setForecast(f);
      })
      .catch((e) => {
        if (id === requestId.current && e.name !== 'AbortError')
          setError(e.message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [scenario, refresh, live]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setMinute((m) => {
          if (m >= 180) {
            setPlaying(false);
            return 180;
          }
          return m + 15;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    setRoute(null);
  }, [minute]);
  useEffect(() => {
    if (!autoRefresh || custom) return;
    const timer = setInterval(() => setRefresh((v) => v + 1), 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, custom]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'read_flood_forecast',
        description:
          'Read the loaded forecast summary, provenance and selected lead time.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => {
          const s = state.current;
          return s.forecast
            ? {
                city: s.forecast.dataset.city,
                dataMode: s.forecast.dataMode,
                minute: s.minute,
                summary: s.forecast.frames[s.minute / 15].summary,
              }
            : { status: 'not_loaded' };
        },
      },
      {
        name: 'select_forecast_time',
        description:
          'Change the visible forecast lead time to an exact 15-minute frame.',
        inputSchema: {
          type: 'object',
          required: ['minute'],
          properties: {
            minute: {
              type: 'integer',
              minimum: 0,
              maximum: 180,
              multipleOf: 15,
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          const v = (input as { minute?: unknown })?.minute;
          if (
            typeof v !== 'number' ||
            v < 0 ||
            v > 180 ||
            v % 15 !== 0 ||
            !state.current.forecast
          )
            throw new Error(
              'A loaded forecast and minute in 0,15,...,180 are required',
            );
          setPlaying(false);
          setMinute(v);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return {
            minute: state.current.minute,
            summary: state.current.forecast?.frames[v / 15].summary,
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
  const isLive = forecast?.dataMode === 'live';
  const frame = forecast?.frames[minute / 15],
    city = forecast?.dataset.city ?? scenario.city;
  const priorities =
    forecast && frame
      ? [...forecast.dataset.roads]
          .sort(
            (a, b) => frame.streetDepthsCm[b.id] - frame.streetDepthsCm[a.id],
          )
          .slice(0, 3)
      : [];
  const cards: [LucideIcon, string, string, string, string, string][] = frame
    ? [
        [
          CloudRain,
          'Rainfall intensity',
          frame.rainMmHr.toFixed(1),
          'mm/hr',
          'Catchment mean · synthetic',
          'blue',
        ],
        [
          Waves,
          'Peak street depth',
          frame.summary.peakDepthCm.toFixed(1),
          'cm',
          `Projected at +${minute} minutes`,
          'orange',
        ],
        [
          MapPin,
          'Streets at risk',
          String(frame.summary.streetsAtRisk),
          'segments',
          'At or above 15 cm water depth',
          'red',
        ],
        [
          Network,
          'Surcharging drains',
          String(frame.summary.surchargedNodes),
          'nodes',
          'Backflow in this 15-min interval',
          'teal',
        ],
      ]
    : [];
  const changeCity = (value: string) => {
    setLive(false);
    setScenario((s) => ({ ...s, city: value as CityId }));
    setMinute(60);
    setPlaying(false);
  };
  const calculateRoute = async (from: string, to: string, mode: string) => {
    if (!forecast) return;
    setRouteBusy(true);
    setError('');
    try {
      const result = routeForecast(
        forecast,
        from,
        to,
        minute,
        mode as 'commuter',
      );
      setRoute(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Route could not be calculated',
      );
    } finally {
      setRouteBusy(false);
    }
  };
  const exportForecast = () => {
    if (!forecast || !frame) return;
    downloadJson(
      {
        type: 'FeatureCollection',
        metadata: {
          scenarioId: forecast.id,
          dataMode: forecast.dataMode,
          modelVersion: forecast.modelVersion,
          calibrated: false,
          minute,
          generatedAt: forecast.generatedAt,
          warning: forecast.warnings[0],
        },
        features: forecast.dataset.roads.map((e) => ({
          type: 'Feature',
          id: e.id,
          properties: {
            name: e.name,
            depthCm: frame.streetDepthsCm[e.id],
            intervalMaxCm: frame.streetIntervalMaxCm[e.id],
            leadMinutes: minute,
            illustrative: forecast.dataset.mode === 'synthetic',
          },
          geometry: { type: 'LineString', coordinates: e.coordinates },
        })),
      },
      `varsha-${city}-${minute}min.geojson`,
    );
  };
  const importSimulation = async (file: File) => {
    if (file.size > 2000000) {
      setError('File exceeds the 2 MB limit.');
      return;
    }
    const id = ++requestId.current;
    setImporting(true);
    setError('');
    setLoading(false);
    try {
      const text = await file.text();
      JSON.parse(text);
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const body = (await response.json()) as Forecast & { error?: string };
      if (!response.ok) throw new Error(body.error);
      if (id === requestId.current) {
        setForecast(body);
        setCustom(true);
        setAutoRefresh(false);
        setPlaying(false);
        setRoute(null);
        setSelected(null);
        setView('overview');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import simulation');
    } finally {
      setImporting(false);
    }
  };
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '218px' } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <div className="brand">
            <span className="brand-icon">
              <Waves size={25} />
            </span>
            <span>
              varsha<span className="brand-dot">.</span>
            </span>
          </div>
          <p className="brand-caption">URBAN FLOOD INTELLIGENCE</p>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">WORKSPACE</p>
          <SidebarMenu>
            {nav.map(([Icon, label, id]) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton
                  isActive={view === id}
                  onClick={() => setView(id)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="coverage-box">
            <span className="eyebrow">YOUR COVERAGE</span>
            <div>
              <span className="status-dot" />
              {CITY_INFO[city].name} metropolitan
            </div>
            <p>{custom ? 'Imported catchment' : 'Ward-scale demonstration'}</p>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="model-health">
            <Activity size={16} />
            <span>Research prototype</span>
          </div>
          <div className="profile">
            <span>OC</span>
            <div>
              Operations center<small>City resilience workspace</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-menu" /> Workspace{' '}
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n[2] === view)?.[1]}</strong>
          </div>
          <span className="demo-pill">
            <span />
            {isLive
              ? 'EXTERNAL FEED'
              : custom
                ? 'IMPORTED SCENARIO'
                : 'DEMO ENVIRONMENT'}
          </span>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MONSOON MONITOR / INDIA</div>
              <h1>
                {view === 'overview'
                  ? 'Ahead of the water.'
                  : view === 'drainage'
                    ? 'Below the surface.'
                    : view === 'routing'
                      ? 'A safer way through.'
                      : 'The science behind the signal.'}
              </h1>
              <p>
                {view === 'overview'
                  ? 'Street-level flood intelligence. A clearer view of what comes next.'
                  : view === 'drainage'
                    ? 'Follow the flow. Find the constraints. Understand the backflow.'
                    : view === 'routing'
                      ? 'Compare journeys against forecast flood exposure.'
                      : 'Trace every projection to its inputs and assumptions.'}
              </p>
            </div>
            <div className="heading-actions">
              <Select
                value={scenario.city}
                onValueChange={(v) => v && changeCity(v)}
              >
                <SelectTrigger className="city-select" aria-label="Select city">
                  <MapPin size={16} />
                  <SelectValue>{CITY_INFO[scenario.city].name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CITY_INFO).map(([id, c]) => (
                    <SelectItem value={id} key={id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                className="primary-button"
                onClick={exportForecast}
                disabled={!forecast || loading}
              >
                <Download size={16} /> Export forecast
              </button>
            </div>
          </div>
          <div className="scenario-notice">
            <Radio size={16} />
            <strong>
              {isLive
                ? 'External feed'
                : custom
                  ? 'Imported scenario'
                  : 'Simulation mode'}
            </strong>
            <span>
              {isLive
                ? 'External numeric feed. Model remains uncalibrated; check data provenance.'
                : custom
                  ? 'Using your uploaded catchment. Model remains uncalibrated.'
                  : 'Synthetic rainfall, terrain and drains. Illustrative street geometry.'}
            </span>
            <button
              className="notice-right"
              onClick={() => {
                setDraft(scenario);
                setSettings(true);
              }}
            >
              Adjust scenario <SlidersHorizontal size={14} />
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                onClick={() => {
                  setLive(false);
                  setRefresh((n) => n + 1);
                }}
              >
                Retry demo
              </button>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {!forecast ? (
            <div className="loading-state" role="status">
              <Waves size={32} />
              <h2>{error ? 'Forecast unavailable' : 'Routing the rain…'}</h2>
              <p>
                {error
                  ? 'Retry to load the demonstration.'
                  : 'Calculating 13 coupled surface and drainage frames.'}
              </p>
            </div>
          ) : (
            <>
              <div className="stats-grid">
                {cards.map(([Icon, label, value, unit, caption, color]) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-top">
                      <span>{label}</span>
                      <Icon className={color} size={19} />
                    </div>
                    <div className="stat-value">
                      {value} <small>{unit}</small>
                    </div>
                    <p>
                      <span className={'tiny-dot ' + color} />
                      {(custom || isLive) && label === 'Rainfall intensity'
                        ? 'Catchment mean · external'
                        : caption}
                    </p>
                  </div>
                ))}
              </div>
              {loading && (
                <div className="updating-banner" role="status">
                  <RefreshCw size={14} /> Calculating selected scenario. Showing
                  previous results until ready.
                </div>
              )}
              {view === 'data' ? (
                <DataView
                  forecast={forecast}
                  onImport={importSimulation}
                  importing={importing}
                  onLive={() => {
                    setLive(true);
                    setAutoRefresh(true);
                    setRefresh((n) => n + 1);
                  }}
                />
              ) : (
                frame && (
                  <>
                    <div className="main-grid">
                      <section className="map-card">
                        <div className="section-bar">
                          <div>
                            <h2>
                              {view === 'drainage'
                                ? 'Drainage outlook'
                                : 'Flood outlook'}{' '}
                              <span className="tag">+{minute} MIN</span>
                            </h2>
                            <p>
                              {forecast.dataset.name} ·{' '}
                              {custom
                                ? 'Imported catchment'
                                : CITY_INFO[city].area}
                            </p>
                          </div>
                          <Tabs
                            value={layer}
                            onValueChange={(v) => setLayer(String(v))}
                          >
                            <TabsList>
                              <TabsTrigger value="flood">Flood</TabsTrigger>
                              <TabsTrigger value="terrain">Terrain</TabsTrigger>
                            </TabsList>
                          </Tabs>
                        </div>
                        <FloodMap
                          key={forecast.dataset.id}
                          forecast={forecast}
                          frame={frame}
                          drains={drains || view === 'drainage'}
                          selected={selected}
                          onSelect={setSelected}
                          route={view === 'routing' ? route : null}
                          layer={layer}
                        />
                        <div className="timeline">
                          <div className="timeline-heading">
                            <div>
                              <Clock size={15} />
                              <strong>Forecast timeline</strong>
                              <span>Next 3 hours</span>
                            </div>
                            <button
                              className="play-button"
                              aria-label={
                                playing ? 'Pause forecast' : 'Play forecast'
                              }
                              onClick={() => {
                                if (minute === 180) setMinute(0);
                                setPlaying((p) => !p);
                              }}
                            >
                              {playing ? (
                                <Pause size={13} />
                              ) : (
                                <Play size={13} />
                              )}
                            </button>
                          </div>
                          <Slider
                            aria-label="Forecast lead time in minutes"
                            min={0}
                            max={180}
                            step={15}
                            value={[minute]}
                            onValueChange={(v) => {
                              setPlaying(false);
                              setMinute(Array.isArray(v) ? v[0] : v);
                            }}
                          />
                          <div className="time-labels">
                            <span>Now</span>
                            <span>+30m</span>
                            <span>+1h</span>
                            <span>+1h 30m</span>
                            <span>+2h</span>
                            <span>+2h 30m</span>
                            <span>+3h</span>
                          </div>
                        </div>
                      </section>
                      <aside className="right-panel">
                        {view === 'routing' ? (
                          <RoutingPanel
                            key={forecast.dataset.id}
                            forecast={forecast}
                            result={route}
                            onRoute={calculateRoute}
                            busy={routeBusy || loading}
                          />
                        ) : (
                          <>
                            <section className="insight-card">
                              <div className="section-title">
                                <h2>Priority locations</h2>
                                <span className="count-badge">
                                  {priorities.length}
                                </span>
                              </div>
                              <p className="muted">
                                Highest projected street depths
                              </p>
                              {priorities.map((e, i) => (
                                <button
                                  className="location-row"
                                  key={e.id}
                                  onClick={() => setSelected(e.id)}
                                >
                                  <span
                                    className={
                                      'location-icon ' +
                                      (frame.streetDepthsCm[e.id] >= 30
                                        ? 'critical'
                                        : 'warning')
                                    }
                                  >
                                    <Waves size={17} />
                                  </span>
                                  <span className="location-name">
                                    {e.name}
                                    <small>
                                      Segment {e.id.toUpperCase()} ·{' '}
                                      {forecast.dataset.name}
                                    </small>
                                  </span>
                                  <span
                                    className={
                                      frame.streetDepthsCm[e.id] >= 30
                                        ? 'depth-red'
                                        : 'depth-orange'
                                    }
                                  >
                                    {frame.streetDepthsCm[e.id].toFixed(0)}
                                    <small> cm</small>
                                    <ChevronRight size={13} />
                                  </span>
                                </button>
                              ))}
                              <div className="rain-preview">
                                <div className="section-title">
                                  <h3>Rainfall outlook</h3>
                                  <span>mm/hr</span>
                                </div>
                                <RainChart
                                  forecast={forecast}
                                  minute={minute}
                                />
                                <div className="chart-times">
                                  <span>Now</span>
                                  <span>+1h</span>
                                  <span>+2h</span>
                                  <span>+3h</span>
                                </div>
                              </div>
                            </section>
                            <section className="route-prompt">
                              <span className="route-icon">
                                <Route size={22} />
                              </span>
                              <h3>A safer way through.</h3>
                              <p>
                                Compare routes against projected street
                                flooding.
                              </p>
                              <button
                                onClick={() => {
                                  setView('routing');
                                  setPlaying(false);
                                }}
                              >
                                Plan a flood-aware route{' '}
                                <ArrowUpRight size={15} />
                              </button>
                            </section>
                            <div className="layer-toggle">
                              <Network size={17} />
                              <span>Show drainage network</span>
                              <Switch
                                aria-label="Show drainage network"
                                checked={drains || view === 'drainage'}
                                disabled={view === 'drainage'}
                                onCheckedChange={setDrains}
                              />
                            </div>
                          </>
                        )}
                      </aside>
                    </div>
                    {view === 'drainage' && (
                      <DrainageView forecast={forecast} frame={frame} />
                    )}
                  </>
                )
              )}
              <div className="forecast-status">
                <span>
                  <span className="status-dot" />
                  Run issued{' '}
                  {new Date(forecast.generatedAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  })}{' '}
                  IST · {forecast.runtimeMs.toFixed(0)} ms
                </span>
                <div>
                  <label htmlFor="refresh-toggle">Refresh every 60s</label>
                  <Switch
                    id="refresh-toggle"
                    checked={autoRefresh}
                    disabled={custom}
                    onCheckedChange={setAutoRefresh}
                  />
                  <button
                    aria-label="Refresh demo forecast"
                    onClick={() => setRefresh((n) => n + 1)}
                    disabled={loading || custom}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setDraft(scenario);
                      setSettings(true);
                    }}
                  >
                    <SlidersHorizontal size={14} /> Scenario
                  </button>
                </div>
              </div>
            </>
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} /> Demonstration only · Not for operational
              dispatch
            </span>
            <span>
              2D surface + 1D drainage <span className="footer-dot">·</span>{' '}
              0–180 minute horizon
            </span>
          </footer>
        </div>
      </main>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="scenario-dialog">
          <DialogHeader>
            <DialogTitle>Explore a rainfall scenario</DialogTitle>
            <DialogDescription>
              Recalculate the synthetic catchment with different rainfall, drain
              blockage and outfall levels.
            </DialogDescription>
          </DialogHeader>
          {[
            ['Rainfall peak', 'rainfallMmHr', 0, 200, 5, 'mm/hr'],
            ['Drain conductance loss', 'blockage', 0, 1, 0.05, '%'],
            ['Tailwater above outfall invert', 'tailwaterM', 0, 4, 0.1, 'm'],
          ].map(([label, key, min, max, step, unit]) => (
            <div className="scenario-control" key={String(key)}>
              <label>
                {label}
                <strong>
                  {key === 'blockage'
                    ? Math.round(draft.blockage * 100)
                    : draft[key as keyof Scenario]}{' '}
                  {unit}
                </strong>
              </label>
              <Slider
                aria-label={String(label)}
                min={Number(min)}
                max={Number(max)}
                step={Number(step)}
                value={[Number(draft[key as keyof Scenario])]}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    [String(key)]: Array.isArray(v) ? v[0] : v,
                  }))
                }
              />
            </div>
          ))}
          <p className="card-note">
            100% conductance loss stops every modeled pipe. Elevated tailwater
            can force water back into drains.
          </p>
          <DialogFooter>
            <button
              className="secondary-button"
              onClick={() => setDraft({ ...initial, city: scenario.city })}
            >
              Reset values
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setSettings(false);
                setLive(false);
                setScenario({ ...draft });
                setPlaying(false);
              }}
            >
              Run scenario <ArrowUpRight size={15} />
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function RainChart({
  forecast,
  minute,
}: {
  forecast: Forecast;
  minute: number;
}) {
  const max = Math.max(1, ...forecast.frames.map((f) => f.rainMmHr)),
    points = forecast.frames.map(
      (f, i) => `${i * 23.33},${76 - (f.rainMmHr / max) * 61}`,
    ),
    d = 'M' + points.join('L');
  return (
    <svg
      viewBox="0 0 280 90"
      role="img"
      aria-label={`${forecast.dataMode} rainfall forecast, maximum ${max.toFixed(1)} millimetres per hour`}
    >
      <path d={`${d}L280 85L0 85Z`} fill="#e8f0f8" />
      <path d={d} fill="none" stroke="#719bc6" strokeWidth="2" />
      <line
        x1={(minute / 180) * 280}
        x2={(minute / 180) * 280}
        y1="4"
        y2="85"
        stroke="#7eaa9c"
        strokeDasharray="3 3"
      />
      <text x="2" y="11" fontSize="10" fill="#97a6b4">
        {max.toFixed(0)}
      </text>
    </svg>
  );
}

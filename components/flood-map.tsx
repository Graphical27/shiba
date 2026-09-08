'use client';
import { useState, useRef } from 'react';
import { Plus, Minus, LocateFixed, Layers, X } from 'lucide-react';
import type { Forecast, Frame, RoadEdge } from '@/lib/flood/types';
import type { RouteResult } from '@/lib/flood/routing';
import { cellCoordinate, depthColor } from '@/lib/flood/types';
import { CITY_INFO } from '@/lib/flood/fixtures';
export default function FloodMap({
  forecast,
  frame,
  drains,
  selected,
  onSelect,
  route,
  layer = 'flood',
}: {
  forecast: Forecast;
  frame: Frame;
  drains: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  route: RouteResult | null;
  layer?: string;
}) {
  const [zoom, setZoom] = useState(1),
    [offset, setOffset] = useState([0, 0]);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const { dataset } = forecast,
    { grid } = dataset,
    side = 520,
    dx = side / grid.width,
    dy = side / grid.height,
    left = 140,
    top = 10;
  const pos = (cell: number) => [
    left + ((cell % grid.width) + 0.5) * dx,
    top + side - (Math.floor(cell / grid.width) + 0.5) * dy,
  ];
  const path = (road: RoadEdge) =>
    road.cells.map((c, i) => `${i ? 'L' : 'M'}${pos(c).join(',')}`).join(' ');
  const road = dataset.roads.find((e) => e.id === selected),
    point = road ? pos(road.cells[Math.floor(road.cells.length / 2)]) : null;
  const routePath = (ids: string[]) =>
    ids
      .map((id) => dataset.roads.find((e) => e.id === id))
      .filter((e): e is RoadEdge => !!e)
      .map(path)
      .join(' ');
  const maxZ = Math.max(...grid.elevationM),
    minZ = Math.min(...grid.elevationM);
  return (
    <div className="map-surface">
      <svg
        viewBox="0 0 800 540"
        className="geographic-map"
        aria-label={`${dataset.name} georeferenced ${layer} map. ${dataset.provenance}`}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[role=button]')) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            ox: offset[0],
            oy: offset[1],
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const s = 800 / e.currentTarget.getBoundingClientRect().width;
            setOffset([
              drag.current.ox + (e.clientX - drag.current.x) * s,
              drag.current.oy + (e.clientY - drag.current.y) * s,
            ]);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        style={{ touchAction: 'none', cursor: 'grab' }}
      >
        <defs>
          <pattern
            id="map-grid"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M32 0H0V32"
              fill="none"
              stroke="#dce4e0"
              strokeWidth=".4"
            />
          </pattern>
          <marker
            id="drain-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill="#459d98" />
          </marker>
          <filter id="flood-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="800" height="540" fill="#e9eeeb" />
        <rect width="800" height="540" fill="url(#map-grid)" />
        <g
          transform={`translate(${offset[0]} ${offset[1]}) translate(400 270) scale(${zoom}) translate(-400 -270)`}
        >
          <rect
            x={left}
            y={top}
            width={side}
            height={side}
            fill="#eef2ee"
            stroke="#c8d6cd"
            strokeDasharray="4 5"
          />
          {grid.elevationM.map((z, i) => {
            const [x, y] = pos(i),
              cm = frame.depthsCm[i],
              opacity =
                layer === 'terrain'
                  ? 0.16 + (0.4 * (z - minZ)) / Math.max(0.001, maxZ - minZ)
                  : cm >= 5
                    ? Math.min(0.38, 0.1 + cm / 150)
                    : 0;
            return (
              <g key={i}>
                <rect
                  x={x - dx * 0.37}
                  y={y - dy * 0.37}
                  width={dx * 0.74}
                  height={dy * 0.74}
                  rx="1"
                  fill={grid.imperviousness[i] > 0.9 ? '#e9eeea' : '#dce5dc'}
                  stroke="#d6dfd5"
                  strokeWidth=".3"
                />
                {opacity > 0 && (
                  <rect
                    x={x - dx / 2}
                    y={y - dy / 2}
                    width={dx + 0.1}
                    height={dy + 0.1}
                    fill={layer === 'terrain' ? '#658a74' : depthColor(cm)}
                    opacity={opacity}
                  />
                )}
              </g>
            );
          })}
          {dataset.roads.map((e) => (
            <path
              d={path(e)}
              key={'base' + e.id}
              fill="none"
              stroke="#fff"
              strokeWidth="7"
            />
          ))}
          {dataset.roads.map((e) => (
            <path
              d={path(e)}
              key={e.id}
              fill="none"
              stroke={
                layer === 'flood'
                  ? depthColor(frame.streetDepthsCm[e.id])
                  : '#c4cfca'
              }
              strokeWidth={selected === e.id ? 6 : 3.5}
              opacity={
                frame.streetDepthsCm[e.id] >= 5 || selected === e.id ? 1 : 0.6
              }
              strokeLinecap="round"
              role="button"
              tabIndex={0}
              aria-label={`${e.name}, ${frame.streetDepthsCm[e.id].toFixed(1)} centimetres`}
              onClick={() => onSelect(e.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(e.id);
                }
              }}
            >
              <title>
                {e.name}: {frame.streetDepthsCm[e.id].toFixed(1)} cm
              </title>
            </path>
          ))}
          {drains &&
            dataset.pipes.map((p) => {
              const a = dataset.drains.find((d) => d.id === p.from)!,
                b = dataset.drains.find((d) => d.id === p.to)!;
              return (
                <path
                  key={p.id}
                  d={`M${pos(a.cell).join(',')}L${pos(b.cell).join(',')}`}
                  stroke="#399c95"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  markerEnd="url(#drain-arrow)"
                />
              );
            })}
          {drains &&
            dataset.drains.map((d, i) => {
              const [x, y] = pos(d.cell);
              return (
                <circle
                  key={d.id}
                  cx={x}
                  cy={y}
                  r={frame.surchargeM3[i] > 0.001 ? 5 : 3}
                  fill={frame.surchargeM3[i] > 0.001 ? '#d56b60' : '#fff'}
                  stroke="#42998b"
                  strokeWidth="1.5"
                >
                  <title>
                    {d.name}: {frame.drainDepthsM[i].toFixed(2)} m stored depth;{' '}
                    {frame.surchargeM3[i].toFixed(2)} m³ surcharge in interval
                  </title>
                </circle>
              );
            })}
          {[0, 2, 4, 6].map((r) => (
            <text
              key={r}
              x={left + 20}
              y={top + side - (r * 4 + 3.5) * dy - 10}
              className="map-place"
              style={{ fontSize: 10, letterSpacing: 1 }}
            >
              {CITY_INFO[dataset.city].roads[r].toUpperCase()}
            </text>
          ))}
          {route?.baseline && (
            <path
              d={routePath(route.baseline.edgeIds)}
              stroke="#576a85"
              strokeWidth="5"
              fill="none"
              strokeDasharray="8 7"
              opacity=".7"
            />
          )}
          {route?.safer && (
            <path
              d={routePath(route.safer.edgeIds)}
              stroke="#2768ae"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {point && (
            <g transform={`translate(${point[0]},${point[1]})`}>
              <circle
                r="14"
                fill="none"
                stroke="#d77159"
                strokeWidth="2"
                opacity=".35"
              />
              <circle r="7" fill="#d77159" stroke="white" strokeWidth="3" />
            </g>
          )}
          <text
            x={left + side + 22}
            y={top + side / 2}
            fontSize="11"
            fill="#8e9b94"
            transform={`rotate(90 ${left + side + 22} ${top + side / 2})`}
            letterSpacing="2"
          >
            ILLUSTRATIVE CATCHMENT
          </text>
        </g>
        <g transform="translate(746 464)">
          <path d="M0 0L-6 18L0 14L6 18Z" fill="#6a7d78" />
          <text y="-7" textAnchor="middle" fontSize="11" fill="#6a7d78">
            N
          </text>
        </g>
      </svg>
      <div className="map-top-label">
        <span className="status-dot" />
        {layer === 'terrain' ? 'Terrain elevation' : 'Flood depth projection'}
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="Reset map view"
          onClick={() => {
            setZoom(1);
            setOffset([0, 0]);
          }}
        >
          <LocateFixed size={18} />
        </button>
      </div>
      {road && (
        <div className="map-selection">
          <button
            aria-label="Close street details"
            onClick={() => onSelect(null)}
          >
            <X size={14} />
          </button>
          <small>SELECTED STREET</small>
          <strong>{road.name}</strong>
          <div>
            {frame.streetDepthsCm[road.id].toFixed(1)} <span>cm projected</span>
          </div>
          <p>
            {road.id.toUpperCase()} ·{' '}
            {cellCoordinate(grid, road.cells[0])
              .map((c) => c.toFixed(4))
              .join(', ')}
          </p>
        </div>
      )}
      <div className="map-legend">
        <strong>
          {layer === 'flood'
            ? 'Water depth'
            : layer === 'terrain'
              ? `Elevation ${minZ.toFixed(1)}–${maxZ.toFixed(1)} m`
              : 'Rainfall layer · schematic'}
        </strong>
        {layer === 'flood' && (
          <div>
            {[
              ['#8fbba4', '< 5 cm'],
              ['#e3bb59', '5–15'],
              ['#ee9562', '15–30'],
              ['#de6b62', '≥ 30'],
            ].map(([c, l]) => (
              <span key={l}>
                <i style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        )}
        <div className="scale-bar">
          <span style={{ width: 50 * zoom }} />{' '}
          {Math.round((grid.width * grid.cellSizeM * 50) / 520)} m
        </div>
      </div>
      <span className="map-credit">
        EPSG:4326 · {grid.cellSizeM} m {dataset.mode} grid · Drag to pan
      </span>
    </div>
  );
}

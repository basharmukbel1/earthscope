import { useEffect, useMemo, useRef, useState } from "react";
import { geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import type { BBox, Region } from "@/types/domain";
import { loadCountries, countryToRegion, type CountryFeature } from "@/services/geo";
import { cn } from "@/utils/cn";
import { fmtLat, fmtLon } from "@/utils/format";

export interface RegionMapProps {
  regions?: Region[];
  samplePoints?: { lon: number; lat: number }[];
  interactive?: boolean;
  drawMode?: boolean;
  onSelectCountry?: (region: Region) => void;
  onDrawBox?: (bbox: BBox) => void;
  fit?: "world" | "regions";
  underlay?: { url: string; bbox: BBox; label?: string } | null;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

const REGION_COLORS = ["var(--color-ice)", "var(--color-cyan)", "#f5c56b", "#c9a7ff"];

function unionBBox(regions: Region[]): BBox | null {
  if (!regions.length) return null;
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const r of regions) {
    const east = r.bbox.east < r.bbox.west ? r.bbox.east + 360 : r.bbox.east;
    w = Math.min(w, r.bbox.west);
    e = Math.max(e, east);
    s = Math.min(s, r.bbox.south);
    n = Math.max(n, r.bbox.north);
  }
  return { west: w, south: s, east: e, north: n };
}

/** Equirectangular extent padded and clamped; returns lon/lat window. */
export function viewExtent(regions: Region[], fit: "world" | "regions"): BBox {
  const u = fit === "regions" ? unionBBox(regions) : null;
  if (!u) return { west: -180, south: -60, east: 180, north: 85 };
  const padX = Math.max(2, (u.east - u.west) * 0.35);
  const padY = Math.max(2, (u.north - u.south) * 0.35);
  let west = u.west - padX,
    east = u.east + padX;
  let south = Math.max(-90, u.south - padY),
    north = Math.min(90, u.north + padY);
  // enforce ~2:1 aspect so the map isn't stretched
  const w = east - west,
    h = north - south;
  if (w < 2 * h) {
    const add = (2 * h - w) / 2;
    west -= add;
    east += add;
  } else {
    const add = (w / 2 - h) / 2;
    south = Math.max(-90, south - add);
    north = Math.min(90, north + add);
  }
  return { west: Math.max(-180, west), east: Math.min(180, east), south, north };
}

export function RegionMap({
  regions = [],
  samplePoints,
  interactive,
  drawMode,
  onSelectCountry,
  onDrawBox,
  fit = "regions",
  underlay,
  height = 360,
  className,
  ariaLabel = "Map of the selected region",
}: RegionMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);

  useEffect(() => {
    let alive = true;
    loadCountries().then((c) => alive && setCountries(c));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const extent = useMemo(() => viewExtent(regions, fit), [regions, fit]);

  const { projection, path } = useMemo(() => {
    const p = geoEquirectangular();
    // Fit on the four corners (a MultiPoint has no great-circle edges, so the
    // projected frame matches the lon/lat window exactly — required for GIBS underlays).
    const corners = {
      type: "Feature",
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [extent.west, extent.south],
          [extent.west, extent.north],
          [extent.east, extent.north],
          [extent.east, extent.south],
        ],
      },
      properties: {},
    } as GeoJSON.Feature;
    p.fitSize([width, height], corners);
    return { projection: p, path: geoPath(p) };
  }, [extent, width, height]);

  const regionShapes = useMemo(() => {
    return regions.map((r, i) => {
      const color = REGION_COLORS[i % REGION_COLORS.length];
      const feature = r.kind === "country" && countries ? countries.find((c) => c.id === r.countryId) : undefined;
      if (feature) return { id: r.id, d: path(feature) ?? "", color, name: r.name };
      const b = r.bbox;
      const east = b.east < b.west ? b.east + 360 : b.east;
      const ring: [number, number][] = [];
      const steps = 24;
      for (let k = 0; k <= steps; k++) ring.push([b.west + ((east - b.west) * k) / steps, b.south]);
      for (let k = 0; k <= steps; k++) ring.push([east, b.south + ((b.north - b.south) * k) / steps]);
      for (let k = 0; k <= steps; k++) ring.push([east - ((east - b.west) * k) / steps, b.north]);
      for (let k = 0; k <= steps; k++) ring.push([b.west, b.north - ((b.north - b.south) * k) / steps]);
      const pts = ring.map(([lo, la]) => projection([lo > 180 ? lo - 360 : lo, la]) ?? [0, 0]);
      return { id: r.id, d: `M${pts.map((p) => p.join(",")).join("L")}Z`, color, name: r.name };
    });
  }, [regions, countries, path, projection]);

  const underlayRect = useMemo(() => {
    if (!underlay) return null;
    const a = projection([underlay.bbox.west, underlay.bbox.north]);
    const b = projection([underlay.bbox.east, underlay.bbox.south]);
    if (!a || !b) return null;
    return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
  }, [underlay, projection]);

  const toLonLat = (e: React.PointerEvent<SVGSVGElement>): [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const inv = projection.invert?.([e.clientX - rect.left, e.clientY - rect.top]);
    return inv ? [inv[0], inv[1]] : null;
  };

  const graticule = useMemo(() => path(geoGraticule10()) ?? "", [path]);

  return (
    <div ref={wrapRef} className={cn("relative w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--map-bg)]", className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className={cn("block touch-none select-none", drawMode && "cursor-crosshair")}
        onPointerDown={(e) => {
          if (!drawMode) return;
          const ll = toLonLat(e);
          if (ll) {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag({ a: ll, b: ll });
          }
        }}
        onPointerMove={(e) => {
          const ll = toLonLat(e);
          setCursor(ll);
          if (drag && ll) setDrag({ ...drag, b: ll });
        }}
        onPointerUp={() => {
          if (drag && onDrawBox) {
            const west = Math.min(drag.a[0], drag.b[0]),
              east = Math.max(drag.a[0], drag.b[0]);
            const south = Math.min(drag.a[1], drag.b[1]),
              north = Math.max(drag.a[1], drag.b[1]);
            if (east - west > 0.5 && north - south > 0.5) onDrawBox({ west, south, east, north });
          }
          setDrag(null);
        }}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
      >
        <defs>
          <pattern id="rm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(168 216 255 / .25)" strokeWidth="1" />
          </pattern>
          <radialGradient id="rm-vignette" cx="50%" cy="50%" r="75%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="var(--map-vignette)" />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill="var(--map-bg)" />
        {underlay && underlayRect && (
          <image href={underlay.url} x={underlayRect.x} y={underlayRect.y} width={underlayRect.w} height={underlayRect.h} preserveAspectRatio="none" opacity={0.92} />
        )}
        <path d={graticule} fill="none" stroke="var(--map-graticule)" strokeWidth={0.6} />
        {countries?.map((c) => (
          <path
            key={c.id}
            d={path(c) ?? ""}
            fill={underlay ? "transparent" : "var(--map-land)"}
            stroke={underlay ? "rgb(255 255 255 / .45)" : "var(--map-border)"}
            strokeWidth={0.5}
            className={cn(interactive && "cursor-pointer transition-[fill] duration-150 hover:fill-[rgb(56_225_255/.16)]")}
            onPointerMove={(e) => interactive && setHover({ name: c.properties.name, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
            onClick={() => interactive && !drawMode && onSelectCountry?.(countryToRegion(c))}
          />
        ))}
        {regionShapes.map((r) => (
          <g key={r.id}>
            <path d={r.d} fill="url(#rm-hatch)" stroke="none" />
            <path d={r.d} fill="none" stroke={r.color} strokeWidth={1.8} style={{ filter: `drop-shadow(0 0 6px ${r.color})` }} />
          </g>
        ))}
        {samplePoints?.map((p, i) => {
          const xy = projection([p.lon, p.lat]);
          if (!xy) return null;
          return <circle key={i} cx={xy[0]} cy={xy[1]} r={2.2} fill="var(--color-cyan)" stroke="#021018" strokeWidth={0.8} />;
        })}
        {drag &&
          (() => {
            const a = projection(drag.a),
              b = projection(drag.b);
            if (!a || !b) return null;
            return (
              <rect
                x={Math.min(a[0], b[0])}
                y={Math.min(a[1], b[1])}
                width={Math.abs(b[0] - a[0])}
                height={Math.abs(b[1] - a[1])}
                fill="rgb(56 225 255 / .1)"
                stroke="var(--color-cyan)"
                strokeDasharray="5 4"
                strokeWidth={1.2}
              />
            );
          })()}
        <rect width={width} height={height} fill="url(#rm-vignette)" pointerEvents="none" />
      </svg>

      {hover && interactive && !drawMode && (
        <div className="glass pointer-events-none absolute z-10 rounded-md px-2 py-1 text-xs" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hover.name}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-ink-3)]">
        {cursor ? `${fmtLat(cursor[1])}  ${fmtLon(cursor[0])}` : "EQUIRECTANGULAR · WGS84"}
      </div>
      {underlay?.label && (
        <div className="pointer-events-none absolute bottom-2 right-3 max-w-[60%] truncate font-mono text-[10px] text-[var(--color-ink-3)]">{underlay.label}</div>
      )}
      {!countries && <div className="skeleton absolute inset-0 rounded-none opacity-40" />}
    </div>
  );
}

/* ==========================================================================
   EARTHSCOPE — <GlobeFallback/>: SVG equirectangular map with the same props
   subset as <Globe/>. Used when WebGL is unavailable or the context is lost.
   No three.js dependency.
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { geoEquirectangular, geoGraticule, geoPath } from "d3-geo";
import type { AtlasPoint, BBox } from "../../types/domain";
import { countryAt, countryMeshes, findCountry, loadCountries, type CountryData } from "./countries";
import {
  DEFAULT_ATLAS_FILTER,
  EARTH_COLORS,
  atlasKind,
  atlasMarkerSize,
  atlasPasses,
  atlasSlopeScale,
  normalizeBBox,
  type GlobeProps,
  type PickInfo,
} from "./types";

const W = 960;
const H = 480;

function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / r;
}

const x = (lon: number) => ((lon + 180) / 360) * W;
const y = (lat: number) => ((90 - lat) / 180) * H;

function bboxRects(b: BBox): { x: number; y: number; w: number; h: number }[] {
  const n = normalizeBBox(b);
  let east = n.east;
  if (east <= n.west) east += 360;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const off of [-360, 0]) {
    const x0 = x(n.west + off);
    const x1 = x(east + off);
    const cx0 = Math.max(0, x0);
    const cx1 = Math.min(W, x1);
    if (cx1 > cx0) out.push({ x: cx0, y: y(n.north), w: cx1 - cx0, h: y(n.south) - y(n.north) });
  }
  return out;
}

export function GlobeFallback(props: GlobeProps) {
  const { className, overlay, atlas, atlasFilter = DEFAULT_ATLAS_FILTER, regions = [], showBorders = true, showGraticule = true, interactive = true } = props;
  const [data, setData] = useState<CountryData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hoverRaf = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let alive = true;
    loadCountries("110m")
      .then((d) => {
        if (!alive) return;
        setData(d);
        propsRef.current.onReady?.();
      })
      .catch((e: unknown) => propsRef.current.onError?.(e instanceof Error ? e : new Error(String(e))));
    return () => {
      alive = false;
      cancelAnimationFrame(hoverRaf.current);
    };
  }, []);

  const path = useMemo(() => geoPath(geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2)), []);

  const layers = useMemo(() => {
    if (!data) return null;
    const meshes = countryMeshes(data);
    return {
      land: data.features.map((f) => ({ id: f.id, d: path(f) ?? "" })),
      borders: path(meshes.borders) ?? "",
      coasts: path(meshes.coasts) ?? "",
    };
  }, [data, path]);

  const grat = useMemo(() => {
    const minor = path(geoGraticule().step([15, 15]).extentMinor([[-180, -90], [180, 90]]).extentMajor([[-180, -90], [180, 90]])()) ?? "";
    const major = [0, 23.4362, -23.4362].map((lat) => `M0,${y(lat)}H${W}`).join("");
    return { minor, major };
  }, [path]);

  const markers = useMemo(() => {
    if (!atlas?.points.length) return [];
    const scale = atlasSlopeScale(atlas.points);
    return atlas.points
      .filter((p) => atlasPasses(p, atlasFilter))
      .map((p) => ({ p, kind: atlasKind(p), s: atlasMarkerSize(p, scale) * 0.55 }));
  }, [atlas, atlasFilter]);

  const toLonLat = (clientX: number, clientY: number): { lon: number; lat: number; sx: number; sy: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    if (pt.x < 0 || pt.x > W || pt.y < 0 || pt.y > H) return null;
    const r = svg.getBoundingClientRect();
    return { lon: (pt.x / W) * 360 - 180, lat: 90 - (pt.y / H) * 180, sx: clientX - r.left, sy: clientY - r.top };
  };

  const infoAt = (clientX: number, clientY: number): PickInfo | null => {
    const ll = toLonLat(clientX, clientY);
    if (!ll) return null;
    const info: PickInfo = { lon: ll.lon, lat: ll.lat, screen: { x: ll.sx, y: ll.sy } };
    const c = data ? countryAt(ll.lon, ll.lat, data) : null;
    if (c) {
      info.countryId = c.id;
      info.countryName = c.properties?.name;
    }
    let best = 3;
    let hit: AtlasPoint | undefined;
    for (const m of markers) {
      if (Math.abs(m.p.lat - ll.lat) > best) continue;
      const d = angularDistance(ll.lon, ll.lat, m.p.lon, m.p.lat);
      if (d < best) {
        best = d;
        hit = m.p;
      }
    }
    if (hit) info.atlasPoint = hit;
    return info;
  };

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const info = infoAt(e.clientX, e.clientY);
    if (info) propsRef.current.onSelect?.(info);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive || !propsRef.current.onHover) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => propsRef.current.onHover?.(infoAt(clientX, clientY)));
  };

  const line = "rgb(148 180 255 / 0.22)";
  const style: CSSProperties = { display: "block", width: "100%", height: "100%", background: EARTH_COLORS.void, cursor: interactive ? "crosshair" : "default" };

  return (
    <div className={`es-globe${className ? ` ${className}` : ""}`} style={{ position: "relative", overflow: "hidden" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={style}
        role="img"
        aria-label={props.ariaLabel ?? "World map (2D fallback view)"}
        onClick={onClick}
        onPointerMove={onMove}
        onPointerLeave={() => propsRef.current.onHover?.(null)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#070b15" />
        {layers && (
          <g fill="#131d33">
            {layers.land.map((l) => (
              <path key={l.id} d={l.d} />
            ))}
          </g>
        )}
        {overlay?.url && <image href={overlay.url} x={0} y={0} width={W} height={H} preserveAspectRatio="none" opacity={overlay.opacity} />}
        {showGraticule && (
          <g fill="none" vectorEffect="non-scaling-stroke">
            <path d={grat.minor} stroke="rgb(148 180 255 / 0.10)" strokeWidth={0.6} />
            <path d={grat.major} stroke="rgb(168 216 255 / 0.22)" strokeWidth={0.6} />
          </g>
        )}
        {layers && showBorders && (
          <g fill="none" strokeLinejoin="round">
            <path d={layers.coasts} stroke="rgb(168 216 255 / 0.32)" strokeWidth={0.6} />
            <path d={layers.borders} stroke={line} strokeWidth={0.5} />
          </g>
        )}
        <g>
          {regions.map((r) => {
            const color = r.color ?? EARTH_COLORS.ice;
            const feat = r.countryId && data ? findCountry(r.countryId, data) : undefined;
            if (feat) return <path key={r.id} d={path(feat) ?? ""} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />;
            return bboxRects(r.bbox).map((b, i) => (
              <rect key={`${r.id}-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.6} />
            ));
          })}
        </g>
        <g>
          {markers.map(({ p, kind, s }, i) => {
            const cx = x(p.lon);
            const cy = y(p.lat);
            if (kind === "flat") return <circle key={i} cx={cx} cy={cy} r={1.7} fill="none" stroke={EARTH_COLORS.flat} strokeWidth={0.7} />;
            const h = s * 0.866;
            const d = kind === "rise" ? `M${cx},${cy - h * 0.62}L${cx + s / 2},${cy + h * 0.38}L${cx - s / 2},${cy + h * 0.38}Z` : `M${cx},${cy + h * 0.62}L${cx + s / 2},${cy - h * 0.38}L${cx - s / 2},${cy - h * 0.38}Z`;
            return <path key={i} d={d} fill={kind === "rise" ? EARTH_COLORS.rise : EARTH_COLORS.fall} stroke="#04060c" strokeOpacity={0.6} strokeWidth={0.5} />;
          })}
        </g>
      </svg>
    </div>
  );
}

export default GlobeFallback;

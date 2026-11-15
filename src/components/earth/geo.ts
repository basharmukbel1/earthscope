/* ==========================================================================
   EARTHSCOPE — geometry helpers shared by the WebGL engine.

   Line data is emitted as flat Float32Arrays of segment pairs
   [lon0, lat0, lift, lon1, lat1, lift, …] in DEGREES. The vertex shader
   morphs both endpoints (globe ↔ map); segments are densified to ≤ 2° and
   unwrapped so that no stored segment spans more than 180° of longitude
   (the shader collapses segments that straddle the current map seam).

   Rasterization (land mask, region fills) uses linear lon/lat edges, which
   is how Natural Earth data is defined and matches the line overlays.
   ========================================================================== */

import type { BBox } from "../../types/domain";
import type { MultiLineString, MultiPolygon, Polygon, Position } from "geojson";

export const MAX_STEP_DEG = 2;

/** Push one densified segment chain from a → b (b may be unwrapped by ±360). */
export function pushSegment(out: number[], lon0: number, lat0: number, lon1: number, lat1: number, lift: number, maxStep = MAX_STEP_DEG): void {
  let dl = lon1 - lon0;
  if (dl > 180) dl -= 360;
  else if (dl < -180) dl += 360;
  const dp = lat1 - lat0;
  if (Math.abs(dl) < 1e-9 && Math.abs(dp) < 1e-9) return;
  // degenerate segments along a pole (all longitudes are the same point)
  if (Math.abs(lat0) > 89.9999 && Math.abs(lat1) > 89.9999) return;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dl), Math.abs(dp)) / maxStep));
  let pl = lon0;
  let pp = lat0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const l = lon0 + dl * t;
    const p = lat0 + dp * t;
    out.push(pl, pp, lift, l, p, lift);
    pl = l;
    pp = p;
  }
}

/** Polyline (array of [lon, lat]) → segments. */
export function pushLine(out: number[], line: readonly Position[], lift: number, maxStep = MAX_STEP_DEG): void {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    // world-atlas v2 is spherical topology: ±180 jumps are zero-length/short and get unwrapped
    pushSegment(out, a[0], a[1], b[0], b[1], lift, maxStep);
  }
}

export function multiLineToSegments(ml: MultiLineString, lift: number, maxStep = MAX_STEP_DEG): Float32Array {
  const out: number[] = [];
  for (const line of ml.coordinates) pushLine(out, line, lift, maxStep);
  return new Float32Array(out);
}

export function polygonToSegments(g: Polygon | MultiPolygon, lift: number, maxStep = MAX_STEP_DEG): Float32Array {
  const out: number[] = [];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) pushLine(out, ring, lift, maxStep);
  return new Float32Array(out);
}

/** Closed bbox outline (handles east < west, i.e. crossing the antimeridian). */
export function bboxRing(b: BBox): Position[] {
  const west = b.west;
  let east = b.east;
  if (east <= west) east += 360;
  const { south, north } = b;
  return [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

export function bboxToSegments(b: BBox, lift: number, maxStep = 1): Float32Array {
  const out: number[] = [];
  const r = bboxRing(b);
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1];
    const c = r[i];
    // explicit densification without wrap-unwrapping (bbox edges may be > 180° wide)
    const dl = c[0] - a[0];
    const dp = c[1] - a[1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dl), Math.abs(dp)) / maxStep));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      out.push(a[0] + dl * t0, a[1] + dp * t0, lift, a[0] + dl * t1, a[1] + dp * t1, lift);
    }
  }
  return new Float32Array(out);
}

/** Graticule: minor every `step`°, major = equator + tropics (+ polar circles as minor-major). */
export function graticuleSegments(step = 15, lift = 1): { minor: Float32Array; major: Float32Array } {
  const minor: number[] = [];
  const major: number[] = [];
  for (let lon = -180; lon < 180; lon += step) pushSegment2(minor, [[lon, -90], [lon, 90]], lift);
  for (let lat = -90 + step; lat < 90; lat += step) {
    if (lat === 0) continue;
    pushParallel(minor, lat, lift);
  }
  pushParallel(major, 0, lift);
  pushParallel(major, 23.4362, lift);
  pushParallel(major, -23.4362, lift);
  return { minor: new Float32Array(minor), major: new Float32Array(major) };
}

function pushSegment2(out: number[], line: Position[], lift: number) {
  for (let i = 1; i < line.length; i++) pushSegment(out, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], lift);
}

function pushParallel(out: number[], lat: number, lift: number) {
  for (let lon = -180; lon < 180; lon += MAX_STEP_DEG) out.push(lon, lat, lift, lon + MAX_STEP_DEG, lat, lift);
}

/* --------------------------------------------------------------------------
   Equirectangular canvas rasterization (x = (lon+180)/360·W, y = (90−lat)/180·H)
   -------------------------------------------------------------------------- */

/** Unwraps a ring's longitudes; closes pole-enclosing rings (e.g. Antarctica) through the pole. */
function unwrapRing(ring: readonly Position[]): number[] {
  const pts: number[] = [];
  if (!ring.length) return pts;
  let prev = ring[0][0];
  let acc = prev;
  let latSum = 0;
  pts.push(acc, ring[0][1]);
  latSum += ring[0][1];
  for (let i = 1; i < ring.length; i++) {
    let d = ring[i][0] - prev;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    acc += d;
    prev = ring[i][0];
    pts.push(acc, ring[i][1]);
    latSum += ring[i][1];
  }
  const span = acc - ring[0][0];
  if (Math.abs(span) > 180) {
    const pole = latSum / ring.length < 0 ? -90 : 90;
    pts.push(acc, pole, ring[0][0], pole);
  }
  return pts;
}

export function traceGeometryEquirect(ctx: CanvasRenderingContext2D, g: Polygon | MultiPolygon, W: number, H: number): void {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const sx = W / 360;
  const sy = H / 180;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = unwrapRing(ring);
      if (pts.length < 6) continue;
      let minL = Infinity;
      let maxL = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minL = Math.min(minL, pts[i]);
        maxL = Math.max(maxL, pts[i]);
      }
      for (const off of [-360, 0, 360]) {
        if (maxL + off < -180 || minL + off > 180) continue;
        ctx.moveTo((pts[0] + off + 180) * sx, (90 - pts[1]) * sy);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo((pts[i] + off + 180) * sx, (90 - pts[i + 1]) * sy);
        ctx.closePath();
      }
    }
  }
}

export function fillGeometryEquirect(ctx: CanvasRenderingContext2D, g: Polygon | MultiPolygon, W: number, H: number): void {
  ctx.beginPath();
  traceGeometryEquirect(ctx, g, W, H);
  ctx.fill("evenodd");
}

export function fillBBoxEquirect(ctx: CanvasRenderingContext2D, b: BBox, W: number, H: number): void {
  const west = b.west;
  let east = b.east;
  if (east <= west) east += 360;
  const sx = W / 360;
  const sy = H / 180;
  const y0 = (90 - b.north) * sy;
  const y1 = (90 - b.south) * sy;
  for (const off of [-360, 0, 360]) {
    const x0 = (west + off + 180) * sx;
    const x1 = (east + off + 180) * sx;
    if (x1 < 0 || x0 > W) continue;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/** Shared CPU land mask canvas (white land on black), rasterized once per page. */
let landMaskCanvas: HTMLCanvasElement | null = null;
export function getLandMaskCanvas(land: MultiPolygon, W = 2048, H = 1024): HTMLCanvasElement {
  if (landMaskCanvas && landMaskCanvas.width === W) return landMaskCanvas;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    try {
      ctx.filter = "blur(1px)";
    } catch {
      /* unsupported */
    }
    fillGeometryEquirect(ctx, land, W, H);
    ctx.filter = "none";
  }
  landMaskCanvas = c;
  return c;
}

/* --------------------------------------------------------------------------
   Small math helpers
   -------------------------------------------------------------------------- */

export const DEG = Math.PI / 180;
export const wrap180 = (l: number) => ((((l + 180) % 360) + 360) % 360) - 180;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Great-circle angular distance in degrees. */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / DEG;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [168, 216, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

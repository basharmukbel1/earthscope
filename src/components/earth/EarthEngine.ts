/* ==========================================================================
   EARTHSCOPE — EarthEngine
   Framework-agnostic WebGL globe ⇄ map renderer (three.js).

   - One subdivided (λ, φ) grid mesh; the vertex shader morphs it between a
     sphere and an equirectangular plane (constant-arc-length unroll, see
     shaders.ts). The view centre is expressed as uniforms (uLon0, uLat0), so
     "rotating the globe" and "panning the map" are the same state and the
     unfold never jumps; the seam always sits at uLon0 ± 180°.
   - Every overlay (graticule, borders, regions, atlas markers, draw box)
     uses the same GLSL morph chunk, so it stays glued through the transition.
   - Analytic picking (ray–sphere / ray–plane), damped orbit/pan/zoom,
     fly-to, render-on-demand, visibility pausing, context-loss handling.
   ========================================================================== */

import {
  AddEquation,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  DataTexture,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  KeepStencilOp,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NeutralToneMapping,
  NotEqualStencilFunc,
  OneFactor,
  PerspectiveCamera,
  Points,
  RepeatWrapping,
  ReplaceStencilOp,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  NoColorSpace,
  Texture,
  CanvasTexture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor,
  OrthographicCamera,
  PlaneGeometry,
  NoToneMapping,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { AtlasLayer, AtlasPoint, BBox } from "../../types/domain";
import {
  ATMO_FRAG,
  ATMO_VERT,
  BAKE_VERT,
  CLOUD_BAKE_FRAG,
  GLOBE_FRAG,
  GLOBE_VERT,
  MARKER_FRAG,
  MARKER_VERT,
  STAR_FRAG,
  STAR_VERT,
  patchLineShader,
} from "./shaders";
import {
  DEG,
  angularDistance,
  bboxToSegments,
  clamp,
  fillBBoxEquirect,
  fillGeometryEquirect,
  getLandMaskCanvas,
  graticuleSegments,
  hexToRgb,
  multiLineToSegments,
  polygonToSegments,
  wrap180,
} from "./geo";
import { countryAt, countryMeshes, findCountry, getBestLoadedCountries, loadCountries, loadLand, type CountryData } from "./countries";
import {
  DEFAULT_ATLAS_FILTER,
  EARTH_COLORS,
  atlasKind,
  atlasMarkerSize,
  atlasPasses,
  atlasSlopeScale,
  normalizeBBox,
  type AtlasFilter,
  type EarthFraming,
  type EarthMode,
  type EarthQuality,
  type FocusSpec,
  type GlobeRegion,
  type OverlaySpec,
  type PickInfo,
} from "./types";

export type { PickInfo } from "./types";

export interface EarthEngineCallbacks {
  onHover?: (info: PickInfo | null) => void;
  onSelect?: (info: PickInfo) => void;
  onBoxSelect?: (bbox: BBox) => void;
  onReady?: () => void;
  onError?: (err: Error) => void;
  /** WebGL context lost (the engine waits for a restore). */
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /** Fired when a globe⇄map transition completes. */
  onModeSettled?: (mode: EarthMode) => void;
}

export interface EarthEngineOptions extends EarthEngineCallbacks {
  mode?: EarthMode;
  interactive?: boolean;
  autoRotate?: boolean;
  framing?: EarthFraming;
  overlay?: OverlaySpec | null;
  atlas?: AtlasLayer | null;
  atlasFilter?: AtlasFilter;
  regions?: GlobeRegion[];
  showBorders?: boolean;
  showGraticule?: boolean;
  showNight?: boolean;
  showClouds?: boolean;
  showAtmosphere?: boolean;
  showStars?: boolean;
  focus?: FocusSpec | null;
  drawMode?: boolean;
  quality?: EarthQuality;
  /** Base URL of the Earth textures (default "/textures/"). */
  textureBaseUrl?: string;
  /** Override prefers-reduced-motion detection. */
  reducedMotion?: boolean;
  ariaLabel?: string;
  /** Initial view centre. */
  initialView?: { lon: number; lat: number };
}

/* ------------------------------------------------------------------------ */

const FOV = 30;
const TAN_HALF = Math.tan((FOV / 2) * DEG);
const MORPH_MS = 1400;
// camera-relative sun ("studio" key light). Centre framing: upper-left key, night crescent on the right.
// Hero framing: key from the right so the night limb (city lights) faces the copy and melts into the page.
const SUN_CENTER = { lon: -50, lat: 16 };
const SUN_HERO = { lon: 62, lat: 14 };
const AUTOROTATE_DEG_S = 2.4;
const IDLE_RESUME_MS = 7000;
const GLOBE_MIN_ALT = 0.32;
const MAP_MIN_ALT = 0.025;
const ATMO_THICKNESS = 0.045;
const REVEAL_TIMEOUT_MS = 2600;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Q = "high" | "low";
interface QualitySettings {
  tier: Q;
  texRes: "4k" | "2k";
  segX: number;
  segY: number;
  dprCap: number;
  cloudW: number;
}

/** Linear-ish animated scalar (exponential approach). */
class Anim {
  value: number;
  target: number;
  constructor(v: number, private rate = 6) {
    this.value = v;
    this.target = v;
  }
  set(t: number, instant = false) {
    this.target = t;
    if (instant) this.value = t;
  }
  step(dt: number): boolean {
    const d = this.target - this.value;
    if (Math.abs(d) < 1e-3) {
      this.value = this.target;
      return false;
    }
    this.value += d * (1 - Math.exp(-dt * this.rate));
    return true;
  }
}

interface LineLayer {
  obj: LineSegments2;
  mat: LineMaterial;
  geo: LineSegmentsGeometry;
  width: number; // CSS px
  amt: Anim;
  baseOpacity: number;
  fade: { value: Vector2 };
}

interface OverlaySlot {
  tex: Texture | null;
  url: string | null;
  op: Anim;
  bitmap: ImageBitmap | null;
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const s = document.createElement("style");
  s.setAttribute("data-earthscope-globe", "");
  s.textContent = `@layer base{.es-globe-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;-webkit-tap-highlight-color:transparent}.es-globe-canvas:focus-visible{outline:2px solid ${EARTH_COLORS.cyan};outline-offset:-2px;border-radius:inherit}}`;
  document.head.appendChild(s);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/* ======================================================================== */

export class EarthEngine {
  readonly canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.05, 200);
  private cb: EarthEngineCallbacks = {};

  // ---- options / props ----------------------------------------------------
  private modeTarget: EarthMode = "globe";
  private interactive = true;
  private autoRotate = false;
  private framing: EarthFraming = "center";
  private drawMode = false;
  private qualityPref: EarthQuality = "auto";
  private q: QualitySettings;
  private textureBase = "/textures/";
  private reducedMotion = false;
  private reducedMotionForced: boolean | undefined;
  private atlasFilter: AtlasFilter = DEFAULT_ATLAS_FILTER;

  // ---- shared morph uniforms ---------------------------------------------
  private u = {
    uMorph: { value: 0 },
    uLon0: { value: 0 },
    uLat0: { value: 0 },
    uLiftUnit: { value: 0.001 },
  };
  private lineU = { uSunEarth: { value: new Vector3(1, 0, 0) }, uLineNight: { value: 0 } };

  // ---- view state ---------------------------------------------------------
  private cur = { lon: 0, lat: 18 };
  private tgt = { lon: 0, lat: 18 };
  private gZoom = 1; // globe altitude multiplier (relative to framing default)
  private gZoomT = 1;
  private mAlt = 7;
  private mAltT = 7;
  private morph = 0;
  private morphTween: { from: number; to: number; start: number; dur: number } | null = null;
  private fly: { from: { lon: number; lat: number; z: number }; to: { lon: number; lat: number; z: number }; start: number; dur: number; hop: number; mode: EarthMode } | null = null;
  private vel = { lon: 0, lat: 0 };
  private shift = { x: 0, y: 0 };
  private shiftT = { x: 0, y: 0 };
  private sun = { lon: SUN_CENTER.lon, lat: SUN_CENTER.lat };
  private parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  private intro: { start: number; dur: number; lon: number } | null = null;
  private lastInteraction = -1e9;
  private crossfadeTimer = 0;

  // ---- scene objects ------------------------------------------------------
  private globe!: Mesh<BufferGeometry, ShaderMaterial>;
  private globeMat!: ShaderMaterial;
  private atmo!: Mesh<SphereGeometry, ShaderMaterial>;
  private stars!: Points<BufferGeometry, ShaderMaterial>;
  private markers: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null;
  private markerMat!: ShaderMaterial;
  private markerPoints: AtlasPoint[] = [];
  private lines: Record<"gratMinor" | "gratMajor" | "borders" | "coasts" | "regionHalo" | "region" | "draw", LineLayer> = {} as never;
  private stencilRef = 1;

  // ---- textures -----------------------------------------------------------
  private placeholder: DataTexture;
  private placeholderClear: DataTexture;
  private dayTex: Texture | null = null;
  private nightTex: Texture | null = null;
  private dayBitmap: ImageBitmap | null = null;
  private nightBitmap: ImageBitmap | null = null;
  private idleTimer = 0;
  private landTex: CanvasTexture | null = null;
  private regionCanvas: HTMLCanvasElement | null = null;
  private regionTex: CanvasTexture | null = null;
  private cloudRT: WebGLRenderTarget | null = null;
  private bitmaps = new Set<ImageBitmap>();
  private overlayA: OverlaySlot;
  private overlayB: OverlaySlot;
  private overlaySpec: OverlaySpec | null = null;
  private overlayAbort: AbortController | null = null;
  private abort = new AbortController();

  // ---- animated scalars ---------------------------------------------------
  private aDay = new Anim(0, 3.5);
  private aNight = new Anim(1, 5);
  private aClouds = new Anim(1, 5);
  private aAtmo = new Anim(1, 5);
  private aStars = new Anim(1, 4);
  private aBaseDim = new Anim(0, 5);
  private aMarkers = new Anim(0, 5);
  private showClouds = true;

  // ---- data state ---------------------------------------------------------
  private atlas: AtlasLayer | null = null;
  private regionsKey = "";
  private regions: GlobeRegion[] = [];
  private bordersRes: "110m" | "50m" | null = null;
  private focusKey = "";

  // ---- interaction --------------------------------------------------------
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; t: number; lon: number; lat: number; moved: boolean; samples: { t: number; lon: number; lat: number }[] } | null = null;
  private pinch: { d0: number; g0: number; m0: number; lon0: number; lat0: number; mx: number; my: number } | null = null;
  private drawing: { lon0: number; lat0: number; lon1: number; lat1: number } | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private hoverRaf = 0;
  private hoverIndex = -1;
  private lastHoverKey = "";

  // ---- loop ----------------------------------------------------------------
  private raf = 0;
  private dirty = true;
  private lastFrame = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private onScreen = true;
  private pageVisible = true;
  private contextLost = false;
  private disposed = false;
  private revealed = false;
  private readyFired = false;
  private revealTimer = 0;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private mql: MediaQueryList | null = null;

  constructor(container: HTMLElement, options: EarthEngineOptions = {}) {
    injectStyle();
    this.container = container;
    this.cb = pickCallbacks(options);
    this.reducedMotionForced = options.reducedMotion;
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    this.textureBase = options.textureBaseUrl ?? "/textures/";
    this.qualityPref = options.quality ?? "auto";
    this.framing = options.framing ?? "center";
    this.modeTarget = options.mode ?? "globe";
    this.morph = this.modeTarget === "map" ? 1 : 0;
    if (options.initialView) {
      this.cur.lon = this.tgt.lon = options.initialView.lon;
      this.cur.lat = this.tgt.lat = clamp(options.initialView.lat, -85, 85);
    } else {
      // open on Europe/Africa: recognisable, with city lights along the night limb
      this.cur.lon = this.tgt.lon = this.framing === "hero-right" ? 34 : 12;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "es-globe-canvas";
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity 900ms cubic-bezier(0.2, 0, 0, 1)";
    this.canvas = canvas;

    this.q = this.resolveQuality();
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
        stencil: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error("WebGL renderer could not be created");
    }
    this.renderer = renderer;
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = SRGBColorSpace;
    if (renderer.capabilities.maxTextureSize < 4096) this.q.texRes = "2k";

    container.appendChild(canvas);

    this.placeholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
    this.placeholder.needsUpdate = true;
    this.placeholderClear = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
    this.placeholderClear.needsUpdate = true;
    this.overlayA = { tex: null, url: null, op: new Anim(0, 5), bitmap: null };
    this.overlayB = { tex: null, url: null, op: new Anim(0, 5), bitmap: null };

    this.buildScene();
    this.measure();
    this.attachEvents();

    // ---- apply initial options ----
    this.setInteractive(options.interactive ?? true);
    this.setAutoRotate(options.autoRotate ?? false);
    this.setShowNight(options.showNight ?? true);
    this.setShowClouds(options.showClouds ?? true);
    this.setShowAtmosphere(options.showAtmosphere ?? true);
    this.setShowStars(options.showStars ?? true);
    this.setShowBorders(options.showBorders ?? true);
    this.setShowGraticule(options.showGraticule ?? false);
    this.setAtlasFilter(options.atlasFilter ?? DEFAULT_ATLAS_FILTER);
    this.setAtlas(options.atlas ?? null);
    this.setRegions(options.regions ?? []);
    this.setOverlay(options.overlay ?? null);
    this.setDrawMode(options.drawMode ?? false);
    this.setAriaLabel(options.ariaLabel);
    this.snapFraming();
    if (this.modeTarget === "map") {
      this.mAlt = this.mAltT = this.mapFitAlt();
      this.cur.lat = this.tgt.lat = this.clampMapLat(this.cur.lat, this.mAltT);
    }
    if (options.focus) this.setFocus(options.focus, true);

    // ---- async resources ----
    this.bakeClouds();
    void this.loadBaseData();
    void this.loadTextures();
    this.revealTimer = window.setTimeout(() => this.reveal(), REVEAL_TIMEOUT_MS);
    this.invalidate();
  }

  /* ====================================================================== */
  /* Public API                                                             */
  /* ====================================================================== */

  setCallbacks(cb: EarthEngineCallbacks): void {
    this.cb = { ...this.cb, ...pickCallbacks(cb) };
  }

  setMode(mode: EarthMode, opts: { instant?: boolean } = {}): void {
    if (mode === this.modeTarget && !opts.instant) return;
    this.modeTarget = mode;
    this.cancelDrawing();
    this.fly = null;
    this.vel.lon = this.vel.lat = 0;
    const to = mode === "map" ? 1 : 0;
    // prepare the destination camera state
    if (mode === "map") {
      const gAlt = this.globeAlt(this.gZoom);
      const fit = this.mapFitAlt();
      this.mAlt = this.mAltT = gAlt < 1.3 ? clamp(gAlt * 1.1, MAP_MIN_ALT, fit) : fit;
    } else {
      const base = this.framingParams().alt;
      const z = this.mAltT < this.mapFitAlt() * 0.5 ? clamp((this.mAltT * 1.1) / base, GLOBE_MIN_ALT / base, 1) : 1;
      this.gZoom = this.gZoomT = z;
      this.cur.lat = this.tgt.lat = clamp(this.cur.lat, -80, 80);
    }
    if (opts.instant || !this.revealed) {
      this.morphTween = null;
      this.morph = to;
      this.settleMorph();
      this.invalidate();
      return;
    }
    if (this.reducedMotion) {
      // 250 ms crossfade (out → snap → in) instead of the unfold
      window.clearTimeout(this.crossfadeTimer);
      this.canvas.style.transition = "opacity 125ms linear";
      this.canvas.style.opacity = "0";
      this.crossfadeTimer = window.setTimeout(() => {
        if (this.disposed) return;
        this.morphTween = null;
        this.morph = to;
        this.settleMorph();
        this.renderNow();
        this.canvas.style.opacity = "1";
      }, 125);
      return;
    }
    const from = this.morph;
    const dur = MORPH_MS * Math.max(0.35, Math.abs(to - from));
    this.morphTween = { from, to, start: performance.now(), dur };
    this.invalidate();
  }

  setInteractive(v: boolean): void {
    this.interactive = v;
    this.canvas.tabIndex = v ? 0 : -1;
    this.canvas.style.touchAction = v ? "none" : "auto";
    this.canvas.style.cursor = v ? (this.drawMode && this.modeTarget === "map" ? "crosshair" : "grab") : "default";
    if (v) {
      this.canvas.setAttribute("role", "application");
      this.canvas.setAttribute("aria-roledescription", "interactive Earth");
    } else {
      this.canvas.setAttribute("role", "img");
      this.canvas.removeAttribute("aria-roledescription");
      this.parallax.tx = this.parallax.ty = 0;
    }
    this.setAriaLabel(this.canvas.getAttribute("data-label") ?? undefined);
    if (!v) this.emitHover(null);
  }

  setAriaLabel(label?: string): void {
    if (label) this.canvas.setAttribute("data-label", label);
    const l =
      label ??
      (this.interactive
        ? "Interactive Earth. Drag to rotate or pan, scroll or plus and minus to zoom, arrow keys to move, Enter to select the centre point."
        : "Rotating view of planet Earth");
    this.canvas.setAttribute("aria-label", l);
  }

  setAutoRotate(v: boolean): void {
    this.autoRotate = v;
    this.invalidate();
  }

  setFraming(f: EarthFraming): void {
    if (f === this.framing) return;
    this.framing = f;
    const fp = this.framingParams();
    this.shiftT.x = fp.shiftX;
    this.shiftT.y = fp.shiftY;
    this.invalidate();
  }

  setQuality(q: EarthQuality): void {
    if (q === this.qualityPref) return;
    this.qualityPref = q;
    const next = this.resolveQuality();
    if (this.renderer.capabilities.maxTextureSize < 4096) next.texRes = "2k";
    const prev = this.q;
    this.q = next;
    if (prev.segX !== next.segX) {
      const old = this.globe.geometry;
      this.globe.geometry = buildGridGeometry(next.segX, next.segY);
      old.dispose();
    }
    if (prev.dprCap !== next.dprCap) this.measure();
    if (prev.texRes !== next.texRes) void this.loadTextures();
    if (prev.cloudW !== next.cloudW) this.bakeClouds();
    if (next.tier === "high" && this.bordersRes !== "50m") void this.upgradeBorders();
    this.invalidate();
  }

  setShowNight(v: boolean): void {
    this.aNight.set(v ? 1 : 0, !this.revealed);
    this.invalidate();
  }
  setShowClouds(v: boolean): void {
    this.showClouds = v;
    this.updateCloudTarget(!this.revealed);
  }
  setShowAtmosphere(v: boolean): void {
    this.aAtmo.set(v ? 1 : 0, !this.revealed);
    this.invalidate();
  }
  setShowStars(v: boolean): void {
    this.aStars.set(v ? 1 : 0, !this.revealed);
    this.invalidate();
  }
  setShowBorders(v: boolean): void {
    this.lines.borders.amt.set(v ? 1 : 0, !this.revealed);
    this.lines.coasts.amt.set(v ? 1 : 0, !this.revealed);
    this.invalidate();
  }
  setShowGraticule(v: boolean): void {
    this.lines.gratMinor.amt.set(v ? 1 : 0, !this.revealed);
    this.lines.gratMajor.amt.set(v ? 1 : 0, !this.revealed);
    this.invalidate();
  }

  setDrawMode(v: boolean): void {
    this.drawMode = v;
    if (!v) this.cancelDrawing();
    this.setInteractive(this.interactive);
  }

  setOverlay(spec: OverlaySpec | null): void {
    const prev = this.overlaySpec;
    this.overlaySpec = spec;
    this.updateCloudTarget();
    if (!spec) {
      this.overlayAbort?.abort();
      this.overlayB.op.set(0);
      this.overlayA.op.set(0);
      this.invalidate();
      return;
    }
    const opacity = clamp(spec.opacity, 0, 1);
    if (prev && prev.url === spec.url && this.overlayB.url === spec.url) {
      this.overlayB.op.set(opacity);
      this.invalidate();
      return;
    }
    if (prev && prev.url === spec.url) return; // still loading the same url; opacity applied on load
    this.overlayAbort?.abort();
    const ac = new AbortController();
    this.overlayAbort = ac;
    const url = spec.url;
    this.loadTexture(url, { premultiply: true, signal: ac.signal })
      .then(({ tex, bitmap }) => {
        if (this.disposed || ac.signal.aborted || this.overlaySpec?.url !== url) {
          tex.dispose();
          if (bitmap) this.closeBitmap(bitmap);
          return;
        }
        this.configureTexture(tex, true);
        this.renderer.initTexture(tex);
        // B → A (fade out), new → B (fade in)
        this.releaseSlot(this.overlayA);
        this.overlayA.tex = this.overlayB.tex;
        this.overlayA.url = this.overlayB.url;
        this.overlayA.bitmap = this.overlayB.bitmap;
        this.overlayA.op.value = this.overlayB.op.value;
        this.overlayA.op.set(0);
        this.overlayB.tex = tex;
        this.overlayB.url = url;
        this.overlayB.bitmap = bitmap;
        this.overlayB.op.set(0, true);
        this.overlayB.op.set(clamp(this.overlaySpec?.opacity ?? opacity, 0, 1));
        this.invalidate();
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || this.disposed) return;
        this.cb.onError?.(err instanceof Error ? err : new Error(`Overlay failed to load: ${url}`));
      });
  }

  setAtlas(atlas: AtlasLayer | null): void {
    if (atlas === this.atlas) return;
    this.atlas = atlas;
    this.rebuildMarkers(true);
  }

  setAtlasFilter(f: AtlasFilter): void {
    const prev = this.atlasFilter;
    if (prev.direction === f.direction && prev.significance === f.significance) return;
    this.atlasFilter = { ...f };
    this.rebuildMarkers(false);
  }

  setRegions(regions: GlobeRegion[] | null | undefined): void {
    const list = regions ?? [];
    const key = JSON.stringify(list.map((r) => [r.id, r.countryId ?? "", r.color ?? "", r.bbox.west, r.bbox.south, r.bbox.east, r.bbox.north]));
    if (key === this.regionsKey) return;
    this.regionsKey = key;
    this.regions = list;
    // a confirmed box replaces the dashed draft
    this.clearDrawRect();
    this.rebuildRegions();
    if (list.some((r) => r.countryId) && !getBestLoadedCountries()) {
      void loadCountries("110m").then(() => {
        if (!this.disposed && this.regionsKey === key) this.rebuildRegions();
      });
    }
  }

  setFocus(focus: FocusSpec | null | undefined, instant = false): void {
    if (!focus) {
      this.focusKey = "";
      return;
    }
    const key = `${focus.lon}|${focus.lat}|${focus.distance ?? ""}`;
    if (key === this.focusKey && !instant) return;
    this.focusKey = key;
    this.flyTo(focus.lon, focus.lat, focus.distance, instant || this.reducedMotion);
  }

  /** Smooth eased camera flight. distance = altitude above the surface in Earth radii. */
  flyTo(lon: number, lat: number, distance?: number, instant = false): void {
    this.vel.lon = this.vel.lat = 0;
    this.markInteraction();
    const mode = this.modeTarget;
    const dLon = wrap180(lon - this.cur.lon);
    const toLon = this.cur.lon + dLon;
    const isMap = mode === "map";
    const fromZ = isMap ? this.mAlt : this.gZoom;
    const base = this.framingParams().alt;
    let toZ = fromZ;
    if (distance != null && Number.isFinite(distance)) {
      toZ = isMap ? clamp(distance, MAP_MIN_ALT, this.mapFitAlt()) : clamp(distance / base, GLOBE_MIN_ALT / base, 1.6);
    }
    const toLat = isMap ? this.clampMapLat(lat, toZ) : clamp(lat, -85, 85);
    if (instant) {
      this.fly = null;
      this.cur.lon = this.tgt.lon = toLon;
      this.cur.lat = this.tgt.lat = toLat;
      if (isMap) this.mAlt = this.mAltT = toZ;
      else this.gZoom = this.gZoomT = toZ;
      this.invalidate();
      return;
    }
    const ang = angularDistance(this.cur.lon, this.cur.lat, lon, lat);
    this.fly = {
      from: { lon: this.cur.lon, lat: this.cur.lat, z: fromZ },
      to: { lon: toLon, lat: toLat, z: toZ },
      start: performance.now(),
      dur: clamp(900 + ang * 7, 900, 2000),
      hop: isMap ? 0 : Math.min(0.45, (ang / 180) * 0.6),
      mode,
    };
    this.invalidate();
  }

  /** Screen position (container CSS px) of a lon/lat in the current state. */
  project(lon: number, lat: number): { x: number; y: number; visible: boolean } {
    const n = new Vector3();
    const p = morphJS(wrapRad((lon * DEG) - this.u.uLon0.value), lat * DEG, this.morph, this.u.uLat0.value, n);
    const facing = n.dot(new Vector3().copy(this.camera.position).sub(p).normalize());
    p.project(this.camera);
    return {
      x: ((p.x + 1) / 2) * this.width,
      y: ((1 - p.y) / 2) * this.height,
      visible: facing > 0 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
    };
  }

  getView(): { lon: number; lat: number; altitude: number; mode: EarthMode; morph: number } {
    return {
      lon: wrap180(this.cur.lon),
      lat: this.cur.lat,
      altitude: this.modeTarget === "map" ? this.mAlt : this.globeAlt(this.gZoom),
      mode: this.modeTarget,
      morph: this.morph,
    };
  }

  /** Development aid: freeze the morph at a given value (null = release). */
  debugSetMorph(m: number | null): void {
    if (m == null) {
      this.settleMorph();
      return;
    }
    this.morphTween = null;
    this.morph = clamp(m, 0, 1);
    if (this.mAltT >= this.mapFitAlt() * 0.99 || m > 0) this.mAlt = this.mAltT = this.mapFitAlt();
    this.invalidate();
  }

  /** Development aid: jump every running fade/tween to its end state. */
  debugSettle(): void {
    for (const a of [this.aDay, this.aNight, this.aClouds, this.aAtmo, this.aStars, this.aBaseDim, this.aMarkers, this.overlayA.op, this.overlayB.op]) a.value = a.target;
    for (const l of Object.values(this.lines)) l.amt.value = l.amt.target;
    this.intro = null;
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.hoverRaf);
    window.clearTimeout(this.revealTimer);
    window.clearTimeout(this.crossfadeTimer);
    window.clearTimeout(this.idleTimer);
    this.abort.abort();
    this.overlayAbort?.abort();
    this.detachEvents();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: ShaderMaterial | ShaderMaterial[] }).material;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of mats) x.dispose();
    });
    for (const t of [this.dayTex, this.nightTex, this.landTex, this.regionTex, this.overlayA.tex, this.overlayB.tex, this.placeholder, this.placeholderClear]) t?.dispose();
    this.cloudRT?.dispose();
    for (const b of this.bitmaps) b.close();
    this.bitmaps.clear();
    this.renderer.dispose();
    if (!this.contextLost && !this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  /* ====================================================================== */
  /* Scene construction                                                     */
  /* ====================================================================== */

  private buildScene(): void {
    const u = this.u;
    // ---- globe ----
    this.globeMat = new ShaderMaterial({
      vertexShader: GLOBE_VERT,
      fragmentShader: GLOBE_FRAG,
      uniforms: {
        ...u,
        uDay: { value: this.placeholder },
        uNight: { value: this.placeholder },
        uLand: { value: this.placeholder },
        uClouds: { value: this.placeholder },
        uRegion: { value: this.placeholderClear },
        uOverlayA: { value: this.placeholderClear },
        uOverlayB: { value: this.placeholderClear },
        uDayMix: { value: 0 },
        uNightTex: { value: 0 },
        uNightAmt: { value: 1 },
        uCloudAmt: { value: 1 },
        uAtmoAmt: { value: 1 },
        uOverlayOpA: { value: 0 },
        uOverlayOpB: { value: 0 },
        uBaseDim: { value: 0 },
        uSunDir: { value: new Vector3(0, 0, 1) },
        uSubsolar: { value: new Vector2(0, 0) },
      },
    });
    this.globe = new Mesh(buildGridGeometry(this.q.segX, this.q.segY), this.globeMat);
    this.globe.frustumCulled = false;
    this.globe.renderOrder = 0;
    this.scene.add(this.globe);

    // ---- line layers (shared morph chunk via onBeforeCompile) ----
    const g = graticuleSegments(15, 1);
    this.lines.gratMinor = this.makeLineLayer(g.minor, EARTH_COLORS.line, 0.12, 1, 2, [0.02, 0.3]);
    this.lines.gratMajor = this.makeLineLayer(g.major, EARTH_COLORS.ice, 0.24, 1, 3, [0.02, 0.3]);
    this.lines.coasts = this.makeLineLayer(new Float32Array(0), EARTH_COLORS.ice, 0.3, 1, 4, [-0.02, 0.14]);
    this.lines.borders = this.makeLineLayer(new Float32Array(0), EARTH_COLORS.line, 0.24, 1, 5, [-0.02, 0.14]);
    this.lines.regionHalo = this.makeLineLayer(new Float32Array(0), EARTH_COLORS.ice, 0.13, 7, 6, [-0.05, 0.1], true);
    this.lines.region = this.makeLineLayer(new Float32Array(0), EARTH_COLORS.ice, 1, 2.5, 7, [-0.05, 0.1], true);
    this.lines.draw = this.makeLineLayer(new Float32Array(0), EARTH_COLORS.cyan, 1, 1.5, 9, [-1, -0.5], false, true);
    this.lines.draw.mat.depthTest = false;
    for (const k of ["regionHalo", "region", "draw"] as const) this.lines[k].amt.set(1, true);

    // ---- atmosphere shell ----
    const atmoMat = new ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        uSunDir: { value: new Vector3(0, 0, 1) },
        uAmount: { value: 1 },
        uThickness: { value: ATMO_THICKNESS },
        uNight: { value: 1 },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    this.atmo = new Mesh(new SphereGeometry(1 + ATMO_THICKNESS, 128, 64), atmoMat);
    this.atmo.frustumCulled = false;
    this.atmo.renderOrder = 8;
    this.scene.add(this.atmo);

    // ---- stars (very sparse, static) ----
    const N = 320;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const bright = new Float32Array(N);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < N; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(a) * 90, z * 90, r * Math.sin(a) * 90 - 20], i * 3);
      const k = rnd();
      size[i] = 1 + k * k * 1.6;
      bright[i] = 0.12 + Math.pow(rnd(), 3) * 0.55;
    }
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(pos, 3));
    sg.setAttribute("aSize", new BufferAttribute(size, 1));
    sg.setAttribute("aBright", new BufferAttribute(bright, 1));
    const starMat = new ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uPixelRatio: { value: 1 }, uAmount: { value: 1 } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    this.stars = new Points(sg, starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);

    // ---- marker material (geometry built per atlas) ----
    this.markerMat = new ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: {
        ...u,
        uResolution: { value: new Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uScale: { value: 1 },
        uHover: { value: -1 },
        uAppear: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  private makeLineLayer(
    segs: Float32Array,
    color: string,
    opacity: number,
    width: number,
    order: number,
    fade: [number, number],
    vertexColors = false,
    dashed = false,
  ): LineLayer {
    const geo = new LineSegmentsGeometry();
    if (segs.length) geo.setPositions(segs);
    const fadeU = { value: new Vector2(fade[0], fade[1]) };
    const mat = new LineMaterial({
      color: vertexColors ? "#ffffff" : color,
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      vertexColors,
      dashed,
      dashSize: 1,
      gapSize: 1,
    });
    Object.assign(mat.uniforms, this.u, this.lineU, { uFade: fadeU });
    // one draw per pixel per layer: no alpha build-up at segment joints / crossings
    mat.stencilWrite = true;
    mat.stencilRef = this.stencilRef++;
    mat.stencilFunc = NotEqualStencilFunc;
    mat.stencilZPass = ReplaceStencilOp;
    mat.stencilFail = KeepStencilOp;
    mat.stencilZFail = KeepStencilOp;
    mat.onBeforeCompile = (shader) => patchLineShader(shader);
    mat.customProgramCacheKey = () => "es-morph-line";
    const obj = new LineSegments2(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = order;
    obj.visible = segs.length > 0;
    this.scene.add(obj);
    return { obj, mat, geo, width, amt: new Anim(0, 6), baseOpacity: opacity, fade: fadeU };
  }

  private setLineSegments(layer: LineLayer, segs: Float32Array, colors?: Float32Array): void {
    const old = layer.geo;
    const geo = new LineSegmentsGeometry();
    if (segs.length) {
      geo.setPositions(segs);
      if (colors) geo.setColors(colors);
    }
    layer.obj.geometry = geo;
    layer.geo = geo;
    old.dispose();
    if (segs.length && layer.mat.dashed) layer.obj.computeLineDistances();
    this.invalidate();
  }

  /* ====================================================================== */
  /* Data / resources                                                       */
  /* ====================================================================== */

  private async loadBaseData(): Promise<void> {
    try {
      const land = await loadLand();
      if (this.disposed) return;
      const c = getLandMaskCanvas(land, 2048, 1024);
      const tex = new CanvasTexture(c);
      tex.colorSpace = NoColorSpace;
      tex.wrapS = RepeatWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.landTex = tex;
      this.globeMat.uniforms.uLand.value = tex;
      this.invalidate();
    } catch (e) {
      this.reportSoft(e);
    }
    try {
      const data = await loadCountries("110m");
      if (this.disposed) return;
      if (!this.bordersRes) this.applyBorders(data);
      this.rebuildRegions();
      if (this.q.tier === "high") void this.upgradeBorders();
    } catch (e) {
      this.reportSoft(e);
    }
  }

  private async upgradeBorders(): Promise<void> {
    try {
      const data = await loadCountries("50m");
      if (this.disposed) return;
      this.applyBorders(data);
      this.rebuildRegions();
    } catch {
      /* 110m remains */
    }
  }

  private applyBorders(data: CountryData): void {
    const { borders, coasts } = countryMeshes(data);
    this.setLineSegments(this.lines.borders, multiLineToSegments(borders, 1.2));
    this.setLineSegments(this.lines.coasts, multiLineToSegments(coasts, 1.2));
    this.bordersRes = data.resolution;
  }

  private async loadTextures(): Promise<void> {
    const res = this.q.texRes;
    const base = this.textureBase.endsWith("/") ? this.textureBase : this.textureBase + "/";
    const signal = this.abort.signal;
    const tryLoad = async (names: string[]) => {
      for (const n of names) {
        try {
          return await this.loadTexture(base + n, { premultiply: false, signal });
        } catch (e) {
          if (signal.aborted) throw e;
        }
      }
      return null;
    };
    // progressive: 2k first (fast first paint), then 4k when on the high tier
    const day = await tryLoad(["earth-day-2k.jpg", "earth-day-4k.jpg"]).catch(() => null);
    if (this.disposed) return;
    if (day) this.applyDay(day.tex, day.bitmap);
    else if (import.meta.env?.DEV) {
      // graceful degrade: the procedural land/ocean surface (land-110m mask) stays on
      console.warn(`[EarthEngine] no day texture under ${base} — using the vector land/ocean surface`);
    }
    this.reveal();
    const night = await tryLoad([`earth-night-${res}.jpg`, "earth-night-2k.jpg"]).catch(() => null);
    if (this.disposed) return;
    if (night) {
      this.configureTexture(night.tex, false);
      this.renderer.initTexture(night.tex);
      this.nightTex?.dispose();
      if (this.nightBitmap) this.closeBitmap(this.nightBitmap);
      this.nightTex = night.tex;
      this.nightBitmap = night.bitmap;
      this.globeMat.uniforms.uNight.value = night.tex;
      this.globeMat.uniforms.uNightTex.value = 1;
      this.invalidate();
    }
    if (res === "4k" && day) {
      const hi = await tryLoad(["earth-day-4k.jpg"]).catch(() => null);
      if (this.disposed) return;
      if (hi && this.q.texRes === "4k") this.applyDay(hi.tex, hi.bitmap);
    }
  }

  private applyDay(tex: Texture, bitmap: ImageBitmap | null): void {
    this.configureTexture(tex, false);
    this.renderer.initTexture(tex);
    const old = this.dayTex;
    this.dayTex = tex;
    this.globeMat.uniforms.uDay.value = tex;
    if (old) old.dispose();
    if (this.dayBitmap) this.closeBitmap(this.dayBitmap);
    this.dayBitmap = bitmap;
    this.aDay.set(1, !this.revealed);
    this.invalidate();
  }

  private configureTexture(tex: Texture, overlay: boolean): void {
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    void overlay; // premultiplication is decided at decode time (see loadTexture)
    tex.needsUpdate = true;
  }

  private async loadTexture(url: string, o: { premultiply: boolean; signal: AbortSignal }): Promise<{ tex: Texture; bitmap: ImageBitmap | null }> {
    if (typeof createImageBitmap === "function") {
      try {
        const res = await fetch(url, { signal: o.signal, mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const blob = await res.blob();
        if (!blob.type.startsWith("image/") && blob.type !== "" && blob.type !== "application/octet-stream") throw new Error(`Not an image: ${url}`);
        const bmp = await createImageBitmap(blob, {
          imageOrientation: "flipY",
          premultiplyAlpha: o.premultiply ? "premultiply" : "none",
          colorSpaceConversion: "none",
        });
        if (o.signal.aborted || this.disposed) {
          bmp.close();
          throw new DOMException("aborted", "AbortError");
        }
        this.bitmaps.add(bmp);
        const tex = new Texture(bmp);
        tex.flipY = false;
        tex.premultiplyAlpha = false;
        return { tex, bitmap: bmp };
      } catch (e) {
        if (o.signal.aborted) throw e;
        if (e instanceof Error && /^HTTP|Not an image/.test(e.message)) throw e;
        // fall through to <img> decoding
      }
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (o.signal.aborted) throw new DOMException("aborted", "AbortError");
    const tex = new Texture(img);
    tex.flipY = true;
    tex.premultiplyAlpha = o.premultiply;
    return { tex, bitmap: null };
  }

  private closeBitmap(b: ImageBitmap) {
    b.close();
    this.bitmaps.delete(b);
  }

  private releaseSlot(s: OverlaySlot): void {
    s.tex?.dispose();
    if (s.bitmap) this.closeBitmap(s.bitmap);
    s.tex = null;
    s.bitmap = null;
    s.url = null;
  }

  private bakeClouds(): void {
    const w = this.q.cloudW;
    const h = w / 2;
    if (!this.cloudRT || this.cloudRT.width !== w) {
      this.cloudRT?.dispose();
      this.cloudRT = new WebGLRenderTarget(w, h, {
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.cloudRT.texture.colorSpace = NoColorSpace;
    }
    const mat = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: CLOUD_BAKE_FRAG, depthTest: false, depthWrite: false });
    const geo = new PlaneGeometry(2, 2);
    const quad = new Mesh(geo, mat);
    const sc = new Scene();
    sc.add(quad);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevTM = this.renderer.toneMapping;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setRenderTarget(this.cloudRT);
    this.renderer.render(sc, cam);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = prevTM;
    geo.dispose();
    mat.dispose();
    this.globeMat.uniforms.uClouds.value = this.cloudRT!.texture;
    this.invalidate();
  }

  /* ---------------------------- regions ---------------------------------- */

  private rebuildRegions(): void {
    const data = getBestLoadedCountries();
    const segParts: number[] = [];
    const colParts: number[] = [];
    // fill mask (premultiplied, sampled by the globe shader → glued through the morph)
    const W = this.q.tier === "high" ? 2048 : 1024;
    const H = W / 2;
    if (!this.regionCanvas || this.regionCanvas.width !== W) {
      this.regionCanvas = document.createElement("canvas");
      this.regionCanvas.width = W;
      this.regionCanvas.height = H;
      this.regionTex?.dispose();
      this.regionTex = null;
    }
    const ctx = this.regionCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, W, H);
    for (const r of this.regions) {
      const color = r.color ?? EARTH_COLORS.ice;
      const [cr, cg, cb] = hexToRgb(color);
      const lin = new Color(color); // linear working space for line vertex colors
      let segs: Float32Array;
      const feat = r.countryId && data ? findCountry(r.countryId, data) : undefined;
      if (feat) segs = polygonToSegments(feat.geometry, 2, 2);
      else segs = bboxToSegments(normalizeBBox(r.bbox), 2, 1);
      for (let i = 0; i < segs.length; i++) segParts.push(segs[i]);
      for (let i = 0; i < segs.length / 6; i++) colParts.push(lin.r, lin.g, lin.b, lin.r, lin.g, lin.b);
      if (ctx) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.13)`;
        if (feat) fillGeometryEquirect(ctx, feat.geometry, W, H);
        else fillBBoxEquirect(ctx, normalizeBBox(r.bbox), W, H);
      }
    }
    const segs = new Float32Array(segParts);
    const cols = new Float32Array(colParts);
    this.setLineSegments(this.lines.region, segs, cols);
    this.setLineSegments(this.lines.regionHalo, segs, cols);
    this.lines.region.obj.visible = this.lines.regionHalo.obj.visible = segs.length > 0;
    if (!this.regionTex) {
      const t = new CanvasTexture(this.regionCanvas);
      t.colorSpace = SRGBColorSpace;
      t.premultiplyAlpha = true;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.anisotropy = 4;
      this.regionTex = t;
      this.globeMat.uniforms.uRegion.value = t;
    }
    this.regionTex.needsUpdate = true;
    this.invalidate();
  }

  /* ---------------------------- markers ---------------------------------- */

  private rebuildMarkers(newLayer: boolean): void {
    if (this.markers) {
      this.scene.remove(this.markers);
      this.markers.geometry.dispose();
      this.markers = null;
    }
    this.markerPoints = [];
    this.hoverIndex = -1;
    this.markerMat.uniforms.uHover.value = -1;
    const atlas = this.atlas;
    if (!atlas || !atlas.points.length) {
      this.aMarkers.set(0, true);
      this.aBaseDim.set(0);
      this.invalidate();
      return;
    }
    const scale = atlasSlopeScale(atlas.points);
    const pts = atlas.points.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && atlasPasses(p, this.atlasFilter));
    const n = pts.length;
    const ll = new Float32Array(n * 2);
    const size = new Float32Array(n);
    const kind = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const idx = new Float32Array(n);
    const cRise = new Color(EARTH_COLORS.rise);
    const cFall = new Color(EARTH_COLORS.fall);
    const cFlat = new Color(EARTH_COLORS.flat);
    pts.forEach((p, i) => {
      const k = atlasKind(p);
      ll[i * 2] = p.lon;
      ll[i * 2 + 1] = p.lat;
      size[i] = atlasMarkerSize(p, scale);
      kind[i] = k === "rise" ? 0 : k === "fall" ? 1 : 2;
      const c = k === "rise" ? cRise : k === "fall" ? cFall : cFlat;
      col.set([c.r, c.g, c.b], i * 3);
      idx[i] = i;
    });
    const geo = new InstancedBufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute("aLonLat", new InstancedBufferAttribute(ll, 2));
    geo.setAttribute("aSize", new InstancedBufferAttribute(size, 1));
    geo.setAttribute("aKind", new InstancedBufferAttribute(kind, 1));
    geo.setAttribute("aColor", new InstancedBufferAttribute(col, 3));
    geo.setAttribute("aIndex", new InstancedBufferAttribute(idx, 1));
    geo.instanceCount = n;
    const mesh = new Mesh(geo, this.markerMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.markers = mesh;
    this.markerPoints = pts;
    this.scene.add(mesh);
    if (newLayer) this.aMarkers.set(0, true);
    this.aMarkers.set(1, this.reducedMotion);
    this.aBaseDim.set(0.55);
    this.invalidate();
  }

  /* ====================================================================== */
  /* Loop                                                                   */
  /* ====================================================================== */

  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.disposed || this.contextLost || !this.onScreen || !this.pageVisible) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed || this.contextLost) return;
    const dt = this.lastFrame ? clamp((now - this.lastFrame) / 1000, 0, 0.05) : 1 / 60;
    this.lastFrame = now;
    const active = this.update(now, dt);
    if (this.dirty || active) {
      this.dirty = false;
      this.renderNow();
    }
    if (active) this.schedule();
    else this.lastFrame = 0;
  };

  private renderNow(): void {
    if (this.disposed || this.contextLost) return;
    this.applyUniforms();
    this.renderer.render(this.scene, this.camera);
  }

  private update(now: number, dt: number): boolean {
    let active = false;

    // ---- morph ----
    if (this.morphTween) {
      const t = this.morphTween;
      const p = clamp((now - t.start) / t.dur, 0, 1);
      this.morph = lerp(t.from, t.to, easeInOutCubic(p));
      active = true;
      if (p >= 1) {
        this.morphTween = null;
        this.settleMorph();
      }
    }

    // ---- fly-to ----
    if (this.fly) {
      const f = this.fly;
      const p = clamp((now - f.start) / f.dur, 0, 1);
      const e = easeInOutCubic(p);
      this.cur.lon = this.tgt.lon = lerp(f.from.lon, f.to.lon, e);
      this.cur.lat = this.tgt.lat = lerp(f.from.lat, f.to.lat, e);
      const z = Math.exp(lerp(Math.log(f.from.z), Math.log(f.to.z), e)) * (1 + f.hop * Math.sin(Math.PI * e));
      if (f.mode === "map") this.mAlt = this.mAltT = z;
      else this.gZoom = this.gZoomT = z;
      active = true;
      if (p >= 1) this.fly = null;
    }

    // ---- inertia ----
    if (!this.drag && !this.fly && (Math.abs(this.vel.lon) > 0.05 || Math.abs(this.vel.lat) > 0.05)) {
      this.tgt.lon += this.vel.lon * dt;
      this.tgt.lat += this.vel.lat * dt;
      this.clampTargets();
      this.cur.lon = this.tgt.lon;
      this.cur.lat = this.tgt.lat;
      const k = Math.exp(-dt * 3.2);
      this.vel.lon *= k;
      this.vel.lat *= k;
      if (Math.abs(this.vel.lon) < 0.05 && Math.abs(this.vel.lat) < 0.05) this.vel.lon = this.vel.lat = 0;
      active = true;
    }

    // ---- autorotate ----
    if (this.autoRotateActive(now)) {
      this.tgt.lon -= AUTOROTATE_DEG_S * dt;
      this.cur.lon -= AUTOROTATE_DEG_S * dt;
      active = true;
    }

    // ---- damping (keyboard / wheel / clamping) ----
    const k = 1 - Math.exp(-dt * 11);
    const damp = (a: number, b: number, eps: number): [number, boolean] => (Math.abs(b - a) < eps ? [b, false] : [a + (b - a) * k, true]);
    let moving: boolean;
    [this.cur.lon, moving] = damp(this.cur.lon, this.tgt.lon, 1e-4);
    active ||= moving;
    [this.cur.lat, moving] = damp(this.cur.lat, this.tgt.lat, 1e-4);
    active ||= moving;
    [this.gZoom, moving] = damp(this.gZoom, this.gZoomT, 1e-5);
    active ||= moving;
    [this.mAlt, moving] = damp(this.mAlt, this.mAltT, 1e-6);
    active ||= moving;
    [this.shift.x, moving] = damp(this.shift.x, this.shiftT.x, 1e-5);
    active ||= moving;
    [this.shift.y, moving] = damp(this.shift.y, this.shiftT.y, 1e-5);
    active ||= moving;
    const sunT = this.framing === "hero-right" ? SUN_HERO : SUN_CENTER;
    [this.sun.lon, moving] = damp(this.sun.lon, sunT.lon, 1e-3);
    active ||= moving;
    [this.sun.lat, moving] = damp(this.sun.lat, sunT.lat, 1e-3);
    active ||= moving;

    // ---- pointer parallax (hero) ----
    const kp = 1 - Math.exp(-dt * 3);
    const px = this.parallax.tx - this.parallax.x;
    const py = this.parallax.ty - this.parallax.y;
    if (Math.abs(px) > 1e-4 || Math.abs(py) > 1e-4) {
      this.parallax.x += px * kp;
      this.parallax.y += py * kp;
      active = true;
    }

    // ---- intro ----
    if (this.intro) {
      if (now - this.intro.start >= this.intro.dur) this.intro = null;
      active = true;
    }

    // ---- scalar fades ----
    for (const a of [this.aDay, this.aNight, this.aClouds, this.aAtmo, this.aStars, this.aBaseDim, this.aMarkers, this.overlayA.op, this.overlayB.op]) {
      if (a.step(dt)) active = true;
    }
    for (const l of Object.values(this.lines)) if (l.amt.step(dt)) active = true;
    if (this.overlayA.tex && this.overlayA.op.value === 0 && this.overlayA.op.target === 0) this.releaseSlot(this.overlayA);
    if (this.overlayB.tex && !this.overlaySpec && this.overlayB.op.value === 0) this.releaseSlot(this.overlayB);
    if (!active && this.autoRotate && !this.reducedMotion && this.interactive && this.modeTarget === "globe") {
      // idle-resume of the autorotation: one wake-up timer, not a busy loop
      const wait = IDLE_RESUME_MS - (now - this.lastInteraction);
      window.clearTimeout(this.idleTimer);
      if (wait > 0) this.idleTimer = window.setTimeout(() => this.invalidate(), wait + 30);
    }
    return active;
  }

  private autoRotateActive(now: number): boolean {
    return (
      this.autoRotate &&
      !this.reducedMotion &&
      this.modeTarget === "globe" &&
      this.morph === 0 &&
      !this.morphTween &&
      !this.drag &&
      !this.pinch &&
      !this.fly &&
      this.revealed &&
      (!this.interactive || now - this.lastInteraction > IDLE_RESUME_MS)
    );
  }

  private settleMorph(): void {
    if (this.morph >= 1) {
      this.cur.lat = this.tgt.lat = this.clampMapLat(this.cur.lat, this.mAltT);
      this.cb.onModeSettled?.("map");
    } else if (this.morph <= 0) {
      this.cb.onModeSettled?.("globe");
    }
    this.updateCloudTarget();
    this.invalidate();
  }

  private updateCloudTarget(instant = false): void {
    this.aClouds.set(this.showClouds && !this.overlaySpec ? 1 : 0, instant);
    this.invalidate();
  }

  /* ---------------------------- uniforms --------------------------------- */

  private applyUniforms(): void {
    const m = this.morph;
    const g = 1 - m;
    const now = performance.now();
    let introLon = 0;
    let introZoom = 1;
    if (this.intro) {
      const p = clamp((now - this.intro.start) / this.intro.dur, 0, 1);
      const e = 1 - easeOutCubic(p);
      introLon = this.intro.lon * e;
      introZoom = 1 + 0.12 * e;
    }
    const plx = this.reducedMotion ? 0 : this.parallax.x;
    const ply = this.reducedMotion ? 0 : this.parallax.y;
    const lon = this.cur.lon + (plx * 4 + introLon) * g;
    const latG = clamp(this.cur.lat, -85, 85);
    const latM = this.clampMapLat(this.cur.lat, this.mAltT);
    const lat = lerp(latG, latM, m) - ply * 2.5 * g;

    const gAlt = this.globeAlt(this.gZoom) * introZoom;
    const alt = Math.exp(lerp(Math.log(gAlt), Math.log(Math.max(this.mAlt, 1e-4)), m));

    const u = this.u;
    u.uMorph.value = m;
    u.uLon0.value = wrapRad(lon * DEG);
    u.uLat0.value = lat * DEG;
    u.uLiftUnit.value = 0.0005 * alt + 0.00035 * g;

    // camera: always looks down -Z at the surface's front point (0,0,1)
    const cam = this.camera;
    cam.position.set(0, 0, 1 + alt);
    cam.lookAt(0, 0, 0);
    cam.aspect = this.width / this.height;
    cam.near = Math.max(0.002, alt * 0.25);
    cam.far = alt + 140;
    cam.updateProjectionMatrix();
    // lens shift (off-axis framing; keeps the sphere's silhouette circular)
    const e = cam.projectionMatrix.elements;
    e[8] = -this.shift.x * g;
    e[9] = -this.shift.y * g;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();

    // sun: fixed in view space ("studio key light"); subsolar point derived for lat/lon lighting
    const sl = this.sun.lon * DEG;
    const sp = this.sun.lat * DEG;
    const sw = new Vector3(Math.cos(sp) * Math.sin(sl), Math.sin(sp), Math.cos(sp) * Math.cos(sl));
    const c = u.uLat0.value;
    const ny = sw.y * Math.cos(c) + sw.z * Math.sin(c);
    const nz = -sw.y * Math.sin(c) + sw.z * Math.cos(c);
    const gu = this.globeMat.uniforms;
    gu.uSunDir.value.copy(sw);
    gu.uSubsolar.value.set(Math.atan2(sw.x, nz) + u.uLon0.value, Math.asin(clamp(ny, -1, 1)));
    gu.uDayMix.value = this.aDay.value;
    gu.uNightAmt.value = this.aNight.value;
    gu.uCloudAmt.value = this.aClouds.value;
    gu.uAtmoAmt.value = this.aAtmo.value;
    gu.uBaseDim.value = this.aBaseDim.value * (this.markers ? 1 : 0);
    gu.uOverlayA.value = this.overlayA.tex ?? this.placeholderClear;
    gu.uOverlayB.value = this.overlayB.tex ?? this.placeholderClear;
    gu.uOverlayOpA.value = this.overlayA.tex ? this.overlayA.op.value : 0;
    gu.uOverlayOpB.value = this.overlayB.tex ? this.overlayB.op.value : 0;

    const au = (this.atmo.material as ShaderMaterial).uniforms;
    const atmoAmt = this.aAtmo.value * (1 - smooth(0, 0.3, m));
    au.uSunDir.value.copy(sw);
    au.uAmount.value = atmoAmt;
    au.uNight.value = this.aNight.value;
    this.atmo.visible = atmoAmt > 0.001;

    const st = this.stars.material.uniforms;
    const starAmt = this.aStars.value * (1 - smooth(0, 0.35, m));
    st.uAmount.value = starAmt;
    st.uPixelRatio.value = this.dpr;
    this.stars.visible = starAmt > 0.001;

    // lines
    // overlays dim on the night side of the globe (faded out on the map)
    const ssLon = gu.uSubsolar.value.x;
    const ssLat = gu.uSubsolar.value.y;
    this.lineU.uSunEarth.value.set(Math.cos(ssLat) * Math.cos(ssLon), Math.cos(ssLat) * Math.sin(ssLon), Math.sin(ssLat));
    this.lineU.uLineNight.value = this.aNight.value * (1 - smooth(0.06, 0.7, m));
    for (const l of Object.values(this.lines)) {
      // hairlines: ≤ 1.5 device px even on DPR 2+ (crisp, restrained); thick lines scale fully
      l.mat.linewidth = l.width <= 1 ? l.width * Math.min(this.dpr, 1.5) : l.width * this.dpr;
      l.mat.opacity = l.baseOpacity * l.amt.value;
      l.obj.visible = l.amt.value > 0.002 && hasSegs(l.geo);
    }
    // dashed draw box: dash pattern in degrees ≈ 6px on / 4px off
    if (this.lines.draw.obj.visible) {
      const degPerPx = 1 / this.pxPerDeg(alt);
      this.lines.draw.mat.dashSize = 6 * degPerPx;
      this.lines.draw.mat.gapSize = 4 * degPerPx;
    }

    // markers
    if (this.markers) {
      const mu = this.markerMat.uniforms;
      mu.uResolution.value.set(this.width * this.dpr, this.height * this.dpr);
      mu.uPixelRatio.value = this.dpr;
      mu.uScale.value = clamp(Math.sqrt(this.pxPerDeg(alt) / 4.2), 0.85, 1.45);
      mu.uHover.value = this.hoverIndex;
      mu.uAppear.value = this.aMarkers.value;
    }
  }

  /* ====================================================================== */
  /* Geometry of the view                                                   */
  /* ====================================================================== */

  private measure(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap);
    const changed = w !== this.width || h !== this.height || dpr !== this.dpr;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    if (changed) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      const fp = this.framingParams();
      this.shiftT.x = fp.shiftX;
      this.shiftT.y = fp.shiftY;
      if (this.modeTarget === "map") {
        const fit = this.mapFitAlt();
        if (this.mAltT > fit) this.mAlt = this.mAltT = fit;
      }
      this.invalidate();
    }
  }

  private snapFraming(): void {
    const fp = this.framingParams();
    this.shift.x = this.shiftT.x = fp.shiftX;
    this.shift.y = this.shiftT.y = fp.shiftY;
    const s = this.framing === "hero-right" ? SUN_HERO : SUN_CENTER;
    this.sun.lon = s.lon;
    this.sun.lat = s.lat;
  }

  /** Default globe altitude + lens shift for the current framing and aspect. */
  private framingParams(): { alt: number; shiftX: number; shiftY: number } {
    const aspect = this.width / this.height;
    let f: number;
    let fitWidth = aspect < 1;
    let shiftX = 0;
    let shiftY = 0;
    if (this.framing === "hero-right") {
      if (aspect >= 1.15) {
        f = 1.02;
        shiftX = 0.43;
        shiftY = -0.15;
        fitWidth = false;
      } else {
        f = 1.05;
        fitWidth = true;
        shiftY = -0.48;
      }
    } else {
      f = 0.8;
    }
    const tanA = fitWidth ? f * TAN_HALF * aspect : f * TAN_HALF;
    const D = 1 / Math.sin(Math.atan(tanA));
    return { alt: D - 1, shiftX, shiftY };
  }

  private globeAlt(zoom: number): number {
    return this.framingParams().alt * zoom;
  }

  /** Altitude that fits the whole equirectangular world (contain). */
  private mapFitAlt(): number {
    const aspect = this.width / this.height;
    return Math.max(Math.PI / (TAN_HALF * aspect), Math.PI / 2 / TAN_HALF) * 1.02;
  }

  private clampMapLat(lat: number, alt: number): number {
    const hv = (alt * TAN_HALF) / DEG; // half visible height in degrees
    if (hv >= 90) return 0;
    return clamp(lat, -90 + hv, 90 - hv);
  }

  private pxPerDeg(alt: number): number {
    return ((this.height / 2) / (alt * TAN_HALF)) * DEG;
  }

  private clampTargets(): void {
    if (this.modeTarget === "map") this.tgt.lat = this.clampMapLat(this.tgt.lat, this.mAltT);
    else this.tgt.lat = clamp(this.tgt.lat, -85, 85);
  }

  private resolveQuality(): QualitySettings {
    const high: QualitySettings = { tier: "high", texRes: "4k", segX: 256, segY: 128, dprCap: 2, cloudW: 2048 };
    const low: QualitySettings = { tier: "low", texRes: "2k", segX: 160, segY: 80, dprCap: 1.5, cloudW: 1024 };
    if (this.qualityPref === "high") return high;
    if (this.qualityPref === "low") return low;
    if (typeof window === "undefined") return low;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
    const minSide = Math.min(window.innerWidth, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const lowDpr = dpr < 1.25 && window.innerWidth * dpr < 1400;
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    if (coarse || minSide < 600 || lowDpr || (mem != null && mem <= 2)) return low;
    return high;
  }

  /* ====================================================================== */
  /* Picking                                                                */
  /* ====================================================================== */

  /** Analytic pick: ray–sphere (globe) or ray–plane (map); null mid-transition. */
  private pickLonLat(x: number, y: number): { lon: number; lat: number } | null {
    const m = this.morph;
    if (m > 0.001 && m < 0.999) return null;
    this.applyUniforms();
    const ndc = new Vector3((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1, 0.5);
    const o = this.camera.position.clone();
    const d = ndc.unproject(this.camera).sub(o).normalize();
    const lon0 = this.u.uLon0.value;
    const lat0 = this.u.uLat0.value;
    if (m <= 0.001) {
      const b = o.dot(d);
      const c = o.dot(o) - 1;
      const disc = b * b - c;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      const p = o.addScaledVector(d, t);
      const ny = p.y * Math.cos(lat0) + p.z * Math.sin(lat0);
      const nz = -p.y * Math.sin(lat0) + p.z * Math.cos(lat0);
      const lat = Math.asin(clamp(ny, -1, 1)) / DEG;
      const lon = wrap180((Math.atan2(p.x, nz) + lon0) / DEG);
      return { lon, lat };
    }
    if (Math.abs(d.z) < 1e-6) return null;
    const t = (1 - o.z) / d.z;
    if (t < 0) return null;
    const p = o.addScaledVector(d, t);
    const lam = p.x;
    const phi = p.y + lat0;
    if (Math.abs(lam) > Math.PI || Math.abs(phi) > Math.PI / 2) return null;
    return { lon: wrap180((lam + lon0) / DEG), lat: phi / DEG };
  }

  private pickInfo(x: number, y: number): { info: PickInfo; index: number } | null {
    const ll = this.pickLonLat(x, y);
    if (!ll) return null;
    const info: PickInfo = { lon: ll.lon, lat: ll.lat, screen: { x, y } };
    const c = countryAt(ll.lon, ll.lat);
    if (c) {
      info.countryId = c.id;
      info.countryName = c.properties?.name;
    }
    let index = -1;
    if (this.markers && this.markerPoints.length && this.aMarkers.target > 0) {
      const alt = this.modeTarget === "map" ? this.mAlt : this.globeAlt(this.gZoom);
      const thr = clamp(13 / this.pxPerDeg(alt), 0.4, 8);
      let best = thr;
      const pts = this.markerPoints;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (Math.abs(p.lat - ll.lat) > best) continue;
        const dd = angularDistance(ll.lon, ll.lat, p.lon, p.lat);
        if (dd < best) {
          best = dd;
          index = i;
        }
      }
      if (index >= 0) info.atlasPoint = pts[index];
    }
    return { info, index };
  }

  /* ====================================================================== */
  /* Events                                                                 */
  /* ====================================================================== */

  private attachEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("keydown", this.onKeyDown);
    c.addEventListener("webglcontextlost", this.onContextLost, false);
    c.addEventListener("webglcontextrestored", this.onContextRestored, false);
    c.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("pointermove", this.onWindowPointer, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.pageVisible = document.visibilityState !== "hidden";
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.container);
    } else {
      window.addEventListener("resize", this.onWindowResize);
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((entries) => {
        const vis = entries.some((e) => e.isIntersecting);
        if (vis !== this.onScreen) {
          this.onScreen = vis;
          if (vis) {
            this.lastFrame = 0;
            this.invalidate();
          }
        }
      });
      this.io.observe(this.container);
    }
    if (this.reducedMotionForced === undefined && window.matchMedia) {
      this.mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.mql.addEventListener?.("change", this.onMotionPref);
    }
  }

  private detachEvents(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("keydown", this.onKeyDown);
    c.removeEventListener("webglcontextlost", this.onContextLost);
    c.removeEventListener("webglcontextrestored", this.onContextRestored);
    c.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("pointermove", this.onWindowPointer);
    window.removeEventListener("resize", this.onWindowResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.mql?.removeEventListener?.("change", this.onMotionPref);
  }

  private onMotionPref = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
    this.invalidate();
  };
  private onWindowResize = () => this.measure();
  private onContextMenu = (e: Event) => {
    if (this.drawing) e.preventDefault();
  };
  private onVisibility = () => {
    this.pageVisible = document.visibilityState !== "hidden";
    if (this.pageVisible) {
      this.lastFrame = 0;
      this.invalidate();
    }
  };

  private onContextLost = (e: Event) => {
    e.preventDefault(); // allow restoration
    this.contextLost = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cb.onContextLost?.();
  };

  private onContextRestored = () => {
    this.contextLost = false;
    // three resets its resource tables and re-uploads geometry/textures lazily; GPU-only
    // content (the baked cloud target) must be regenerated. Don't dispose() it: its old GL
    // objects belonged to the dead context.
    this.bakeClouds();
    if (this.landTex) this.landTex.needsUpdate = true;
    if (this.regionTex) this.regionTex.needsUpdate = true;
    this.cb.onContextRestored?.();
    this.invalidate();
  };

  private reveal(): void {
    if (this.revealed || this.disposed) return;
    this.revealed = true;
    window.clearTimeout(this.revealTimer);
    // first frame with final content, then fade the canvas in
    this.renderNow();
    this.canvas.style.opacity = "1";
    if (!this.reducedMotion && this.modeTarget === "globe") {
      this.intro = { start: performance.now(), dur: 2600, lon: 24 };
    }
    this.invalidate();
    if (!this.readyFired) {
      this.readyFired = true;
      this.cb.onReady?.();
    }
  }

  private reportSoft(e: unknown): void {
    if (this.disposed) return;
    if (e instanceof DOMException && e.name === "AbortError") return;
    this.cb.onError?.(e instanceof Error ? e : new Error(String(e)));
  }

  private markInteraction(): void {
    this.lastInteraction = performance.now();
    this.intro = null;
  }

  private localXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inMapState(): boolean {
    return this.modeTarget === "map" && this.morph >= 0.999;
  }

  private onWindowPointer = (e: PointerEvent) => {
    if (this.interactive || this.reducedMotion) return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    this.parallax.tx = clamp(nx, -1, 1);
    this.parallax.ty = clamp(ny, -1, 1);
    this.invalidate();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.interactive) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.canvas.focus({ preventScroll: true });
    const p = this.localXY(e);
    this.pointers.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.markInteraction();
    this.fly = null;
    this.vel.lon = this.vel.lat = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.cancelDrawing();
      this.pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        g0: this.gZoomT,
        m0: this.mAltT,
        lon0: this.tgt.lon,
        lat0: this.tgt.lat,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
      return;
    }
    if (this.pointers.size > 2) return;
    if (this.drawMode && this.inMapState()) {
      const ll = this.pickLonLat(p.x, p.y);
      if (ll) {
        this.drawing = { lon0: ll.lon, lat0: ll.lat, lon1: ll.lon, lat1: ll.lat };
        this.updateDrawRect();
      }
      return;
    }
    this.drag = { x: p.x, y: p.y, t: performance.now(), lon: this.tgt.lon, lat: this.tgt.lat, moved: false, samples: [] };
    this.canvas.style.cursor = "grabbing";
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.interactive) return;
    const p = this.localXY(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ratio = this.pinch.d0 / d;
      if (this.modeTarget === "globe") {
        this.gZoomT = this.gZoom = this.clampGZoom(this.pinch.g0 * ratio);
      } else {
        this.zoomMapAt(this.pinch.mx, this.pinch.my, (this.pinch.m0 * ratio) / this.mAltT, true);
      }
      this.markInteraction();
      this.invalidate();
      return;
    }

    if (this.drawing) {
      const ll = this.pickLonLat(clamp(p.x, 0, this.width), clamp(p.y, 0, this.height));
      if (ll) {
        this.drawing.lon1 = ll.lon;
        this.drawing.lat1 = ll.lat;
        this.updateDrawRect();
      }
      return;
    }

    if (this.drag) {
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 3) return;
      this.drag.moved = true;
      if (this.morphTween) return;
      const alt = this.modeTarget === "map" ? this.mAlt : this.globeAlt(this.gZoom);
      const dpp = 1 / this.pxPerDeg(alt);
      if (this.modeTarget === "globe") {
        const k = 1.0;
        this.tgt.lon = this.drag.lon - dx * dpp * k;
        this.tgt.lat = clamp(this.drag.lat + dy * dpp * k, -85, 85);
      } else {
        this.tgt.lon = this.drag.lon - dx * dpp;
        this.tgt.lat = this.clampMapLat(this.drag.lat + dy * dpp, this.mAltT);
      }
      this.cur.lon = this.tgt.lon;
      this.cur.lat = this.tgt.lat;
      const now = performance.now();
      this.drag.samples.push({ t: now, lon: this.tgt.lon, lat: this.tgt.lat });
      while (this.drag.samples.length > 2 && now - this.drag.samples[0].t > 90) this.drag.samples.shift();
      this.markInteraction();
      this.invalidate();
      return;
    }

    // hover (throttled to rAF)
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      this.hoverPos = p;
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.processHover);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const p = this.localXY(e);
    if (this.drawing) {
      const d = this.drawing;
      this.drawing = null;
      if (Math.abs(d.lon1 - d.lon0) > 0.05 && Math.abs(d.lat1 - d.lat0) > 0.05) {
        const bbox = this.drawingBBox(d);
        this.cb.onBoxSelect?.(bbox);
      } else {
        this.clearDrawRect();
        this.select(p.x, p.y);
      }
      return;
    }
    const drag = this.drag;
    this.drag = null;
    this.canvas.style.cursor = this.drawMode && this.modeTarget === "map" ? "crosshair" : "grab";
    if (!drag) return;
    if (!drag.moved && performance.now() - drag.t < 600) {
      this.select(p.x, p.y);
      return;
    }
    // inertia from the last ~90 ms
    const s = drag.samples;
    if (s.length >= 2 && !this.reducedMotion) {
      const a = s[0];
      const b = s[s.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.008 && performance.now() - b.t < 80) {
        this.vel.lon = clamp((b.lon - a.lon) / dt, -400, 400);
        this.vel.lat = clamp((b.lat - a.lat) / dt, -300, 300);
      }
    }
    this.markInteraction();
    this.invalidate();
  };

  private onPointerLeave = () => {
    if (this.drag || this.drawing) return;
    this.hoverPos = null;
    this.emitHover(null);
  };

  private processHover = () => {
    this.hoverRaf = 0;
    if (!this.hoverPos || this.drag || this.disposed) return;
    const r = this.pickInfo(this.hoverPos.x, this.hoverPos.y);
    if (!r) {
      this.emitHover(null);
      return;
    }
    if (r.index !== this.hoverIndex) {
      this.hoverIndex = r.index;
      this.invalidate();
    }
    this.canvas.style.cursor =
      this.drawMode && this.modeTarget === "map" ? "crosshair" : r.index >= 0 || r.info.countryId ? "pointer" : "grab";
    this.lastHoverKey = "x";
    this.cb.onHover?.(r.info);
  };

  private emitHover(info: PickInfo | null): void {
    if (info === null) {
      if (this.hoverIndex !== -1) {
        this.hoverIndex = -1;
        this.invalidate();
      }
      if (this.lastHoverKey === "") return;
      this.lastHoverKey = "";
    }
    this.cb.onHover?.(info);
  }

  private select(x: number, y: number): void {
    const r = this.pickInfo(x, y);
    if (r) this.cb.onSelect?.(r.info);
  }

  private clampGZoom(z: number): number {
    const base = this.framingParams().alt;
    return clamp(z, GLOBE_MIN_ALT / base, 1.6);
  }

  /** Zoom by `factor` keeping the lon/lat under (x, y) fixed (map mode). */
  private zoomMapAt(x: number, y: number, factor: number, immediate = false): void {
    const fit = this.mapFitAlt();
    const aspect = this.width / this.height;
    const ndcX = (x / this.width) * 2 - 1;
    const ndcY = -(y / this.height) * 2 + 1;
    const h0 = this.mAltT;
    const h1 = clamp(h0 * factor, MAP_MIN_ALT, fit);
    const ratio = h1 / h0;
    const ox = ndcX * h0 * TAN_HALF * aspect; // plane offset (rad) of the cursor from the centre
    const oy = ndcY * h0 * TAN_HALF;
    this.tgt.lon += (ox * (1 - ratio)) / DEG;
    this.tgt.lat += (oy * (1 - ratio)) / DEG;
    this.mAltT = h1;
    this.tgt.lat = this.clampMapLat(this.tgt.lat, h1);
    if (immediate) {
      this.mAlt = h1;
      this.cur.lon = this.tgt.lon;
      this.cur.lat = this.tgt.lat;
    }
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.interactive) return;
    e.preventDefault();
    if (this.morphTween) return;
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dy = clamp(e.deltaY * unit, -240, 240);
    const factor = Math.exp(dy * 0.0016);
    this.fly = null;
    this.markInteraction();
    if (this.modeTarget === "globe") {
      this.gZoomT = this.clampGZoom(this.gZoomT * factor);
    } else {
      // make the damping start from a consistent state so the cursor anchor holds
      this.cur.lon = this.tgt.lon;
      this.cur.lat = this.tgt.lat;
      this.mAlt = this.mAltT;
      const p = this.localXY(e);
      this.zoomMapAt(p.x, p.y, factor);
    }
    this.invalidate();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.interactive) return;
    const map = this.modeTarget === "map";
    const alt = map ? this.mAltT : this.globeAlt(this.gZoomT);
    const viewDeg = (this.height / this.pxPerDeg(alt)) * 0.18; // ~18% of the view height
    const step = clamp(viewDeg, 0.2, 20);
    let handled = true;
    switch (e.key) {
      case "ArrowLeft":
        this.tgt.lon -= step;
        break;
      case "ArrowRight":
        this.tgt.lon += step;
        break;
      case "ArrowUp":
        this.tgt.lat += step;
        break;
      case "ArrowDown":
        this.tgt.lat -= step;
        break;
      case "+":
      case "=":
        if (map) this.zoomMapAt(this.width / 2, this.height / 2, 0.7);
        else this.gZoomT = this.clampGZoom(this.gZoomT * 0.8);
        break;
      case "-":
      case "_":
        if (map) this.zoomMapAt(this.width / 2, this.height / 2, 1 / 0.7);
        else this.gZoomT = this.clampGZoom(this.gZoomT / 0.8);
        break;
      case "Enter":
      case " ": {
        const fp = this.framingParams();
        const g = 1 - this.morph;
        this.select((this.width * (1 + fp.shiftX * g)) / 2, (this.height * (1 - fp.shiftY * g)) / 2);
        break;
      }
      case "Escape":
        if (this.drawing) this.cancelDrawing();
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.fly = null;
      this.vel.lon = this.vel.lat = 0;
      this.clampTargets();
      this.markInteraction();
      this.invalidate();
    }
  };

  /* ---------------------------- draw box --------------------------------- */

  private drawingBBox(d: { lon0: number; lat0: number; lon1: number; lat1: number }): BBox {
    // in map mode the drag is monotonic in screen x: unwrap lon1 relative to lon0
    let l1 = d.lon1;
    const dl = wrap180(l1 - d.lon0);
    l1 = d.lon0 + dl;
    const west = Math.min(d.lon0, l1);
    const east = Math.max(d.lon0, l1);
    return normalizeBBox({ west, east, south: Math.min(d.lat0, d.lat1), north: Math.max(d.lat0, d.lat1) });
  }

  private updateDrawRect(): void {
    if (!this.drawing) return;
    const b = this.drawingBBox(this.drawing);
    this.setLineSegments(this.lines.draw, bboxToSegments(b, 3, 1));
    this.lines.draw.amt.set(1, true);
  }

  private clearDrawRect(): void {
    if (this.lines?.draw && hasSegs(this.lines.draw.geo)) this.setLineSegments(this.lines.draw, new Float32Array(0));
  }

  private cancelDrawing(): void {
    this.drawing = null;
    this.clearDrawRect();
  }
}

/* ======================================================================== */
/* helpers                                                                  */
/* ======================================================================== */

function pickCallbacks(o: EarthEngineCallbacks): EarthEngineCallbacks {
  const { onHover, onSelect, onBoxSelect, onReady, onError, onContextLost, onContextRestored, onModeSettled } = o;
  const out: EarthEngineCallbacks = {};
  if (onHover) out.onHover = onHover;
  if (onSelect) out.onSelect = onSelect;
  if (onBoxSelect) out.onBoxSelect = onBoxSelect;
  if (onReady) out.onReady = onReady;
  if (onError) out.onError = onError;
  if (onContextLost) out.onContextLost = onContextLost;
  if (onContextRestored) out.onContextRestored = onContextRestored;
  if (onModeSettled) out.onModeSettled = onModeSettled;
  return out;
}

function hasSegs(g: LineSegmentsGeometry): boolean {
  return !!g.attributes.instanceStart && g.instanceCount > 0 && Number.isFinite(g.instanceCount);
}

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function wrapRad(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

/** (λ, φ) grid: position.x = λ ∈ [-π, π] (relative to the view centre), position.y = φ. */
function buildGridGeometry(sx: number, sy: number): BufferGeometry {
  const nx = sx + 1;
  const ny = sy + 1;
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    const phi = -Math.PI / 2 + (Math.PI * j) / sy;
    for (let i = 0; i < nx; i++) {
      const lam = -Math.PI + (2 * Math.PI * i) / sx;
      const k = (j * nx + i) * 3;
      pos[k] = lam;
      pos[k + 1] = phi;
      pos[k + 2] = 0;
    }
  }
  const idx = new Uint32Array(sx * sy * 6);
  let o = 0;
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      idx[o++] = a;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

/** CPU twin of the GLSL esMorph (unit radius). */
export function morphJS(lambda: number, phi: number, m: number, lat0: number, nrm: Vector3): Vector3 {
  const sinc = (x: number) => (Math.abs(x) < 1e-3 ? 1 - (x * x) / 6 : Math.sin(x) / x);
  const t = 1 - m;
  const a = lambda * t;
  const b = phi * t;
  const c = lat0 * t;
  const dphi = phi - lat0;
  const d = dphi * t;
  const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  const Sa = Math.sin(a / 2) * lambda * sinc(a / 2);
  const Sd = Math.sin(d / 2) * dphi * sinc(d / 2);
  nrm.set(cb * sa, sb * cc - cb * ca * sc, sb * sc + cb * ca * cc);
  return new Vector3(cb * lambda * sinc(a), dphi * sinc(d) + cb * sc * Sa, 1 - Sd - cb * cc * Sa);
}


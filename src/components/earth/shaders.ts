/* ==========================================================================
   EARTHSCOPE — GLSL for the Earth engine.

   THE MORPH (shared by every surface-attached object)
   ---------------------------------------------------
   A point (λ, φ) — λ = longitude relative to the view centre uLon0, wrapped
   to [-π, π) so the seam sits at uLon0 ± 180° — is placed on a sphere of
   radius r = R / t (t = 1 − uMorph) using the angles (λt, φt), rotated about
   X by uLat0·t so the view centre faces the camera, and pushed back so the
   front point stays at z = R. Arc lengths from the centre are preserved
   (r·λt = R·λ), so the globe *unrolls* at constant size instead of shrinking
   / self-occluding like a linear lerp; at t → 0 it is exactly the
   equirectangular plane x = Rλ, y = R(φ − φ0), z = R.
   All terms are written with sinc() so t = 0 is numerically exact (no 1/t).
   ========================================================================== */

export const MORPH_CHUNK = /* glsl */ `
#ifndef ES_MORPH_CHUNK
#define ES_MORPH_CHUNK
uniform float uMorph;     // 0 = globe, 1 = map
uniform float uLon0;      // view-centre longitude (rad)
uniform float uLat0;      // view-centre latitude  (rad)
uniform float uLiftUnit;  // overlay lift (world units per lift step)
#define ES_PI 3.141592653589793
#define ES_TAU 6.283185307179586
#define ES_DEG 0.017453292519943295

float esSinc(float x) { return abs(x) < 1.0e-3 ? 1.0 - x * x * 0.16666667 : sin(x) / x; }
float esWrap(float a) { return a - ES_TAU * floor((a + ES_PI) / ES_TAU); }

// lambda: lon relative to uLon0 (rad, -PI..PI), phi: lat (rad). Unit radius.
vec3 esMorph(float lambda, float phi, out vec3 nrm) {
  float t = 1.0 - uMorph;
  float a = lambda * t;
  float b = phi * t;
  float c = uLat0 * t;
  float dphi = phi - uLat0;
  float d = dphi * t;
  float sa = sin(a), ca = cos(a), sb = sin(b), cb = cos(b), sc = sin(c), cc = cos(c);
  float ha = 0.5 * a;
  float hd = 0.5 * d;
  float Sa = sin(ha) * lambda * esSinc(ha);   // 2 sin^2(a/2) / t
  float Sd = sin(hd) * dphi * esSinc(hd);     // 2 sin^2(d/2) / t
  nrm = vec3(cb * sa, sb * cc - cb * ca * sc, sb * sc + cb * ca * cc);
  return vec3(cb * lambda * esSinc(a), dphi * esSinc(d) + cb * sc * Sa, 1.0 - Sd - cb * cc * Sa);
}

// absolute lon/lat in DEGREES + lift steps → world position (lifted along the surface normal)
vec3 esMorphDeg(vec2 lonlat, float lift, out vec3 nrm) {
  float lam = esWrap(lonlat.x * ES_DEG - uLon0);
  vec3 p = esMorph(lam, lonlat.y * ES_DEG, nrm);
  return p + nrm * (lift * uLiftUnit);
}

float esFacing(vec3 p, vec3 n) { return dot(n, normalize(cameraPosition - p)); }
#endif
`;

/* ------------------------------------------------------------------------ */
/* Globe surface                                                            */
/* ------------------------------------------------------------------------ */

export const GLOBE_VERT = /* glsl */ `
${MORPH_CHUNK}
varying vec2 vLonLat;   // unwrapped absolute lon (rad, continuous across the mesh), lat (rad)
varying vec3 vNrm;
varying vec3 vPos;
void main() {
  vec3 n;
  vec3 p = esMorph(position.x, position.y, n);
  vLonLat = vec2(position.x + uLon0, position.y);
  vNrm = n;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const GLOBE_FRAG = /* glsl */ `
${MORPH_CHUNK}
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uLand;
uniform sampler2D uClouds;
uniform sampler2D uRegion;
uniform sampler2D uOverlayA;
uniform sampler2D uOverlayB;
uniform float uDayMix;      // 0 = procedural land/ocean fallback, 1 = Blue Marble
uniform float uNightTex;    // night texture available
uniform float uNightAmt;    // showNight
uniform float uCloudAmt;
uniform float uAtmoAmt;
uniform float uOverlayOpA;
uniform float uOverlayOpB;
uniform float uBaseDim;
uniform vec3 uSunDir;       // world-space sun direction (globe state)
uniform vec2 uSubsolar;     // subsolar lon/lat (rad, absolute)
varying vec2 vLonLat;
varying vec3 vNrm;
varying vec3 vPos;

void main() {
  // continuous longitude + RepeatWrapping: no fract(), no derivative discontinuity, no seam
  vec2 uv = vec2(vLonLat.x * 0.15915494309 + 0.5, vLonLat.y * 0.31830988618 + 0.5);
  float land = texture2D(uLand, uv).r;
  float alat = abs(vLonLat.y);

  // ---- base albedo -----------------------------------------------------
  vec3 tex = texture2D(uDay, uv).rgb;
  float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
  vec3 graded = mix(vec3(lum), tex, 0.9);
  graded = mix(graded * vec3(0.78, 0.9, 1.1), graded, land);
  vec3 fbOcean = mix(vec3(0.006, 0.014, 0.034), vec3(0.010, 0.024, 0.055), 1.0 - alat / 1.5708);
  vec3 fbLand = mix(vec3(0.034, 0.048, 0.072), vec3(0.20, 0.23, 0.27), smoothstep(1.12, 1.3, alat));
  vec3 base = mix(mix(fbOcean, fbLand, land), graded, uDayMix);
  base *= mix(1.0, 0.58, uBaseDim);

  // ---- sun (lat/lon space → works through the whole morph) ---------------
  float sLat = sin(vLonLat.y);
  float cLat = cos(vLonLat.y);
  float cosZ = sLat * sin(uSubsolar.y) + cLat * cos(uSubsolar.y) * cos(vLonLat.x - uSubsolar.x);
  float flatMap = smoothstep(0.06, 0.7, uMorph);       // map → even, readable light
  float nightK = uNightAmt * (1.0 - flatMap);
  float dayF = smoothstep(-0.08, 0.16, cosZ);
  float lam = clamp(cosZ, 0.0, 1.0);
  float lightN = dayF * (0.42 + 0.58 * sqrt(lam));
  float lightS = 0.66 + 0.34 * smoothstep(-0.6, 0.85, cosZ);
  float light = mix(lightS, lightN, uNightAmt);
  light = mix(light, 1.0, flatMap);

  vec3 N = normalize(vNrm);
  vec3 V = normalize(cameraPosition - vPos);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float globeK = 1.0 - smoothstep(0.0, 0.4, uMorph);

  float cloud = texture2D(uClouds, uv).r * uCloudAmt * (1.0 - flatMap);

  vec3 col = base * light;

  // ---- night side: moonlit terrain + warm city lights -------------------
  vec3 nl = texture2D(uNight, uv).rgb * uNightTex;
  float dark = (1.0 - dayF) * nightK;
  float nlum = dot(nl, vec3(0.3, 0.45, 0.25));
  col += (vec3(0.55, 0.68, 1.0) * nlum * 0.32 + base * 0.012 + vec3(0.0012, 0.0024, 0.006)) * dark;
  float city = smoothstep(0.02, 0.8, max(nl.r, nl.g) - nl.b * 0.45);
  float cityF = (1.0 - smoothstep(-0.2, 0.03, cosZ)) * nightK;
  col += vec3(1.0, 0.64, 0.32) * city * 1.35 * cityF * (1.0 - cloud * 0.8);

  // ---- clouds (very faint) --------------------------------------------
  col = mix(col, vec3(0.9, 0.94, 1.0) * light, cloud * 0.3);

  // ---- ocean glint from the land mask ------------------------------------
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  float glintMask = (1.0 - land) * smoothstep(-0.02, 0.25, cosZ) * globeK * (1.0 - cloud) * (1.0 - uBaseDim * 0.7);
  col += (vec3(1.0, 0.93, 0.84) * pow(nh, 260.0) * 0.075 + vec3(0.3, 0.5, 0.95) * pow(nh, 32.0) * 0.011) * glintMask;

  // ---- selected-region fills (premultiplied) ----------------------------
  vec4 rg = texture2D(uRegion, uv);
  col = col * (1.0 - rg.a) + rg.rgb;

  // ---- data overlays (premultiplied, crossfaded) -------------------------
  float ovShade = mix(1.0, max(light, 0.42), globeK * uNightAmt);
  vec4 oa = texture2D(uOverlayA, uv) * uOverlayOpA;
  col = col * (1.0 - oa.a) + oa.rgb * ovShade;
  vec4 ob = texture2D(uOverlayB, uv) * uOverlayOpB;
  col = col * (1.0 - ob.a) + ob.rgb * ovShade;

  // ---- inner atmosphere (limb haze) --------------------------------------
  float rimLit = mix(1.0, smoothstep(-0.3, 0.55, dot(N, uSunDir)), uNightAmt);
  float fres = pow(1.0 - NdV, 2.6);
  float atK = globeK * uAtmoAmt;
  col = mix(col, vec3(0.36, 0.6, 1.0) * (0.25 + 0.75 * rimLit), fres * 0.36 * atK * (0.3 + 0.7 * rimLit));
  col += vec3(0.25, 0.5, 1.0) * pow(1.0 - NdV, 7.0) * rimLit * 0.5 * atK;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------------ */
/* Atmosphere shell (outer limb glow) — analytic closest-approach density    */
/* ------------------------------------------------------------------------ */

export const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uAmount;
uniform float uThickness;
uniform float uNight;
varying vec3 vWorld;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float tca = -dot(ro, rd);
  vec3 pc = ro + rd * tca;
  float d = length(pc);
  float h = (d - 1.0) / uThickness;          // 0 at the surface, 1 at the shell top
  if (h > 1.0 || uAmount <= 0.0) discard;
  float dens = exp(-max(h, 0.0) * 5.0) * (1.0 - smoothstep(0.55, 1.0, h));
  vec3 up = pc / max(d, 1e-4);
  float lit = mix(1.0, smoothstep(-0.3, 0.6, dot(up, uSunDir)), uNight);
  vec3 c = mix(vec3(0.07, 0.16, 0.5), vec3(0.5, 0.76, 1.0), lit);
  float I = dens * (0.1 + 0.9 * lit) * uAmount * 0.85;
  gl_FragColor = vec4(c * I, 0.0);            // additive onto the page (alpha untouched)
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------------ */
/* Atlas markers — instanced screen-space SDF glyphs glued with esMorphDeg   */
/* ------------------------------------------------------------------------ */

export const MARKER_VERT = /* glsl */ `
${MORPH_CHUNK}
attribute vec2 aLonLat;
attribute float aSize;
attribute float aKind;   // 0 ▲ rise, 1 ▼ fall, 2 ○ not significant
attribute vec3 aColor;
attribute float aIndex;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uScale;
uniform float uHover;
uniform float uAppear;
varying vec2 vP;
varying float vKind;
varying vec3 vColor;
varying float vFade;
varying float vHover;
varying float vR;
void main() {
  vec3 n;
  vec3 p = esMorphDeg(aLonLat, 2.5, n);
  float facing = esFacing(p, n);
  vFade = smoothstep(0.12, 0.4, facing) * uAppear;
  vHover = abs(aIndex - uHover) < 0.5 ? 1.0 : 0.0;
  float limb = mix(0.45, 1.0, smoothstep(0.1, 0.92, facing));     // foreshortening near the limb
  float s = aSize * uScale * limb * (1.0 + 0.35 * vHover) * uPixelRatio * mix(0.6, 1.0, uAppear);
  float half_ = s * 0.62 + 6.0 * uPixelRatio;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  clip.xy += position.xy * (2.0 * half_ / uResolution) * clip.w;
  gl_Position = (vFade <= 0.0) ? vec4(0.0, 0.0, 2.0, 1.0) : clip;
  vP = position.xy * half_;
  vR = s * 0.5;
  vKind = aKind;
  vColor = aColor;
}
`;

export const MARKER_FRAG = /* glsl */ `
uniform float uPixelRatio;
varying vec2 vP;
varying float vKind;
varying vec3 vColor;
varying float vFade;
varying float vHover;
varying float vR;
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
void main() {
  float dpr = uPixelRatio;
  float d;
  if (vKind < 0.5) d = sdTri(vP + vec2(0.0, 0.08 * vR), vR);
  else if (vKind < 1.5) d = sdTri(vec2(vP.x, -vP.y) + vec2(0.0, 0.08 * vR), vR);
  else d = abs(length(vP) - vR * 0.78) - 0.75 * dpr;
  float aa = 0.7;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float halo = (1.0 - smoothstep(-aa, aa, d - 1.4 * dpr)) * 0.6;
  float a = max(fill, halo);
  vec3 col = (vColor * fill + vec3(0.012, 0.018, 0.04) * halo * (1.0 - fill)) / max(a, 1e-4);
  float ring = (1.0 - smoothstep(-aa, aa, abs(d - 3.2 * dpr) - 0.85 * dpr)) * vHover;
  col = mix(col, vec3(0.93, 0.96, 1.0), ring);
  a = max(a, ring);
  if (a * vFade < 0.004) discard;
  gl_FragColor = vec4(col, a * vFade);
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------------ */
/* Stars — very sparse, static, tiny                                        */
/* ------------------------------------------------------------------------ */

export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
uniform float uPixelRatio;
uniform float uAmount;
varying float vB;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vB = aBright * uAmount;
}
`;

export const STAR_FRAG = /* glsl */ `
varying float vB;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.15, 0.5, d)) * vB;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.78, 0.86, 1.0) * a, 0.0);
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------------ */
/* Procedural clouds, baked once into an equirectangular render target       */
/* ------------------------------------------------------------------------ */

export const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const CLOUD_BAKE_FRAG = /* glsl */ `
varying vec2 vUv;
// 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * snoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.3);
    a *= 0.5;
  }
  return s;
}
void main() {
  float lon = (vUv.x - 0.5) * 6.28318530718;
  float lat = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  vec3 q = dir * vec3(2.1, 4.6, 2.1);                      // zonal (east-west) streaking
  vec3 w = vec3(fbm(q + vec3(0.0, 1.3, 5.1), 4), fbm(q + vec3(5.2, 1.7, 2.9), 4), fbm(q + vec3(2.1, 7.9, 3.3), 4));
  float n = fbm(q * 1.7 + w * 1.3, 7);
  float latD = lat * 57.2957795;
  float bias = 0.2 * exp(-pow((latD - 6.0) / 6.5, 2.0))             // ITCZ
             - 0.2 * exp(-pow((abs(latD) - 24.0) / 9.0, 2.0))       // subtropical dry belts
             + 0.16 * exp(-pow((abs(latD) - 56.0) / 13.0, 2.0))     // storm tracks
             - 0.05;
  float c = smoothstep(-0.05, 0.75, n + bias);
  c = c * c * (0.6 + 0.4 * smoothstep(0.2, 0.7, n + bias));
  c *= 1.0 - 0.6 * smoothstep(70.0, 88.0, abs(latD));
  gl_FragColor = vec4(c, c, c, 1.0);
}
`;

/* ------------------------------------------------------------------------ */
/* LineMaterial patch: morph both endpoints before projection                */
/* ------------------------------------------------------------------------ */

const LINE_START = "vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );";
const LINE_END = "vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );";
const LINE_POS = "gl_Position = clip;";
const LINE_FRAG_OUT = "gl_FragColor = vec4( diffuseColor.rgb, alpha );";

export function patchLineShader(shader: { vertexShader: string; fragmentShader: string }): void {
  let v = shader.vertexShader;
  let f = shader.fragmentShader;
  if (!v.includes(LINE_START) || !v.includes(LINE_END) || !v.includes(LINE_POS) || !f.includes(LINE_FRAG_OUT)) {
    throw new Error("EarthEngine: LineMaterial shader layout changed — cannot apply morph patch");
  }
  v = v.replace(
    "#include <common>",
    `#include <common>
${MORPH_CHUNK}
uniform vec2 uFade;
uniform vec3 uSunEarth;     // subsolar unit vector (earth frame)
uniform float uLineNight;   // 0..1: dim overlays on the night side (globe only)
varying float vEsFade;`,
  );
  v = v.replace(
    LINE_START,
    `vec3 esNS; vec3 esNE;
    vec3 esPS = esMorphDeg(instanceStart.xy, instanceStart.z, esNS);
    vec3 esPE = esMorphDeg(instanceEnd.xy, instanceEnd.z, esNE);
    float esLS = esWrap(instanceStart.x * ES_DEG - uLon0);
    float esLE = esWrap(instanceEnd.x * ES_DEG - uLon0);
    // segments straddling the map seam (lon0 ± 180°) would streak across the map: collapse them
    float esCollapse = (uMorph > 1.0e-4 && abs(esLE - esLS) > ES_PI) ? 1.0 : 0.0;
    float esFS = smoothstep(uFade.x, uFade.y, esFacing(esPS, esNS));
    float esFE = smoothstep(uFade.x, uFade.y, esFacing(esPE, esNE));
    if (esFS <= 0.0 && esFE <= 0.0) esCollapse = 1.0;
    vec2 esLL = ((position.y < 0.5) ? instanceStart.xy : instanceEnd.xy) * ES_DEG;
    vec3 esE = vec3(cos(esLL.y) * cos(esLL.x), cos(esLL.y) * sin(esLL.x), sin(esLL.y));
    float esNight = 1.0 - smoothstep(-0.12, 0.1, dot(esE, uSunEarth));
    vEsFade = ((position.y < 0.5) ? esFS : esFE) * (1.0 - 0.55 * uLineNight * esNight);
    vec4 start = modelViewMatrix * vec4( esPS, 1.0 );`,
  );
  v = v.replace(LINE_END, "vec4 end = modelViewMatrix * vec4( esPE, 1.0 );");
  v = v.replace(LINE_POS, `${LINE_POS}\n\t\t\tif ( esCollapse > 0.5 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );`);
  f = f.replace("#include <common>", "#include <common>\nvarying float vEsFade;");
  f = f.replace(LINE_FRAG_OUT, "gl_FragColor = vec4( diffuseColor.rgb, alpha * vEsFade );");
  shader.vertexShader = v;
  shader.fragmentShader = f;
}

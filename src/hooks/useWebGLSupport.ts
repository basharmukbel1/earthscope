/* ==========================================================================
   useWebGLSupport — synchronous, cached WebGL capability probe.
   The probe context is released immediately (WEBGL_lose_context) so it never
   counts against the browser's live-context limit.
   ========================================================================== */

import { useState } from "react";

export interface WebGLSupportInfo {
  supported: boolean;
  webgl2: boolean;
  /** Software rasterizer (SwiftShader / llvmpipe / WARP …) — works, but slowly. */
  software: boolean;
  renderer?: string;
}

let cached: WebGLSupportInfo | null = null;

export function detectWebGL(): WebGLSupportInfo {
  if (cached) return cached;
  if (typeof document === "undefined") return { supported: false, webgl2: false, software: false };
  let info: WebGLSupportInfo = { supported: false, webgl2: false, software: false };
  try {
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false, powerPreference: "default" };
    const gl2 = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
    const gl = gl2 ?? (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null);
    if (gl) {
      let renderer: string | undefined;
      try {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : undefined;
      } catch {
        renderer = undefined;
      }
      info = {
        supported: true,
        webgl2: !!gl2,
        software: !!renderer && /swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer),
        renderer,
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    info = { supported: false, webgl2: false, software: false };
  }
  cached = info;
  return info;
}

/** True when a WebGL (1 or 2) context can be created. Stable for the page lifetime. */
export function useWebGLSupport(): boolean {
  const [supported] = useState(() => detectWebGL().supported);
  return supported;
}

export default useWebGLSupport;

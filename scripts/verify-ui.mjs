// UI verification: visits every route at several viewports with the locally
// installed Microsoft Edge (playwright-core, no browser download), saves
// screenshots to .verify/, records console errors and failed requests, and
// checks that the WebGL globe canvas actually drew pixels.
//
// Usage: node scripts/verify-ui.mjs [baseUrl] [--routes=/,/explorer] [--widths=1440,390] [--headed]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const routesArg = args.find((a) => a.startsWith("--routes="));
const widthsArg = args.find((a) => a.startsWith("--widths="));
const headed = args.includes("--headed");
const ROUTES = routesArg
  ? routesArg.slice(9).split(",")
  : ["/", "/discover", "/investigate", "/workspace", "/trend-lab", "/explorer", "/compare", "/relationships", "/ai-scientist", "/reports", "/resources", "/guide", "/nope-404"];
const VIEWPORTS = (widthsArg ? widthsArg.slice(9).split(",").map(Number) : [1440, 1280, 834, 390]).map((w) => ({
  width: w,
  height: w >= 1280 ? 900 : w >= 800 ? 1112 : 844,
}));

mkdirSync(".verify", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: !headed,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const report = [];
let failures = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: "reduce" });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const errors = [];
    const failed = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => {
      const u = r.url();
      if (!u.includes("gibs.earthdata") && !u.includes("power.larc")) failed.push(`${u} ${r.failure()?.errorText}`);
    });
    const t0 = Date.now();
    await page.goto(base + route, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => errors.push(`goto: ${e.message}`));
    await page.waitForTimeout(route === "/" || route === "/explorer" ? 3500 : 1200);
    // globe pixel check
    let globe = null;
    if (route === "/" || route === "/explorer") {
      globe = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return { canvas: false };
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        if (!gl) return { canvas: true, webgl: false };
        const w = gl.drawingBufferWidth,
          h = gl.drawingBufferHeight;
        const px = new Uint8Array(4 * 9);
        let lit = 0;
        let k = 0;
        for (const fx of [0.3, 0.5, 0.7])
          for (const fy of [0.3, 0.5, 0.7]) {
            gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px.subarray(k * 4, k * 4 + 4));
            k++;
          }
        for (let i = 0; i < 9; i++) if (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 30) lit++;
        return { canvas: true, webgl: true, w, h, litSamples: lit };
      });
    }
    const name = `${vp.width}${route.replace(/\//g, "_") || "_home"}.png`;
    await page.screenshot({ path: `.verify/${name}`, fullPage: route !== "/explorer" });
    const entry = { viewport: vp.width, route, ms: Date.now() - t0, errors, failed, globe, screenshot: `.verify/${name}` };
    if (errors.length || failed.length) failures++;
    report.push(entry);
    console.log(`${vp.width}px ${route.padEnd(16)} ${errors.length ? "✗ " + errors.length + " errors" : "✓"}${failed.length ? ` · ${failed.length} failed requests` : ""}${globe ? ` · globe ${JSON.stringify(globe)}` : ""}`);
    for (const e of errors.slice(0, 4)) console.log("    " + e.slice(0, 300));
    for (const f of failed.slice(0, 4)) console.log("    failed: " + f.slice(0, 300));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
writeFileSync(".verify/report.json", JSON.stringify(report, null, 2));
console.log(failures ? `\n${failures} page(s) with errors` : "\nAll pages clean");
process.exit(failures ? 1 : 0);

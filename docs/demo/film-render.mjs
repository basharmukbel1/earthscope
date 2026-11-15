import { chromium } from "playwright-core";
import path from "node:path";
import { pathToFileURL } from "node:url";
const FPS = 24, DUR = 30;
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await p.goto(pathToFileURL(path.resolve("docs/demo/film.html")).href, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
for (let i = 0; i < FPS * DUR; i++) {
  await p.evaluate((t) => window.setT(t), i / FPS);
  await p.screenshot({ path: `.verify/film/f${String(i).padStart(4, "0")}.jpg`, type: "jpeg", quality: 92 });
}
await b.close();
console.log("frames done");

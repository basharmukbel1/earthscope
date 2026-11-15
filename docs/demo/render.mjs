// Render docs/demo/deck.html to public/EARTHSCOPE-demo.pdf (7 slides, 1280×720) with installed Edge.
import { chromium } from "playwright-core";
import path from "node:path";
import { pathToFileURL } from "node:url";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto(pathToFileURL(path.resolve("docs/demo/deck.html")).href, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: "public/EARTHSCOPE-demo.pdf", width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
for (let i = 0; i < 7; i++) {
  await p.evaluate((y) => window.scrollTo(0, y), i * 720);
  await p.screenshot({ path: `.verify/deck-${i + 1}.png` });
}
await b.close();
console.log("ok");

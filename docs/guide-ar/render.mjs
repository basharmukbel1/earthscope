// Renders docs/guide-ar/guide.html → docs/EARTHSCOPE-Guide-AR.pdf with Microsoft Edge,
// checks every page for overflow, and saves page previews for visual QA.
// Usage: node docs/guide-ar/render.mjs
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const url = pathToFileURL(resolve("docs/guide-ar/guide.html")).href;
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.4 });
await p.goto(url, { waitUntil: "networkidle" });
await p.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
});
await p.emulateMedia({ media: "print" });

const report = await p.evaluate(() => {
  const mm = 96 / 25.4;
  return [...document.querySelectorAll(".page")].map((pg, i) => {
    const top = pg.getBoundingClientRect().top;
    const limit = pg.clientHeight - 15 * mm; // keep clear of the footer
    let maxBottom = 0;
    let culprit = "";
    pg.querySelectorAll(":scope > *:not(.foot):not(.run):not(.hero)").forEach((el) => {
      const bt = el.getBoundingClientRect().bottom - top;
      if (bt > maxBottom) {
        maxBottom = bt;
        culprit = String(el.className || el.tagName);
      }
    });
    return { page: i + 1, overflowMm: +((maxBottom - limit) / mm).toFixed(1), last: culprit };
  });
});
console.table(report);
console.log("IBM Plex Sans Arabic loaded:", await p.evaluate(() => document.fonts.check('12px "IBM Plex Sans Arabic"')));

mkdirSync("docs/guide-ar/preview", { recursive: true });
const pages = await p.$$(".page");
for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({ path: `docs/guide-ar/preview/p${String(i + 1).padStart(2, "0")}.jpg`, type: "jpeg", quality: 80 });
}
await p.pdf({ path: "docs/EARTHSCOPE-Guide-AR.pdf", format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
await b.close();
console.log("pdf written: docs/EARTHSCOPE-Guide-AR.pdf");

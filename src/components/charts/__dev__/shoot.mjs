// Dev-only: screenshot the chart QA gallery with installed Microsoft Edge.
// Usage: node src/components/charts/__dev__/shoot.mjs <outDir> [url]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? ".";
const url = process.argv[3] ?? "http://localhost:5178/__dev__/index.html";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const problems = [];
for (const width of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: width < 500 ? 2 : 1 });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`[${width}] console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`[${width}] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ["--color-rise", "--color-fall", "--color-cyan", "--chart-series", "--color-surface", "--color-ink-4", "--font-mono"].map((v) => `${v}=${cs.getPropertyValue(v).trim()}`);
  });
  if (width === 1440) console.log("CSS vars:", vars.join(" | "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`[${width}] horizontal overflow ${overflow}px`);
  await page.screenshot({ path: join(out, `gallery-${width}.png`), fullPage: true });
  const all = page.locator(".es-frame, .g-tiles");
  const nAll = await all.count();
  for (let i = 0; i < nAll; i++) await all.nth(i).screenshot({ path: join(out, `frame-${String(i + 1).padStart(2, "0")}-${width}.png`) });

  // Interaction: hover the hero chart, focus + arrow the matrix.
  const plots = page.locator(".es-plot");
  const first = plots.nth(0);
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.4);
    await page.waitForTimeout(300);
    await page.locator(".es-frame").nth(0).screenshot({ path: join(out, `hover-ts-${width}.png`) });
  }
  const frames = page.locator(".es-frame");
  const count = await frames.count();
  for (let i = 0; i < count; i++) {
    const f = frames.nth(i);
    const title = (await f.locator(".es-title").first().textContent().catch(() => "")) ?? "";
    if (/Correlation matrix|Trend by region|Does rainfall|Has the rainy|Rainfall vs|Monthly anomalies/.test(title)) {
      const plot = f.locator(".es-plot").first();
      await plot.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(250);
      const slug = title.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 24);
      await f.screenshot({ path: join(out, `focus-${slug}-${width}.png`) });
      await page.keyboard.press("Escape");
    }
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "No console errors or warnings.");

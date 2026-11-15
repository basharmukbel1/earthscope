// Captures the screenshots used in the Arabic guide (docs/guide-ar/img).
import { chromium } from "playwright-core";
const BASE = process.argv[2] ?? "http://localhost:4317";
const OUT = "docs/guide-ar/img";
const b = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const shot = (p, name, opts = {}) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 86, ...opts });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const newPage = async (h = 900) => (await b.newContext({ viewport: { width: 1440, height: h }, deviceScaleFactor: 1.5 })).newPage();

// 1 Home hero + science section
let p = await newPage();
await p.goto(BASE + "/", { waitUntil: "networkidle" }); await wait(4500);
await shot(p, "01-home");
await p.evaluate(() => document.querySelectorAll("section")[3]?.scrollIntoView()); await wait(3000);
await shot(p, "02-home-science");

// 2 Discovery with detail
await p.goto(BASE + "/discover?v=precip", { waitUntil: "networkidle" }); await wait(2500);
await p.evaluate(() => window.scrollTo(0, 330)); await wait(2500);
await shot(p, "03-discover");

// 3 Wizard demo mid-run (region step)
await p.goto(BASE + "/investigate?demo=levant-compare", { waitUntil: "networkidle" }); await wait(9300);
await shot(p, "04-wizard");
await p.close();

// 4 Jordan journey: workspace, trend lab, report
p = await newPage(1000);
await p.goto(BASE + "/investigate?demo=jordan-precip", { waitUntil: "networkidle" });
await p.waitForURL(/workspace/, { timeout: 60000 });
await p.getByText("Trend finding").waitFor({ timeout: 120000 }); await wait(3000);
await p.evaluate(() => window.scrollTo(0, 120)); await wait(800);
await shot(p, "05-workspace");
await p.click('a[href="/trend-lab"] >> nth=0'); await wait(4500);
await p.evaluate(() => window.scrollTo(0, 120)); await wait(1500);
await shot(p, "06-trendlab");
await p.evaluate(() => window.scrollTo(0, 1650)); await wait(2500);
await shot(p, "07-trendlab-seasonal");
await p.click('a[href="/reports"] >> nth=0'); await wait(1500);
await p.getByRole("button", { name: "Generate from current investigation" }).click(); await wait(3000);
await p.evaluate(() => window.scrollTo(0, 150)); await wait(800);
await shot(p, "08-report");
await p.close();

// 5 Explorer: globe, unfold with layer
p = await newPage();
await p.goto(BASE + "/explorer", { waitUntil: "networkidle" }); await wait(5000);
await shot(p, "09-explorer-globe");
await p.mouse.click(780, 430); await wait(1200);
await p.getByRole("button", { name: "Unfold to map" }).click(); await wait(3000);
await p.selectOption('select[aria-label="Imagery layer"]', { index: 1 }); await wait(6000);
await shot(p, "10-explorer-map");
await p.close();

// 6 Levant comparison, AI, relationships
p = await newPage(1000);
await p.goto(BASE + "/investigate?demo=levant-compare", { waitUntil: "networkidle" });
await p.waitForURL(/compare/, { timeout: 60000 });
await p.getByText("Fig. 1 · Trend rates").waitFor({ timeout: 180000 }); await wait(3500);
await p.evaluate(() => window.scrollTo(0, 110)); await wait(800);
await shot(p, "11-compare");
await p.click('a[href="/ai-scientist"] >> nth=0'); await wait(1500);
await p.getByRole("button", { name: "Why are these two regions showing opposite precipitation trends?" }).click(); await wait(2500);
await shot(p, "12-ai");
await p.click('a[href="/relationships"] >> nth=0');
await p.getByText("Fig. 1 · Anomaly comparison").waitFor({ timeout: 180000 }); await wait(3500);
await p.evaluate(() => window.scrollTo(0, 400)); await wait(1500);
await shot(p, "13-relationships");
await p.close();
await b.close();
console.log("done");

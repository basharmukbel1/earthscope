// Copy dist/index.html → dist/404.html so client-side routes (e.g. /explorer)
// work on static hosts such as GitHub Pages / Netlify without rewrites.
import { copyFileSync, existsSync } from "node:fs";

if (existsSync("dist/index.html")) {
  copyFileSync("dist/index.html", "dist/404.html");
  console.log("postbuild: dist/404.html created (SPA fallback)");
}

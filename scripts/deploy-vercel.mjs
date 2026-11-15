// Build locally and deploy dist/ to Vercel production as a static site.
// (Avoids `vercel build`, which needs symlink permissions on Windows.)
// Usage: npm run deploy     — requires `npx vercel login` and `npx vercel link` once.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd, cwd = ".") => execSync(cmd, { stdio: "inherit", cwd });

if (!existsSync(".vercel/project.json")) {
  console.error("No Vercel project linked. Run: npx vercel link --yes --project earthscope");
  process.exit(1);
}
run("npm run build");
mkdirSync("dist/.vercel", { recursive: true });
copyFileSync(".vercel/project.json", "dist/.vercel/project.json");
const root = JSON.parse(readFileSync("vercel.json", "utf8"));
writeFileSync(
  "dist/vercel.json",
  JSON.stringify({ framework: null, buildCommand: "", installCommand: "", outputDirectory: ".", rewrites: root.rewrites, headers: root.headers }, null, 2),
);
run("npx --yes vercel@latest deploy --prod --yes", "dist");

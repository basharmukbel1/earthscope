import { Suspense, useEffect } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { TopNav } from "@/components/navigation/TopNav";
import { Footer } from "@/components/navigation/Footer";
import { useInvestigation } from "@/store/investigation";
import { getVariable } from "@/data/catalog";
import { DEMO_BY_ID } from "@/data/demos";

const TITLES: Record<string, string> = {
  "/": "EARTHSCOPE — Discover Earth's Hidden Changes",
  "/discover": "Discovery Studio · EARTHSCOPE",
  "/investigate": "New Investigation · EARTHSCOPE",
  "/workspace": "Investigation Workspace · EARTHSCOPE",
  "/trend-lab": "Trend Lab · EARTHSCOPE",
  "/explorer": "Earth Explorer · EARTHSCOPE",
  "/compare": "Regional Comparison · EARTHSCOPE",
  "/relationships": "Relationship Lab · EARTHSCOPE",
  "/ai-scientist": "AI Scientist · EARTHSCOPE",
  "/reports": "Scientific Reports · EARTHSCOPE",
  "/resources": "Resources & Data Sources · EARTHSCOPE",
};

/** Pages that render edge-to-edge under a transparent nav and hide the footer. */
const IMMERSIVE = new Set(["/explorer"]);

export function PageLoader() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border border-[var(--color-line-strong)]" />
          <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-[var(--color-cyan)] [animation-duration:1.2s]" />
        </div>
        <span className="label-mono">Loading page</span>
      </div>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const immersive = IMMERSIVE.has(location.pathname);

  useEffect(() => {
    document.title = TITLES[location.pathname] ?? "EARTHSCOPE";
  }, [location.pathname]);

  // Restore the last investigation after a page reload: only the config is
  // persisted; NASA POWER responses are cached in IndexedDB, so this is fast.
  useEffect(() => {
    const s = useInvestigation.getState();
    const restorable = s.config && s.status === "idle" && Object.keys(s.series).length === 0 && s.config.regions.length > 0;
    const analysisPage = ["/workspace", "/trend-lab", "/compare", "/relationships", "/ai-scientist", "/reports"].includes(location.pathname);
    if (!restorable || !analysisPage) return;
    const demo = s.config!.demoId ? DEMO_BY_ID[s.config!.demoId] : undefined;
    if (demo) void s.openDemo(demo);
    else if (s.config!.variableIds.some((id) => getVariable(id)?.connector.kind === "power")) void s.run(s.config!);
  }, [location.pathname]);

  return (
    <div className="relative min-h-dvh bg-[var(--color-void)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--color-cyan)] focus:px-3 focus:py-2 focus:text-[#021018]"
      >
        Skip to content
      </a>
      <TopNav />
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          id="main"
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </motion.main>
      </AnimatePresence>
      {!immersive && <Footer />}
      <ScrollRestoration />
    </div>
  );
}

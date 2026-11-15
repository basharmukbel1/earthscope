import { Link } from "react-router";
import { Logo } from "./Logo";

const COLS = [
  {
    title: "Investigate",
    links: [
      { to: "/guide", label: "How to use EARTHSCOPE" },
      { to: "/discover", label: "Discovery Studio" },
      { to: "/investigate", label: "New investigation" },
      { to: "/workspace", label: "Workspace" },
      { to: "/explorer", label: "Earth Explorer" },
    ],
  },
  {
    title: "Analyse",
    links: [
      { to: "/trend-lab", label: "Trend Lab" },
      { to: "/compare", label: "Regional Comparison" },
      { to: "/relationships", label: "Relationship Lab" },
      { to: "/ai-scientist", label: "AI Scientist" },
    ],
  },
  {
    title: "Publish",
    links: [
      { to: "/reports", label: "Scientific Reports" },
      { to: "/resources", label: "Resources & Methods" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-[var(--color-line)] bg-[var(--color-void)] no-print">
      <div className="container-x grid gap-12 py-16 md:grid-cols-[1.4fr_2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm font-display text-xl leading-snug tracking-[-0.02em] text-[var(--color-ink-2)]">
            Discover Earth's hidden changes.
          </p>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-[var(--color-ink-3)]">
            Built for the NASA Space Apps Challenge 2026 — “Be An Earth System Trend Detective!”. Data: NASA POWER (MERRA-2 / CERES), NASA GIBS
            imagery, NSIDC Sea Ice Index and MODIS land products. EARTHSCOPE is an independent project and is not an official NASA product; no
            endorsement is implied.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="label-mono mb-4">{c.title}</div>
              <ul className="space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="text-sm text-[var(--color-ink-2)] transition-colors hover:text-[var(--color-ink)]">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--color-line)]">
        <div className="container-x flex flex-col gap-2 pb-20 pt-5 text-[11px] text-[var(--color-ink-4)] md:flex-row md:items-center md:justify-between">
          <span className="font-mono uppercase tracking-[0.14em]">EARTHSCOPE · Earth System Trend Detection · v1.0</span>
          <span>
            AI disclosure: AI tools assisted in building this software. The in-app “AI Scientist” is a rule-based analyst unless a language model
            is connected, and it always labels which one answered.
          </span>
        </div>
      </div>
    </footer>
  );
}

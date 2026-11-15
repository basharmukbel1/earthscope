import { NavLink } from "react-router";
import { BarChart3, BrainCircuit, FileText, GitCompareArrows, LayoutDashboard, Network } from "lucide-react";
import { useInvestigation } from "@/store/investigation";
import { cn } from "@/utils/cn";

const STEPS = [
  { to: "/workspace", label: "Workspace", icon: LayoutDashboard },
  { to: "/trend-lab", label: "Trend Lab", icon: BarChart3 },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/relationships", label: "Relationships", icon: Network },
  { to: "/ai-scientist", label: "AI Scientist", icon: BrainCircuit },
  { to: "/reports", label: "Report", icon: FileText },
];

/** Secondary navigation that ties the analysis pages into one investigation flow. */
export function InvestigationRail() {
  const config = useInvestigation((s) => s.config);
  return (
    <div className="sticky top-[var(--nav-h)] z-[var(--z-sticky)] border-b border-[var(--color-line)] bg-[rgb(4_6_12/.82)] backdrop-blur-xl no-print">
      <div className="container-x flex h-12 items-center gap-4 overflow-x-auto">
        <div className="hidden min-w-0 shrink items-center gap-2 md:flex">
          <span className="label-mono shrink-0 text-[var(--color-cyan)]">Case</span>
          <span className="max-w-[28ch] truncate text-xs text-[var(--color-ink-2)]" title={config?.question}>
            {config?.question ?? "No active investigation"}
          </span>
          <span className="mx-1 h-4 w-px bg-[var(--color-line-strong)]" />
        </div>
        <nav aria-label="Investigation" className="flex items-center gap-0.5">
          {STEPS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  isActive ? "bg-[var(--color-cyan-soft)] text-[var(--color-cyan)]" : "text-[var(--color-ink-3)] hover:bg-white/5 hover:text-[var(--color-ink)]",
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

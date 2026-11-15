import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, FolderClock, Menu, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Logo } from "./Logo";
import { ButtonLink } from "@/components/ui/Button";
import { useInvestigation } from "@/store/investigation";

const PRIMARY = [
  { to: "/discover", label: "Discover" },
  { to: "/investigate", label: "Investigations" },
  { to: "/explorer", label: "Earth Explorer" },
  { to: "/trend-lab", label: "Trend Lab" },
  { to: "/ai-scientist", label: "AI Scientist" },
];

const MORE = [
  { to: "/guide", label: "How to use EARTHSCOPE", note: "A 2-minute guide for first-time visitors" },
  { to: "/workspace", label: "Investigation Workspace", note: "Your active analysis" },
  { to: "/compare", label: "Regional Comparison", note: "Same variable, many regions" },
  { to: "/relationships", label: "Relationship Lab", note: "How variables move together" },
  { to: "/reports", label: "Scientific Reports", note: "Generate & export findings" },
  { to: "/resources", label: "Resources & Methods", note: "Data sources, challenge resources" },
];

function useScrolled(threshold = 24) {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return s;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

export function TopNav() {
  const scrolled = useScrolled();
  const { pathname } = useLocation();
  const [mobile, setMobile] = useState(false);
  const [more, setMore] = useState(false);
  const [ws, setWs] = useState(false);
  const moreRef = useRef<HTMLLIElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);
  useClickOutside(moreRef, () => setMore(false));
  useClickOutside(wsRef, () => setWs(false));
  const history = useInvestigation((s) => s.history);
  const reports = useInvestigation((s) => s.reports);
  const config = useInvestigation((s) => s.config);

  useEffect(() => {
    setMobile(false);
    setMore(false);
    setWs(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobile ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobile]);

  const transparent = (pathname === "/" || pathname === "/explorer") && !scrolled && !mobile;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[var(--z-nav)] transition-[background,border-color,backdrop-filter] duration-500",
        transparent
          ? "border-b border-transparent bg-gradient-to-b from-[rgb(4_6_12/.55)] to-transparent"
          : "border-b border-[var(--color-line)] bg-[rgb(4_6_12/.72)] backdrop-blur-xl",
      )}
    >
      <nav aria-label="Primary" className="container-x flex h-[var(--nav-h)] items-center justify-between gap-6">
        <Link to="/" aria-label="EARTHSCOPE home" className="shrink-0 rounded-md">
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {PRIMARY.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    "relative inline-flex h-9 items-center rounded-md px-3 text-[13px] font-medium tracking-[0.01em] transition-colors",
                    isActive ? "text-[var(--color-ink)]" : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {l.label}
                    {isActive && (
                      <motion.span layoutId="nav-dot" className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--color-cyan)] shadow-[0_0_8px_var(--color-cyan)]" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="relative" ref={moreRef}>
            <button
              aria-expanded={more}
              aria-haspopup="menu"
              onClick={() => setMore((m) => !m)}
              className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-[13px] font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              Labs <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} />
            </button>
            <AnimatePresence>
              {more && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="glass absolute right-0 top-11 w-72 rounded-[var(--radius-lg)] p-1.5 shadow-[var(--shadow-float)]"
                >
                  {MORE.map((m) => (
                    <Link key={m.to} role="menuitem" to={m.to} className="block rounded-[var(--radius-md)] px-3 py-2.5 hover:bg-white/[0.05]">
                      <div className="text-sm text-[var(--color-ink)]">{m.label}</div>
                      <div className="text-xs text-[var(--color-ink-3)]">{m.note}</div>
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        </ul>

        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block" ref={wsRef}>
            <button
              aria-expanded={ws}
              aria-haspopup="dialog"
              onClick={() => setWs((v) => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-[13px] text-[var(--color-ink-2)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            >
              <FolderClock className="h-4 w-4" />
              <span className="hidden xl:inline">My workspace</span>
              {history.length + reports.length > 0 && (
                <span className="num rounded-full bg-[var(--color-cyan-soft)] px-1.5 font-mono text-[10px] text-[var(--color-cyan)]">{history.length + reports.length}</span>
              )}
            </button>
            <AnimatePresence>
              {ws && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="glass absolute right-0 top-11 w-80 rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-float)]"
                >
                  <div className="label-mono mb-2">Saved in this browser</div>
                  <p className="mb-3 text-xs text-[var(--color-ink-3)]">
                    EARTHSCOPE has no accounts — investigations and reports are stored locally on this device.
                  </p>
                  {config && (
                    <Link to="/workspace" className="mb-2 block rounded-md border border-[var(--color-line)] px-3 py-2 hover:border-[var(--color-line-strong)]">
                      <div className="label-mono text-[var(--color-cyan)]">Active</div>
                      <div className="truncate text-sm">{config.question}</div>
                    </Link>
                  )}
                  <div className="space-y-1">
                    {history.slice(0, 4).map((h) => (
                      <div key={h.id} className="truncate text-xs text-[var(--color-ink-2)]">· {h.question}</div>
                    ))}
                    {history.length === 0 && <div className="text-xs text-[var(--color-ink-4)]">No investigations yet.</div>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <ButtonLink to="/reports" size="sm" variant="subtle">
                      Reports ({reports.length})
                    </ButtonLink>
                    <ButtonLink to="/investigate" size="sm" variant="ghost">
                      New
                    </ButtonLink>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="hidden sm:block">
            <ButtonLink to="/investigate" variant="primary" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
              Start Investigating
            </ButtonLink>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-ink)] hover:bg-white/5 lg:hidden"
            aria-label={mobile ? "Close menu" : "Open menu"}
            aria-expanded={mobile}
            onClick={() => setMobile((m) => !m)}
          >
            {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 bottom-0 top-[var(--nav-h)] overflow-y-auto bg-[rgb(4_6_12/.97)] backdrop-blur-xl lg:hidden"
          >
            <div className="container-x py-6">
              {[...PRIMARY, ...MORE.map((m) => ({ to: m.to, label: m.label }))].map((l, i) => (
                <motion.div key={l.to} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                  <NavLink
                    to={l.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-between border-b border-[var(--color-line)] py-4 font-display text-2xl tracking-[-0.02em]",
                        isActive ? "text-[var(--color-cyan)]" : "text-[var(--color-ink)]",
                      )
                    }
                  >
                    {l.label}
                    <ArrowRight className="h-5 w-5 opacity-40" />
                  </NavLink>
                </motion.div>
              ))}
              <ButtonLink to="/investigate" variant="primary" size="lg" className="mt-8 w-full">
                Start Investigating
              </ButtonLink>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

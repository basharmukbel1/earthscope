import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { SeriesProvenance, TrendDirection } from "@/types/domain";

type Tone = "neutral" | "cyan" | "ice" | "violet" | "rise" | "fall" | "flat" | "warn" | "danger";

const tones: Record<Tone, string> = {
  neutral: "text-[var(--color-ink-2)] border-[var(--color-line-strong)] bg-white/[0.03]",
  cyan: "text-[var(--color-cyan)] border-[rgb(56_225_255/.35)] bg-[var(--color-cyan-soft)]",
  ice: "text-[var(--color-ice)] border-[rgb(168_216_255/.3)] bg-[var(--color-ice-soft)]",
  violet: "text-[#cfc7ff] border-[rgb(155_140_255/.38)] bg-[var(--color-violet-soft)]",
  rise: "text-[var(--color-rise)] border-[rgb(95_211_160/.38)] bg-[var(--color-rise-soft)]",
  fall: "text-[var(--color-fall)] border-[rgb(255_138_107/.38)] bg-[var(--color-fall-soft)]",
  flat: "text-[#b9c3d8] border-[rgb(138_151_177/.4)] bg-transparent border-dashed",
  warn: "text-[var(--color-warn)] border-[rgb(245_197_107/.35)] bg-[rgb(245_197_107/.1)]",
  danger: "text-[#ffb3bd] border-[rgb(255_107_125/.4)] bg-[rgb(255_107_125/.1)]",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  icon,
  mono = true,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5",
        mono ? "font-mono text-[10.5px] uppercase tracking-[0.12em]" : "text-xs",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export const TREND_GLYPH: Record<TrendDirection, string> = { increasing: "▲", decreasing: "▼", "no-trend": "◆" };

/** Direction + significance — never color alone: glyph, label and dashed border carry meaning. */
export function TrendBadge({
  direction,
  significant,
  className,
  compact,
}: {
  direction: TrendDirection;
  significant: boolean;
  className?: string;
  compact?: boolean;
}) {
  const tone: Tone = !significant ? "flat" : direction === "increasing" ? "rise" : direction === "decreasing" ? "fall" : "flat";
  const word = direction === "increasing" ? "Increasing" : direction === "decreasing" ? "Decreasing" : "No change";
  return (
    <Badge tone={tone} className={className} title={significant ? "Statistically significant" : "Not statistically significant"}>
      <span aria-hidden className={cn(!significant && "opacity-70")}>
        {significant ? TREND_GLYPH[direction] : direction === "increasing" ? "△" : direction === "decreasing" ? "▽" : "◇"}
      </span>
      {word}
      {!compact && <span className="opacity-75">· {significant ? "significant" : "not significant"}</span>}
    </Badge>
  );
}

export function SourceBadge({ provenance, className }: { provenance: SeriesProvenance; className?: string }) {
  const map: Record<SeriesProvenance["mode"], { tone: Tone; label: string; title: string }> = {
    live: { tone: "cyan", label: "Retrieved live · NASA POWER", title: "Fetched from the NASA POWER API during this session" },
    snapshot: {
      tone: "ice",
      label: `Real-data snapshot${provenance.retrieved ? " · " + provenance.retrieved.slice(0, 10) : ""}`,
      title: "Real data bundled with EARTHSCOPE (retrieval date shown)",
    },
    import: { tone: "neutral", label: "Imported file", title: "Time series imported from a file you provided" },
    simulation: { tone: "warn", label: "Simulation · synthetic data", title: "Synthetic teaching data — not an observation" },
  };
  const m = map[provenance.mode];
  return (
    <Badge tone={m.tone} className={className} title={m.title}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", provenance.mode === "live" && "animate-[pulse-soft_2.4s_ease-in-out_infinite]")} />
      {m.label}
    </Badge>
  );
}

export function AIBadge({ engine }: { engine: "local" | "remote" }) {
  return (
    <Badge tone="violet" title={engine === "local" ? "Deterministic rule-based analyst; uses only your computed results" : "Written by a language model that sees only your computed results"}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="currentColor" />
      </svg>
      {engine === "local" ? "Rule-based analyst" : "AI language model"}
    </Badge>
  );
}

import { cn } from "@/utils/cn";

/** EARTHSCOPE mark: an orbit-ring + survey arc around a planet. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--color-ice)" strokeWidth="1.4" />
      <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="var(--color-cyan)" strokeWidth="1.2" opacity=".85" transform="rotate(-18 16 16)" />
      <path d="M16 7.5v17" stroke="var(--color-ice)" strokeWidth=".9" opacity=".45" />
      <path d="M7.6 14.4c3 1.1 13.8 1.1 16.8 0" stroke="var(--color-ice)" strokeWidth=".9" opacity=".45" fill="none" />
      <circle cx="27.2" cy="10.6" r="1.7" fill="var(--color-cyan)" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="font-display text-[15px] font-semibold tracking-[0.22em] text-[var(--color-ink)]">
          EARTH<span className="text-[var(--color-ice)]">SCOPE</span>
        </span>
      )}
    </span>
  );
}

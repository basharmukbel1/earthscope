import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "./Button";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-ice)]">
        <div className="absolute inset-[-6px] rounded-full border border-dashed border-[var(--color-line)]" />
        {icon}
      </div>
      <h3 className="font-display text-lg text-[var(--color-ink)]">{title}</h3>
      {body && <p className="mt-2 max-w-md text-sm text-[var(--color-ink-3)] text-pretty">{body}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  children,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("rounded-[var(--radius-lg)] border border-[rgb(255_107_125/.3)] bg-[rgb(255_107_125/.06)] p-5", className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base text-[var(--color-ink)]">{title}</h3>
          {message && <p className="mt-1 text-sm text-[var(--color-ink-2)] break-words">{message}</p>}
          {children}
          {onRetry && (
            <Button variant="secondary" size="sm" className="mt-3" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max = 1, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100));
  return (
    <div>
      {label && <div className="label-mono mb-2 flex justify-between"><span>{label}</span><span className="num">{Math.round(pct)}%</span></div>}
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--color-cyan)] shadow-[0_0_12px_rgb(56_225_255/.6)] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Scientific "acquisition" loader — shows real progress, not a fake spinner. */
export function AcquisitionLoader({ message, done, total }: { message: string; done: number; total: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-6 py-14 text-center" aria-live="polite">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border border-[var(--color-line-strong)]" />
        <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-[var(--color-cyan)] [animation-duration:1.4s]" />
        <div className="absolute inset-3 rounded-full border border-dashed border-[var(--color-line)]" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-cyan)]" />
      </div>
      <div className="w-full max-w-sm">
        <p className="mb-3 text-sm text-[var(--color-ink-2)]">{message}</p>
        <ProgressBar value={done} max={total} />
      </div>
    </div>
  );
}

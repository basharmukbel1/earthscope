import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { ChevronDown, Info, X } from "lucide-react";
import { cn } from "@/utils/cn";

/* ------------------------------- Tabs ------------------------------------ */
export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  size = "md",
  ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = useId();
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    else return;
    e.preventDefault();
    refs.current[n]?.focus();
    onChange(items[n].id);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("relative flex items-center gap-1 border-b border-[var(--color-line)]", className)}>
      {items.map((it, i) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(it.id)}
            className={cn(
              "relative -mb-px inline-flex items-center gap-2 px-3 font-medium transition-colors",
              size === "sm" ? "h-9 text-xs" : "h-11 text-sm",
              active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]",
            )}
          >
            {it.label}
            {it.badge}
            {active && (
              <motion.span
                layoutId={`tab-underline-${groupId}`}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--color-cyan)] shadow-[0_0_10px_rgb(56_225_255/.7)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Segmented --------------------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
  size = "md",
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("relative inline-flex rounded-[var(--radius-md)] border border-[var(--color-line)] bg-black/20 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-xs",
              active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[7px] border border-[var(--color-line-strong)] bg-[var(--color-surface-3)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- Select ---------------------------------- */
export function Select({ className, label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className="block">
      {label && <span className="label-mono mb-1.5 block">{label}</span>}
      <span className="relative block">
        <select
          id={rest.id ?? id}
          className={cn(
            "h-10 w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] pl-3 pr-9 text-sm text-[var(--color-ink)] hover:border-[var(--color-line-bright)] focus:border-[var(--color-cyan)] focus:outline-none",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]" />
      </span>
    </label>
  );
}

export function TextInput({ className, label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className="block">
      {label && <span className="label-mono mb-1.5 block">{label}</span>}
      <input
        id={rest.id ?? id}
        className={cn(
          "h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)] hover:border-[var(--color-line-bright)] focus:border-[var(--color-cyan)] focus:outline-none",
          className,
        )}
        {...rest}
      />
      {hint && <span className="mt-1.5 block text-xs text-[var(--color-ink-3)]">{hint}</span>}
    </label>
  );
}

/* ------------------------------- Switch ---------------------------------- */
export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-[var(--color-ink-2)]", className)}>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-[rgb(56_225_255/.5)] bg-[rgb(56_225_255/.25)]" : "border-[var(--color-line-strong)] bg-white/5",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all duration-200",
            checked ? "left-[18px] bg-[var(--color-cyan)] shadow-[0_0_8px_rgb(56_225_255/.8)]" : "left-[2px] bg-[var(--color-ink-3)]",
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

/* --------------------------- InfoTip (term) ------------------------------ */
export function InfoTip({ children, label = "More information", className }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={cn("relative inline-flex", className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-ice)]"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="glass absolute bottom-full left-1/2 z-[var(--z-tooltip)] mb-2 w-64 -translate-x-1/2 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-xs leading-relaxed text-[var(--color-ink-2)] shadow-[var(--shadow-float)]"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/* ------------------------------- Dialog ---------------------------------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(640px,calc(100vw-2rem))] rounded-[var(--radius-xl)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0 text-[var(--color-ink)] shadow-[var(--shadow-float)] backdrop:bg-[rgb(2_4_10/.72)] backdrop:backdrop-blur-sm",
        className,
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="font-display text-xl">{title}</h2>
            <button onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-[var(--color-ink-3)] hover:bg-white/5 hover:text-[var(--color-ink)]">
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/* ------------------------- CountUp number -------------------------------- */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", className }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = (v: number) => {
      el.textContent = `${prefix}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
    };
    if (!inView || reduce) {
      render(reduce || inView ? value : 0);
      return;
    }
    const c = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: render });
    return () => c.stop();
  }, [inView, value, decimals, prefix, suffix, reduce]);
  return <span ref={ref} className={cn("num", className)} />;
}

/* ---------------------------- Stat block --------------------------------- */
export function Stat({ label, value, unit, sub, className }: { label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label-mono mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="num font-display text-2xl tracking-[-0.02em] text-[var(--color-ink)]">{value}</span>
        {unit && <span className="font-mono text-xs text-[var(--color-ink-3)]">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--color-ink-3)]">{sub}</div>}
    </div>
  );
}

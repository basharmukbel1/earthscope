import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";

export function Eyebrow({ children, className, index }: { children: ReactNode; className?: string; index?: string }) {
  return (
    <div className={cn("label-mono flex items-center gap-2", className)}>
      {index && <span className="text-[var(--color-cyan)]">{index}</span>}
      {index && <span className="h-px w-5 bg-[var(--color-line-bright)]" />}
      <span>{children}</span>
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className,
  bodyClassName,
  collapsible,
  defaultOpen = true,
  solid,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  solid?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const header = (title || eyebrow || actions) && (
    <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <div className="min-w-0">
        {eyebrow && <div className="label-mono mb-1">{eyebrow}</div>}
        {title && <h3 className="truncate font-display text-[0.95rem] font-medium tracking-[-0.01em] text-[var(--color-ink)]">{title}</h3>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        {collapsible && (
          <button
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-ink-3)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            aria-label={open ? "Collapse panel" : "Expand panel"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", !open && "-rotate-90")} />
          </button>
        )}
      </div>
    </div>
  );
  return (
    <section className={cn(solid ? "panel-solid" : "panel", "overflow-hidden", className)}>
      {header}
      <AnimatePresence initial={false}>
        {(!collapsible || open) && (
          <motion.div
            id={id}
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className={cn("px-4 pb-4", !header && "pt-4", bodyClassName)}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-[var(--color-line)]", className)} />;
}

export function KeyValue({ k, v, mono = true, className }: { k: ReactNode; v: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-sm", className)}>
      <span className="shrink-0 text-[var(--color-ink-3)]">{k}</span>
      <span className={cn("min-w-0 text-right text-[var(--color-ink)]", mono && "num font-mono text-[12.5px]")}>{v}</span>
    </div>
  );
}

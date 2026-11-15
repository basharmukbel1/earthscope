import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "ai" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "transition-[background,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-standard)] " +
  "disabled:opacity-40 disabled:pointer-events-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-cyan)] text-[#021018] hover:bg-[#6deaff] shadow-[0_0_0_1px_rgb(56_225_255/.5),0_10px_30px_-10px_rgb(56_225_255/.55)] hover:shadow-[0_0_0_1px_rgb(109_234_255/.7),0_12px_36px_-8px_rgb(56_225_255/.6)]",
  secondary:
    "bg-white/[0.03] text-[var(--color-ink)] border border-[var(--color-line-strong)] hover:border-[var(--color-line-bright)] hover:bg-white/[0.06] backdrop-blur-md",
  ghost: "text-[var(--color-ink-2)] hover:text-[var(--color-ink)] hover:bg-white/[0.05]",
  subtle: "bg-[var(--color-surface-2)] text-[var(--color-ink)] border border-[var(--color-line)] hover:bg-[var(--color-surface-3)]",
  ai: "bg-[var(--color-violet-soft)] text-[#d6d0ff] border border-[rgb(155_140_255/.35)] hover:bg-[rgb(155_140_255/.22)]",
  danger: "bg-[rgb(255_107_125/.12)] text-[#ffb3bd] border border-[rgb(255_107_125/.35)] hover:bg-[rgb(255_107_125/.2)]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)]",
  md: "h-10 px-4 text-sm rounded-[var(--radius-md)]",
  lg: "h-12 px-6 text-[0.95rem] rounded-[var(--radius-md)] tracking-[-0.005em]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight && <span className="transition-transform duration-300 group-hover/btn:translate-x-0.5">{iconRight}</span>}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function ButtonLink({ variant = "secondary", size = "md", icon, iconRight, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children as ReactNode}
      {iconRight && <span className="transition-transform duration-300 group-hover/btn:translate-x-0.5">{iconRight}</span>}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border text-[var(--color-ink-2)] transition-colors",
        active
          ? "border-[rgb(56_225_255/.45)] bg-[var(--color-cyan-soft)] text-[var(--color-cyan)]"
          : "border-[var(--color-line)] bg-white/[0.02] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

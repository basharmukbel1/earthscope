import { lazy, Suspense, type ComponentProps } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { cn } from "@/utils/cn";

const Globe = lazy(() => import("@/components/earth/Globe"));

type GlobeProps = ComponentProps<typeof Globe>;

/** Poster shown while three.js streams in (and if the globe module fails). */
export function GlobePoster({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)} aria-hidden={!label}>
      <div className="relative aspect-square w-[min(70vmin,720px)] rounded-full">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,#16305a_0%,#0a1a35_45%,#050a16_75%)] shadow-[0_0_120px_10px_rgb(56_140_255/.18)]" />
        <div className="absolute inset-[-2%] rounded-full border border-[rgb(168_216_255/.18)]" />
        <div className="skeleton absolute inset-0 rounded-full opacity-25" />
      </div>
      {label && <span className="label-mono absolute bottom-6">{label}</span>}
    </div>
  );
}

export function GlobeSlot({ className, posterClassName, ...props }: GlobeProps & { posterClassName?: string }) {
  return (
    <ErrorBoundary fallback={<GlobePoster className={posterClassName ?? className} label="3D Earth unavailable on this device" />}>
      <Suspense fallback={<GlobePoster className={posterClassName ?? className} />}>
        <Globe className={className} {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

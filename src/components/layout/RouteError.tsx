import { isRouteErrorResponse, useRouteError } from "react-router";
import { useEffect } from "react";

export function RouteError() {
  const err = useRouteError();
  // Technical details go to the console for developers, never into the page.
  useEffect(() => {
    console.error("[EARTHSCOPE] route error", err);
  }, [err]);
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-void)] px-6 text-[var(--color-ink)]">
      <div className="max-w-lg text-center">
        <div className="label-mono mb-3 text-[var(--color-danger)]">Something went wrong</div>
        <h1 className="font-display text-3xl">{notFound ? "This page doesn't exist." : "This page didn't load."}</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-3)]">
          {notFound ? "Check the address, or head back to EARTHSCOPE." : "This is usually a brief connection problem. Reloading the page normally fixes it."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => location.reload()} className="h-10 rounded-[var(--radius-md)] bg-[var(--color-cyan)] px-4 text-sm font-medium text-[#021018]">
            Reload
          </button>
          <a href="/" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-4 text-sm">
            Back to EARTHSCOPE
          </a>
        </div>
      </div>
    </div>
  );
}

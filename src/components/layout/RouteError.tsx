import { isRouteErrorResponse, useRouteError } from "react-router";

export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : "Unknown error";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-void)] px-6 text-[var(--color-ink)]">
      <div className="max-w-lg text-center">
        <div className="label-mono mb-3 text-[var(--color-danger)]">System fault</div>
        <h1 className="font-display text-3xl">This module failed to load.</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-3)] break-words">{message}</p>
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

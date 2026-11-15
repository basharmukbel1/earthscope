import { Component, type ErrorInfo, type ReactNode } from "react";

/** Contains failures of heavy optional modules (WebGL globe, charts) so a page never blanks. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: (e: Error) => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
    if (import.meta.env.DEV) console.warn("[EARTHSCOPE] module error", error, info.componentStack);
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

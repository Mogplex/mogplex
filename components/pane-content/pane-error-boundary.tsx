"use client";
import { Component, type ReactNode, type ErrorInfo } from "react";

export class PaneErrorBoundary extends Component<
  { children: ReactNode; paneName: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[PaneError] ${this.props.paneName}:`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-muted-foreground text-sm">Pane crashed</div>
          <div className="text-muted-foreground/70 max-w-xs font-mono text-[11px] break-all">
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

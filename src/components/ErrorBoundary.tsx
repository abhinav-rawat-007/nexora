import { Component, type ErrorInfo, type ReactNode } from "react";

/** Catches render crashes in the subtree so one broken component can't blank the whole app. */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error.message || "An unexpected error occurred."}</p>
          <div className="empty-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload Nexora
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

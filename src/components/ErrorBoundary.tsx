import React, { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RotateCcw, Home, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** `app` (default) replaces the whole window; `page` keeps the shell and shows the error inside the workspace. */
  variant?: 'app' | 'page';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/** A lazy page chunk that no longer exists on the server (the app was updated while this tab stayed open). */
const isChunkLoadError = (error: Error | null) =>
  Boolean(error && /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk/i.test(`${error.name} ${error.message}`));

class ErrorBoundary extends (Component as any) {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught component error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  /** Page variant: render the page again without reloading the app (keeps other pages and the session). */
  public handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const chunkError = isChunkLoadError(this.state.error);
      const title = chunkError ? 'App update available' : 'Something went wrong';
      const description = chunkError
        ? 'Mooco ka naya version aa gaya hai. Page reload karein, aapka data mehfooz hai.'
        : this.props.variant === 'page'
          ? 'Is page mein masla aa gaya. Dobara try karein; baqi app theek chal rahi hai.'
          : 'An unexpected error occurred while loading this page';

      const card = (
        <div role="alert" className="w-full max-w-lg space-y-4 rounded-card border border-line bg-surface p-6 text-center shadow-e2">
          <div className={`mx-auto flex size-12 items-center justify-center rounded-2xl ring-1 ring-inset ${chunkError ? 'bg-info-soft text-info-fg ring-info/20' : 'bg-danger-soft text-danger-fg ring-danger/20'}`}>
            {chunkError ? <RefreshCw size={24} /> : <AlertTriangle size={24} />}
          </div>

          <div>
            <h2 className="text-lg font-bold tracking-tight text-fg">{title}</h2>
            <p className="mt-1 text-[13px] text-fg-subtle">{description}</p>
          </div>

          {this.state.error && !chunkError && (
            <div className="max-h-32 overflow-y-auto rounded-control bg-surface-2 p-3 text-left font-mono text-[11px] text-danger-fg ring-1 ring-inset ring-line">
              {this.state.error.toString()}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-center">
            {this.props.variant === 'page' && !chunkError ? (
              <>
                <Button variant="secondary" leftIcon={<RefreshCw />} onClick={this.handleReset}>Reload app</Button>
                <Button leftIcon={<RotateCcw />} onClick={this.handleRetry}>Try again</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" leftIcon={<Home />} onClick={() => { window.location.href = '/dashboard'; }}>Dashboard</Button>
                <Button leftIcon={<RotateCcw />} onClick={this.handleReset}>Refresh Page</Button>
              </>
            )}
          </div>
        </div>
      );

      if (this.props.variant === 'page') {
        return <div className="flex w-full justify-center py-10">{card}</div>;
      }
      return <div className="flex min-h-[100dvh] w-full items-center justify-center bg-canvas p-4 font-sans text-fg">{card}</div>;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

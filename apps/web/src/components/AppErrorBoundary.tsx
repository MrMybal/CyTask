import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, details: ErrorInfo) {
    console.error("CyTask interface error", error, details.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-screen">
          <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
          <h1>L’interface a rencontré un problème</h1>
          <p>Vos données sont intactes. Rechargez l’application pour reprendre.</p>
          <button className="primary-button" type="button"
            onClick={() => window.location.reload()}>
            Recharger CyTask
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { LanguageSwitcher, useI18n } from "../i18n";
import {helpUrl} from "../helpUrl";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

function ErrorFallback() {
  const { t, locale } = useI18n();
  return (
    <main className="fatal-screen">
      <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
      <LanguageSwitcher />
      <h1>{t("The interface encountered a problem")}</h1>
      <p>{t("Your data is safe. Reload the application to continue.")}</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>
        {t("Reload CyTask")}
      </button>
      <a href={helpUrl(locale)} target="_blank" rel="noopener noreferrer">{t("User guide")}</a>
    </main>
  );
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
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}

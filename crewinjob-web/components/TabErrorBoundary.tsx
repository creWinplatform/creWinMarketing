'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useLang } from '@/lib/lang';
import { LazyAttempt } from '@/components/lazy-tab';

// Keeps a crashing tab (or a tab whose code failed to download) inside its own area: the menu, the top bar and the
// other tabs keep working. "Try again" clears the error and loads the tab's code again. Switching tabs clears it too.
type Props = { resetKey?: unknown; children: ReactNode };
type InnerProps = Props & { lang: 'tr' | 'en' };
type State = { error: boolean; attempt: number; key: unknown };

class Boundary extends Component<InnerProps, State> {
  state: State = { error: false, attempt: 0, key: this.props.resetKey };
  static getDerivedStateFromError(): Partial<State> { return { error: true }; }
  static getDerivedStateFromProps(props: InnerProps, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { key: props.resetKey, error: false } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Details stay in the console; the member sees a short card.
    console.error('Tab failed to render', error, info.componentStack);
  }
  retry = () => this.setState(state => ({ error: false, attempt: state.attempt + 1 }));
  render() {
    const tr = this.props.lang === 'tr';
    if (this.state.error) return (
      <div className="studio-card tab-error-card" role="alert">
        <TriangleAlert size={20} aria-hidden="true" />
        <div>
          <strong>{tr ? 'Bu bölüm yüklenemedi.' : 'This section could not be loaded.'}</strong>
          <p>{tr ? 'Bağlantınızı kontrol edip tekrar deneyin. Diğer bölümleri kullanmaya devam edebilirsiniz.' : 'Check your connection and try again. You can keep using the other sections.'}</p>
        </div>
        <button type="button" className="studio-primary" onClick={this.retry}><RotateCw size={15} aria-hidden="true" />{tr ? 'Tekrar dene' : 'Try again'}</button>
      </div>
    );
    return <LazyAttempt.Provider value={this.state.attempt}>{this.props.children}</LazyAttempt.Provider>;
  }
}

export default function TabErrorBoundary(props: Props) {
  const { lang } = useLang();
  return <Boundary {...props} lang={lang === 'en' ? 'en' : 'tr'} />;
}

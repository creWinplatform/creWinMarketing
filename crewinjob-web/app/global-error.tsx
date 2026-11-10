'use client';
import { useEffect, useState } from 'react';
import './ryzevo-tokens.css';
import './accessibility.css';
import { isChunkLoadError, reloadOnceForChunkError } from '@/components/lazy-tab';

// Replaces the root layout when the layout itself fails, so it renders its own <html> and reads the language from the
// cookie or the browser (the language provider is not available here). Details go only to the console.
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const [tr, setTr] = useState(true);
  useEffect(() => {
    console.error('Application error', error);
    const saved = document.cookie.match(/(?:^|;\s*)ryzevo_lang=(tr|en)/)?.[1];
    setTr((saved || (navigator.language || 'tr').slice(0, 2)) !== 'en');
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }, [error]);
  return (
    <html lang={tr ? 'tr' : 'en'}>
      <body>
        <main className="app-error">
          <div className="app-error-panel" role="alert">
            <strong style={{ fontSize: 22, letterSpacing: '-0.02em' }}>ryzevo</strong>
            <h1>{tr ? 'Bir şeyler ters gitti' : 'Something went wrong'}</h1>
            <p>{tr ? 'Sayfa beklenmedik bir hatayla durdu. Yenilemek çoğu zaman yeterlidir; verileriniz etkilenmedi.' : 'The page stopped with an unexpected error. Reloading usually fixes it; your data is not affected.'}</p>
            <div className="app-error-actions">
              <button type="button" className="primary" onClick={() => window.location.reload()}>{tr ? 'Sayfayı yenile' : 'Reload the page'}</button>
              <a className="secondary" href="/?tab=dashboard">{tr ? 'Genel bakışa dön' : 'Back to the overview'}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

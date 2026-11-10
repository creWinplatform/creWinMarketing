'use client';
import { useEffect } from 'react';
import Brand from '@/components/platform/Brand';
import { useLang } from '@/lib/lang';
import { isChunkLoadError, reloadOnceForChunkError } from '@/components/lazy-tab';

// Last resort for an error outside a tab's own boundary: a branded page instead of "Application error". The details go
// only to the console. A failed code download reloads the page once (not again within 60 s).
export default function AppError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang } = useLang(), tr = lang !== 'en';
  useEffect(() => {
    console.error('Page error', error);
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }, [error]);
  return (
    <main className="app-error">
      <div className="app-error-panel" role="alert">
        <Brand compact />
        <h1>{tr ? 'Bir şeyler ters gitti' : 'Something went wrong'}</h1>
        <p>{tr ? 'Sayfa beklenmedik bir hatayla durdu. Yenilemek çoğu zaman yeterlidir; verileriniz etkilenmedi.' : 'The page stopped with an unexpected error. Reloading usually fixes it; your data is not affected.'}</p>
        <div className="app-error-actions">
          <button type="button" className="primary" onClick={() => window.location.reload()}>{tr ? 'Sayfayı yenile' : 'Reload the page'}</button>
          <a className="secondary" href="/?tab=dashboard">{tr ? 'Genel bakışa dön' : 'Back to the overview'}</a>
        </div>
      </div>
    </main>
  );
}

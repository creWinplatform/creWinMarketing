'use client';
import { useEffect, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { Search, Plus, ExternalLink, Copy } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import type { PageAudit } from '@/lib/site-audit';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
import { developerTask, rankAuditFindings, type RankedFinding } from '@/lib/platform/seo-impact';
const CoachSeo=dynamic(()=>import('./CoachSeo'));
const SeoOperations=dynamic(()=>import('./SeoOperations'));
const SeoOpportunities=dynamic(()=>import('./SeoOpportunities'));
const AiVisibilityPanel=dynamic(()=>import('./AiVisibilityPanel'));
type SeoView='scan'|'audit'|'opportunities'|'visibility'|'topics';
const SEO_VIEWS:SeoView[]=['scan','audit','opportunities','visibility','topics'];
const IMPACT_LABELS: Record<string, [string, string]> = { high: ['Olası etki: yüksek', 'Likely impact: high'], medium: ['Olası etki: orta', 'Likely impact: medium'], low: ['Olası etki: düşük', 'Likely impact: low'] };
const PRIORITY_LABELS: Record<string, [string, string]> = { high: ['Yüksek', 'High'], medium: ['Orta', 'Medium'], low: ['Düşük', 'Low'] };
export default function ProjectAudit({
  workspace,
  lang,
}: {
  workspace: WorkspaceContext;
  lang: Locale;
}) {
  const tr = lang === 'tr',
    [url, setUrl] = useState(workspace.project.website),
    [audit, setAudit] = useState<PageAudit | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<string[]>([]),
    [saving, setSaving] = useState(''),
    canWrite = workspace.permissions?.includes('content.write');
  const [view, setView] = useState<SeoView>('scan'), [copied, setCopied] = useState('');
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('seoView'); if (SEO_VIEWS.includes(value as SeoView)) setView(value as SeoView); }, []);
  const ranked = audit ? rankAuditFindings(audit.findings) : [];
  const task = (finding: RankedFinding) => developerTask(finding, audit?.finalUrl || url, lang, text => translateMessage(text, lang));
  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setAudit(null);
    setSaved([]);
    try {
      setAudit(
        await projectRequest<PageAudit>('/api/platform/audit', {
          method: 'POST',
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(55000),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const plan = async (finding: RankedFinding) => {
    setSaving(finding.id);
    setError('');
    try {
      await projectRequest('/api/platform/operations?resource=tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: translateMessage(finding.title, lang).slice(0, 160),
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          status: 'planned',
          note: task(finding),
        }),
      });
      setSaved((current) => [...current, finding.id]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setSaving('');
    }
  };
  const labels: Record<SeoView, [string, string]> = { scan: ['Site taraması', 'Site scan'], audit: ['Tek sayfa denetimi', 'Single-page audit'], opportunities: ['Arama fırsatları', 'Search opportunities'], visibility: ['AI aramalarında görünürlük', 'AI search visibility'], topics: ['Konular ve briefler', 'Topics & briefs'] };
  const tabs = (
    <div className="publication-view-tabs" role="tablist" aria-label={tr ? 'SEO görünümü' : 'SEO view'} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = SEO_VIEWS[(SEO_VIEWS.indexOf(view) + (event.key === 'ArrowRight' ? 1 : SEO_VIEWS.length - 1)) % SEO_VIEWS.length]; setView(next); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[SEO_VIEWS.indexOf(next)]?.focus(); } }}>
      {SEO_VIEWS.map(item => <button key={item} role="tab" aria-selected={view === item} tabIndex={view === item ? 0 : -1} onClick={() => setView(item)}>{labels[item][tr ? 0 : 1]}</button>)}
    </div>
  );
  if (view === 'topics') return <section>{tabs}<CoachSeo lang={lang} /></section>;
  if (view === 'scan') return <section>{tabs}<SeoOperations workspace={workspace} lang={lang} /></section>;
  if (view === 'opportunities') return <section>{tabs}<SeoOpportunities lang={lang} /></section>;
  if (view === 'visibility') return <section>{tabs}<AiVisibilityPanel workspace={workspace} lang={lang} /></section>;
  return (
    <section>
      {tabs}
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{tr ? 'GENEL HTML' : 'PUBLIC HTML'}</p>
          <h1>{tr ? 'Tek sayfa denetimi' : 'Single-page audit'}</h1>
          <p className="studio-subtitle">
            {tr
              ? 'Projenizin sayfasında teknik ve içerik kontrolü.'
              : 'Technical and content checks for your project’s page.'}
          </p>
        </div>
      </header>
      <form onSubmit={run} className="studio-list-toolbar">
        <label className="studio-search">
          <Search size={16} />
          <input
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label={tr ? 'Denetlenecek sayfa URL’si' : 'Page URL to audit'}
          />
        </label>
        <button className="studio-primary" disabled={busy || !canWrite}>
          {busy
            ? tr
              ? 'Denetleniyor…'
              : 'Auditing…'
            : tr
              ? 'Denetimi başlat'
              : 'Start audit'}
        </button>
      </form>
      {error && (
        <p className="studio-error" role="alert">
          <Msg text={error} />
        </p>
      )}
      {busy && (
        <p className="studio-data-notice mt-4" role="status">
          {tr
            ? 'HTML, başlıklar, canonical ve bağlantılar kontrol ediliyor…'
            : 'Checking HTML, headings, canonical and links…'}
        </p>
      )}
      {audit && (
        <>
          <div className="studio-data-notice mt-5">
            <span className="status-dot" />
            HTTP {audit.httpStatus} ·{' '}
            {new Date(audit.checkedAt).toLocaleString(localeTag(lang))} ·{' '}
            {tr ? 'genel HTML' : 'public HTML'}
          </div>
          <div className="studio-stats">
            {[
              [tr ? 'Bulgular' : 'Findings', audit.findings.length],
              ['H1', audit.summary.h1Count],
              [
                tr ? 'Eksik alt metni' : 'Missing image alt',
                audit.summary.imagesMissingAlt,
              ],
              [
                tr ? 'Schema blokları' : 'Schema blocks',
                audit.summary.schemaBlocks,
              ],
            ].map(([label, value]) => (
              <div className="studio-stat" key={String(label)}>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              </div>
            ))}
          </div>
          <section className="studio-band">
            <div className="studio-section-title">
              <h2>{audit.summary.title || (tr ? 'Başlık yok' : 'No title')}</h2>
              <a
                href={audit.finalUrl}
                className="icon-button"
                target="_blank"
                rel="noreferrer"
                aria-label={tr ? 'Sayfayı aç' : 'Open page'}
                title={tr ? 'Sayfayı aç' : 'Open page'}
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <p className="studio-note">{audit.summary.description}</p>
            <p className="studio-note mt-2">
              Canonical: {audit.summary.canonical || '—'}
            </p>
          </section>
          <section className="studio-band mt-5">
            <div className="studio-section-title">
              <h2>{tr ? 'Kanıtlı bulgular' : 'Evidence-backed findings'}</h2>
            </div>
            {ranked.length > 0 && <p className="studio-note">{tr ? 'Bulgular olası etkiye göre sıralandı. Bu sıralama sabit bir editoryal kuraldır; trafik, sıralama veya dönüşüm ölçümü değildir.' : 'Findings are ordered by likely impact. The order is a fixed editorial rule, not a traffic, ranking or conversion measurement.'}</p>}
            {audit.findings.length === 0 ? (
              <div className="studio-empty">
                {tr
                  ? 'Bu kontrollerde ihlal bulunmadı.'
                  : 'No violations found in these checks.'}
              </div>
            ) : (
              ranked.map((finding) => (
                <article key={finding.id} className="studio-draft-row">
                  <div className="studio-draft-top">
                    <div>
                      <span className="studio-badge">
                        {finding.rank}. {IMPACT_LABELS[finding.impact]?.[tr ? 0 : 1]} · {PRIORITY_LABELS[finding.priority]?.[tr ? 0 : 1] || finding.priority} · {translateMessage(finding.category, lang)}
                      </span>
                      <h2 className="mt-2">{translateMessage(finding.title, lang)}</h2>
                    </div>
                    {canWrite && (
                      <button
                        className="studio-secondary"
                        disabled={saving !== '' || saved.includes(finding.id)}
                        onClick={() => void plan(finding)}
                      >
                        <Plus size={15} />
                        {saved.includes(finding.id)
                          ? tr
                            ? 'İş eklendi'
                            : 'Task added'
                          : tr
                            ? 'İş planına ekle'
                            : 'Add to work plan'}
                      </button>
                    )}
                  </div>
                  <p className="studio-draft-content">{translateMessage(finding.detail, lang)}</p>
                  <p className="studio-note">{translateMessage(finding.evidence, lang)}</p>
                  <p className="mt-3 text-xs"><strong>{tr ? 'Neden önemli: ' : 'Why it matters: '}</strong>{finding.why[lang]}</p>
                  <p className="mt-2 text-xs"><strong>{tr ? 'Nasıl düzeltilir: ' : 'How to fix: '}</strong>{finding.how[lang]}</p>
                  <details className="coach-dev-task"><summary>{tr ? 'Geliştirici için görev metni' : 'Developer-ready task'}</summary><pre>{task(finding)}</pre><button type="button" className="studio-text-button" onClick={() => { void navigator.clipboard?.writeText(task(finding)).then(() => setCopied(finding.id)).catch(() => setCopied('')); }}><Copy size={14} />{copied === finding.id ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Metni kopyala' : 'Copy the text')}</button></details>
                </article>
              ))
            )}
          </section>
        </>
      )}
      <section className="studio-band mt-6">
        <h2 className="text-sm font-semibold">
          {tr ? 'Denetim sınırları' : 'Audit limitations'}
        </h2>
        <p className="studio-note mt-3">
          {tr
            ? 'Google indeks durumu ve Core Web Vitals ölçülmez. Kaydedilen işler hedef sitede otomatik değişiklik veya yayın yapmaz.'
            : 'Google indexing and Core Web Vitals are not measured. Saved tasks do not automatically change or publish the target site.'}
        </p>
      </section>
    </section>
  );
}

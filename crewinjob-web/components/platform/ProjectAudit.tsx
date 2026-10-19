'use client';
import { useState, type FormEvent } from 'react';
import { Search, Plus, ExternalLink } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import type { PageAudit, AuditFinding } from '@/lib/site-audit';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
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
  const plan = async (finding: AuditFinding) => {
    setSaving(finding.id);
    setError('');
    try {
      await projectRequest('/api/platform/operations?resource=tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: finding.title.slice(0, 160),
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          status: 'planned',
          note: `${audit?.finalUrl}\n${finding.recommendation}\n${finding.evidence}`.slice(
            0,
            2000,
          ),
        }),
      });
      setSaved((current) => [...current, finding.id]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setSaving('');
    }
  };
  return (
    <section>
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{tr ? 'GENEL HTML' : 'PUBLIC HTML'}</p>
          <h1>{tr ? 'Site denetimi' : 'Site audit'}</h1>
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
            {audit.findings.length === 0 ? (
              <div className="studio-empty">
                {tr
                  ? 'Bu kontrollerde ihlal bulunmadı.'
                  : 'No violations found in these checks.'}
              </div>
            ) : (
              audit.findings.map((finding) => (
                <article key={finding.id} className="studio-draft-row">
                  <div className="studio-draft-top">
                    <div>
                      <span className="studio-badge">
                        {PRIORITY_LABELS[finding.priority]?.[tr ? 0 : 1] || finding.priority} · {translateMessage(finding.category, lang)}
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
                  <p className="mt-3 text-xs">{translateMessage(finding.recommendation, lang)}</p>
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

'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
import type { StatsResponse } from '@/lib/types';

interface Props {
  stats?: StatsResponse;
}

interface KpiCard { label: string; value: string; icon: string; hint?: string; color?: string }

interface AgentAction {
  id: string;
  priority: 'critical' | 'important' | 'routine';
  icon: string;
  label: string;
  reason: string;
  apiType: string;
  apiParams?: Record<string, unknown>;
}

interface ActionState { loading: boolean; output: string; error: string }

interface KpiHistoryItem {
  id: string;
  platform: string;
  language: string;
  content: string;
  prompt: string;
  timestamp: number;
  metadata?: Record<string, number | null>;
}

function fmtDate(ts: number, lang: 'tr' | 'en') {
  return new Date(ts).toLocaleDateString(localeTag(lang), {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// AI karşılaştırma isteğine giden tarih metni (sunucuya giden değer önceki biçimde kalır).
function promptDate(ts: number, lang: 'tr' | 'en') {
  return new Date(ts).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Yüzde gösterimi: Türkçede "%12", İngilizcede "12%". */
function pctText(value: number | string, lang: 'tr' | 'en') {
  return lang === 'tr' ? `%${value}` : `${value}%`;
}

function deriveActions(stats: StatsResponse, lang: 'tr' | 'en'): AgentAction[] {
  const actions: AgentAction[] = [];
  const sf = stats.seafarers;
  const jb = stats.jobs;
  const buckets = sf?.fillRateBuckets;
  const total = sf?.total ?? 0;

  if (buckets && buckets.zero > 1000) {
    const pct = total > 0 ? Math.round((buckets.zero / total) * 100) : 0;
    actions.push({
      id: 'retention_zero',
      priority: buckets.zero > 5000 ? 'critical' : 'important',
      icon: '🚨',
      label: lang === 'tr' ? 'Re-engagement — Profil Açmayanlar' : 'Re-engagement — Never started',
      reason: lang === 'tr'
        ? `${buckets.zero.toLocaleString('tr-TR')} kullanıcı (%${pct}) kayıt sonrası profil bölümüne hiç girmemiş. Retargeting içeriği üret.`
        : `${buckets.zero.toLocaleString('en-GB')} users (${pct}%) never opened their profile after signup. Generate retargeting content.`,
      apiType: 'retention',
      apiParams: { segmentIndex: 0, language: lang },
    });
  }

  if ((sf?.newThisWeek ?? 0) < 10) {
    actions.push({
      id: 'registration_growth',
      priority: (sf?.newThisWeek ?? 0) < 5 ? 'critical' : 'important',
      icon: '📈',
      label: lang === 'tr' ? 'Seafarer Büyüme İçeriği' : 'Seafarer growth content',
      reason: lang === 'tr'
        ? `Bu hafta yalnızca ${sf?.newThisWeek ?? 0} yeni kayıt — büyüme yavaş. Kayıt odaklı Instagram içeriği üret.`
        : `Only ${sf?.newThisWeek ?? 0} new sign-ups this week — growth is slow. Generate registration-focused Instagram content.`,
      apiType: 'registration',
      apiParams: { platform: 'instagram', language: lang },
    });
  }

  if (buckets && buckets.mid > 200) {
    actions.push({
      id: 'retention_mid',
      priority: 'important',
      icon: '⚠️',
      label: lang === 'tr' ? 'Retention — Aktivasyona Yakın (%50–79)' : 'Retention — Near activation (50–79%)',
      reason: lang === 'tr'
        ? `${buckets.mid.toLocaleString('tr-TR')} kullanıcı profili yarım bırakmış. Tamamlamaya teşvik eden içerik üret.`
        : `${buckets.mid.toLocaleString('en-GB')} users left their profile half-filled. Generate content that encourages completion.`,
      apiType: 'retention',
      apiParams: { segmentIndex: 1, language: lang },
    });
  }

  if ((jb?.newCompaniesThisWeek ?? 0) === 0) {
    actions.push({
      id: 'company_linkedin',
      priority: 'important',
      icon: '🏢',
      label: lang === 'tr' ? 'B2B LinkedIn — Şirket Aktivasyonu' : 'B2B LinkedIn — Company activation',
      reason: lang === 'tr'
        ? 'Bu hafta yeni şirket kaydı yok. Armatörlere yönelik LinkedIn içeriği üret.'
        : 'No new company sign-ups this week. Generate LinkedIn content targeting shipowners.',
      apiType: 'linkedin_ads',
      apiParams: { audience: 'shipowners', objective: 'acquisition', language: lang },
    });
  }

  actions.push({
    id: 'whatsapp',
    priority: 'routine',
    icon: '💬',
    label: lang === 'tr' ? 'WhatsApp Kampanya Mesajı' : 'WhatsApp campaign message',
    reason: lang === 'tr'
      ? 'Seafarer WhatsApp grupları için kayıt teşvik mesajı paketi üret.'
      : 'Generate a pack of sign-up messages for seafarer WhatsApp groups.',
    apiType: 'click_to_whatsapp',
    apiParams: { audience: 'seafarers', language: lang },
  });

  actions.push({
    id: 'blog_article',
    priority: 'routine',
    icon: '📝',
    label: lang === 'tr' ? 'Blog Makale Taslağı' : 'Blog article draft',
    reason: lang === 'tr'
      ? 'SEO odaklı blog makalesi — denizcilik kariyer ve CV konuları sırada.'
      : 'SEO-focused blog article — maritime career and CV topics are next.',
    apiType: 'blog',
    apiParams: { language: lang },
  });

  return actions;
}

// HTML'e giren her metin önce kaçırılır (AI çıktısı dahil) — rapor same-origin blob olarak açıldığı için XSS riski
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function exportPDF(output: string, kpis: KpiCard[], lang: 'tr' | 'en') {
  const locale = localeTag(lang);
  const date = escapeHtml(new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }));
  const metricsRows = kpis.map(k =>
    `<tr><td>${escapeHtml(k.icon)} ${escapeHtml(k.label)}${k.hint ? `<br/><span class="hint">${escapeHtml(k.hint)}</span>` : ''}</td><td><strong>${escapeHtml(k.value)}</strong></td></tr>`
  ).join('');
  // Markdown benzeri biçimlendirme KAÇIRILMIŞ metin üzerinde yapılır → yalnızca bizim eklediğimiz etiketler HTML olur
  const reportHtml = escapeHtml(output.replace(/\r\n?/g, '\n'))
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>');

  const labels = {
    title:       lang === 'tr' ? 'KPI & Haftalık Performans Raporu'    : 'KPI & weekly performance report',
    badge:       lang === 'tr' ? 'HAFTALIK RAPOR'                      : 'WEEKLY REPORT',
    metrics:     lang === 'tr' ? '📊 Anlık Metrikler'                  : '📊 Live metrics',
    metric:      lang === 'tr' ? 'Metrik'                              : 'Metric',
    value:       lang === 'tr' ? 'Değer'                               : 'Value',
    noMetrics:   lang === 'tr' ? 'Metrik verisi yok'                   : 'No metric data',
    analysis:    lang === 'tr' ? '📋 Haftalık Analiz'                  : '📋 Weekly analysis',
    noReport:    lang === 'tr' ? 'Henüz rapor üretilmedi.'             : 'No report generated yet.',
    generated:   lang === 'tr' ? 'Üretim'                              : 'Generated',
  };

  // Savunma katmanı: yalnızca nonce'lu yazdırma script'i çalışabilir, dış kaynak yüklenemez
  const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}'"/>
  <title>crewinjob KPI — ${date}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1e293b;padding:32px;max-width:800px;margin:auto}
    header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0ea5e9;padding-bottom:12px;margin-bottom:24px}
    header h1{font-size:20px;color:#0c4a6e}
    header span{font-size:11px;color:#64748b}
    .badge{background:#0ea5e9;color:#fff;font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700;letter-spacing:.5px}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    th{background:#f1f5f9;text-align:left;padding:6px 10px;font-size:11px;text-transform:uppercase;color:#475569;letter-spacing:.5px}
    td{padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px}
    .hint{font-size:10px;color:#94a3b8}
    h2{font-size:16px;color:#0c4a6e;margin:20px 0 8px;border-left:3px solid #0ea5e9;padding-left:8px}
    h3{font-size:13px;color:#334155;margin:14px 0 6px}
    p,li{line-height:1.7;margin-bottom:6px;color:#334155}
    ul{padding-left:18px;margin-bottom:10px}
    strong{color:#0f172a}
    footer{margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}
    @media print{body{padding:20px}header{margin-bottom:16px}}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>⚓ crewinjob Marketing Agent</h1>
      <p style="font-size:11px;color:#64748b;margin-top:2px">${labels.title}</p>
    </div>
    <div style="text-align:right">
      <div class="badge">${labels.badge}</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">${date}</div>
    </div>
  </header>

  <h2>${labels.metrics}</h2>
  <table>
    <thead><tr><th>${labels.metric}</th><th>${labels.value}</th></tr></thead>
    <tbody>${metricsRows || `<tr><td colspan="2" style="color:#94a3b8">${labels.noMetrics}</td></tr>`}</tbody>
  </table>

  <h2>${labels.analysis}</h2>
  <div>${reportHtml || `<p style="color:#94a3b8">${labels.noReport}</p>`}</div>

  <footer>
    <span>crewinjob.com — The Right Job, The Right Talent</span>
    <span>${labels.generated}: ${escapeHtml(new Date().toLocaleString(locale))}</span>
  </footer>
  <script nonce="${nonce}">window.onload=()=>{window.print();}</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) { URL.revokeObjectURL(url); return; }
  win.addEventListener('afterprint', () => URL.revokeObjectURL(url), { once: true });
}

function exportCSV(output: string, kpis: KpiCard[], lang: 'tr' | 'en') {
  const date = new Date().toISOString().slice(0, 10);
  const rows: string[][] = [
    [lang === 'tr' ? 'crewinjob KPI Raporu' : 'crewinjob KPI report', date],
    [],
    [lang === 'tr' ? 'Metrik' : 'Metric', lang === 'tr' ? 'Değer' : 'Value', lang === 'tr' ? 'Açıklama' : 'Note'],
    ...kpis.map(k => [k.label, k.value, k.hint || '']),
    [],
    [lang === 'tr' ? 'Analiz Raporu' : 'Analysis report'],
    [output],
  ];
  // Her hücre tırnak kaçışlı; =, @, +/- (sayı değilse) ile başlayan hücreler formül olarak çalışmasın diye ' ile başlatılır
  const csvCell = (value: string) => {
    const safe = /^[=@\t\r]/.test(value) || /^[+-](?![\d.,%\s]*$)/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel TR
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `crewinjob_kpi_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function KpiTab({ stats }: Props) {
  const { lang } = useLang();
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [copiedId, setCopiedId] = useState('');
  const [showKpiHistory, setShowKpiHistory] = useState(false);
  const [kpiHistory, setKpiHistory] = useState<KpiHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareAnalysis, setCompareAnalysis] = useState('');
  const [compareAnalysisLoading, setCompareAnalysisLoading] = useState(false);

  const runAction = async (action: AgentAction) => {
    setActionStates(prev => ({ ...prev, [action.id]: { loading: true, output: '', error: '' } }));
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: action.apiType, textModel: getTextModel(), ...action.apiParams }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setActionStates(prev => ({ ...prev, [action.id]: { loading: false, output: data.content, error: '' } }));
      logActivity('kpi_action', action.label, `${(data.content as string).length} chars`);
    } catch (e) {
      setActionStates(prev => ({ ...prev, [action.id]: { loading: false, output: '', error: e instanceof Error ? e.message : (lang === 'tr' ? 'Hata oluştu' : 'An error occurred') } }));
    }
  };

  const loadKpiHistory = async (force = false) => {
    if (kpiHistory.length > 0 && !force) { setShowKpiHistory(true); return; }
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/data/content-history');
      const data: KpiHistoryItem[] = await res.json();
      setKpiHistory(data.filter(h => h.platform === 'kpi'));
    } catch { /* ignore */ }
    setHistoryLoading(false);
    setShowKpiHistory(true);
  };

  const toggleCompare = (id: string) => {
    setCompareAnalysis('');
    setCompareIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id)
      : prev.length < 2  ? [...prev, id]
      : [prev[1], id]   // 3. seçimde en eskiyi at
    );
  };

  const runCompareAnalysis = async (older: KpiHistoryItem, newer: KpiHistoryItem) => {
    setCompareAnalysisLoading(true);
    setCompareAnalysis('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'kpi_compare',
          language: lang,
          reportA: { date: promptDate(older.timestamp, lang), content: older.content, metadata: older.metadata },
          reportB: { date: promptDate(newer.timestamp, lang), content: newer.content, metadata: newer.metadata },
        }),
      });
      const data = await res.json() as { content?: string; error?: string };
      if (data.error) throw new Error(data.error);
      setCompareAnalysis(data.content ?? '');
    } catch (e) {
      const detail = translateMessage(e instanceof Error ? e.message : String(e), lang);
      setCompareAnalysis(lang === 'tr' ? `Hata: ${detail}` : `Error: ${detail}`);
    }
    setCompareAnalysisLoading(false);
  };

  const copyAction = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'kpi', textModel: getTextModel(), language: lang }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
      logActivity('kpi_generated', lang === 'tr' ? 'Haftalık KPI raporu üretildi' : 'Weekly KPI report generated', `${data.content.length} chars`);

      // Metrikleri de kaydet — geçmiş karşılaştırması için
      const sf = stats?.seafarers;
      const jb = stats?.jobs;
      void fetch('/api/data/content-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'kpi',
          language: lang,
          content:  data.content,
          prompt:   'KPI Raporu',
          metadata: sf ? {
            total:        sf.total,
            readyToHire:  sf.readyToHire,
            zero:         sf.fillRateBuckets?.zero,
            low:          sf.fillRateBuckets?.low,
            mid:          sf.fillRateBuckets?.mid,
            high:         sf.fillRateBuckets?.high,
            newThisWeek:  sf.newThisWeek,
            activeJobs:   jb?.active,
            companies:    jb?.companies,
            newCompanies: jb?.newCompaniesThisWeek,
          } : undefined,
        }),
      });
      // Geçmiş paneli açıksa yenile
      if (showKpiHistory) void loadKpiHistory(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : (lang === 'tr' ? 'Hata oluştu' : 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const sf      = stats?.seafarers;
  const jb      = stats?.jobs;
  const total   = sf?.total ?? 0;
  const activated = sf?.activatedSeafarers ?? sf?.fillRateBuckets?.high ?? 0;
  const activationRate = sf?.activationRate ?? (total > 0 ? Math.round((activated / total) * 1000) / 10 : 0);
  const below80 = sf?.profilesBelow80 ?? Math.max(0, total - activated);
  const num     = (n?: number | null) => (n == null ? '–' : n.toLocaleString(localeTag(lang)));
  const plus    = (n?: number | null) => (n == null ? '–' : `+${n.toLocaleString(localeTag(lang))}`);

  const kpis = stats ? [
    // ── Gemi insanı tarafı ────────────────────────────────────────────────────
    { label: lang === 'tr' ? 'Toplam Seafarer'    : 'Total seafarers',    value: num(sf?.total),        icon: '👥', hint: lang === 'tr' ? 'Kayıtlı kullanıcı'              : 'Registered users',        color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300' },
    { label: lang === 'tr' ? 'Activated Seafarer' : 'Activated seafarers', value: num(activated), icon: '✅', hint: lang === 'tr' ? `Profil %80+ · %${activationRate}` : `Profile 80%+ · ${activationRate}%`, color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300' },
    { label: lang === 'tr' ? 'Profil %80 Altı'    : 'Profiles below 80%', value: num(below80), icon: '⚠️', hint: lang === 'tr' ? 'Aktivasyon hedef kitlesi' : 'Activation audience', color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-800 dark:text-red-300' },
    { label: lang === 'tr' ? 'Ort. Profil Doluluk': 'Avg. profile fill',  value: pctText(sf?.profileCompletion ?? 0, lang), icon: '📊', hint: lang === 'tr' ? 'Ortalama — tamamlanma oranı değil' : 'Average — not the completion rate', color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-300' },
    { label: lang === 'tr' ? 'Bu Hafta Yeni'      : 'New this week',      value: plus(sf?.newThisWeek), icon: '📈', hint: lang === 'tr' ? 'Yeni seafarer kaydı'          : 'New seafarer sign-ups',    color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' },
    { label: lang === 'tr' ? 'Bugün Yeni'         : 'New today',          value: plus(sf?.newToday),    icon: '🌅', hint: lang === 'tr' ? 'Son 24 saat'                  : 'Last 24 hours',           color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-300' },

    // ── Şirket tarafı ─────────────────────────────────────────────────────────
    { label: lang === 'tr' ? 'Toplam Şirket'      : 'Total companies',    value: num(jb?.companies),    icon: '🏢', hint: lang === 'tr' ? 'Kayıtlı firma'                 : 'Registered companies',    color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300' },
    { label: lang === 'tr' ? 'Yeni Şirket'        : 'New companies',      value: plus(jb?.newCompaniesThisWeek), icon: '🆕', hint: lang === 'tr' ? 'Bu hafta'               : 'This week',               color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-800 dark:text-violet-300' },
    { label: lang === 'tr' ? 'Toplam İlan'        : 'Total job postings', value: num(jb?.active),       icon: '📋', hint: lang === 'tr' ? 'Tüm ilanlar (aktif sayısı API’de yok)' : 'All job postings (the API has no active count)',           color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-300' },
    { label: lang === 'tr' ? 'Haftalık İlan'      : 'Weekly job postings', value: plus(jb?.newThisWeek), icon: '📌', hint: jb?.newThisWeek == null ? (lang === 'tr' ? 'API verisi yok' : 'No API data') : (lang === 'tr' ? 'Bu hafta açılan' : 'Opened this week'), color: 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100' },
  ] : [];

  const buckets = sf?.fillRateBuckets;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-5">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">{lang === 'tr' ? 'KPI & Haftalık Rapor' : 'KPI & weekly report'}</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {lang === 'tr' ? 'Mevcut platform verilerine göre AI destekli haftalık analiz üretin.' : 'Generate AI-powered weekly analysis based on current platform data.'}
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
              <span aria-hidden="true">📋</span> {lang === 'tr' ? 'Rapor kapsamı:' : 'Report scope:'}
            </div>
            <ul className="pl-4 flex flex-col gap-0.5 mt-1">
              <li>• {lang === 'tr' ? 'Seafarer büyüme analizi' : 'Seafarer growth analysis'}</li>
              <li>• {lang === 'tr' ? 'İlan performans özeti' : 'Job posting performance summary'}</li>
              <li>• {lang === 'tr' ? 'Retention risk değerlendirmesi' : 'Retention risk assessment'}</li>
              <li>• {lang === 'tr' ? 'Sosyal medya önerileri' : 'Social media recommendations'}</li>
              <li>• {lang === 'tr' ? 'Bu haftanın öncelikleri' : "This week's priorities"}</li>
            </ul>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'Rapor üretiliyor…' : 'Generating report…'}
              </>
            ) : (
              <>📊 {lang === 'tr' ? 'Haftalık KPI Raporu Üret' : 'Generate weekly KPI report'}</>
            )}
          </button>
        </div>

        {kpis.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                {lang === 'tr' ? '⚓ Gemi İnsanı Tarafı' : '⚓ Seafarer side'}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {kpis.slice(0, 6).map((kpi, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${kpi.color}`}>
                    <div className="text-lg mb-0.5" aria-hidden="true">{kpi.icon}</div>
                    <div className="text-lg font-bold leading-tight">{kpi.value}</div>
                    <div className="text-xs opacity-70 mt-0.5">{kpi.label}</div>
                    {kpi.hint && <div className="text-[10px] opacity-50 mt-0.5 leading-snug">{kpi.hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                {lang === 'tr' ? '🏢 Şirket Tarafı' : '🏢 Company side'}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {kpis.slice(6).map((kpi, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${kpi.color}`}>
                    <div className="text-lg mb-0.5" aria-hidden="true">{kpi.icon}</div>
                    <div className="text-lg font-bold leading-tight">{kpi.value}</div>
                    <div className="text-xs opacity-70 mt-0.5">{kpi.label}</div>
                    {kpi.hint && <div className="text-[10px] opacity-50 mt-0.5 leading-snug">{kpi.hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            {buckets && total > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  {lang === 'tr' ? '📊 Profil Doluluk Dağılımı' : '📊 Profile fill distribution'}
                </h3>
                <div className="flex h-6 rounded-md overflow-hidden border border-slate-200 dark:border-slate-600">
                  {([
                    { key: 'zero', v: buckets.zero, cls: 'bg-red-400 dark:bg-red-600',       lbl: pctText(0, lang) },
                    { key: 'low',  v: buckets.low,  cls: 'bg-orange-400 dark:bg-orange-600', lbl: pctText('1–49', lang) },
                    { key: 'mid',  v: buckets.mid,  cls: 'bg-amber-400 dark:bg-amber-500',   lbl: pctText('50–79', lang) },
                    { key: 'high', v: buckets.high, cls: 'bg-emerald-500 dark:bg-emerald-600', lbl: pctText('80+', lang) },
                  ]).map(b => {
                    const pct = (b.v / total) * 100;
                    return pct <= 0 ? null : (
                      <div
                        key={b.key}
                        className={`${b.cls} flex items-center justify-center`}
                        style={{ width: `${pct}%` }}
                        title={`${b.lbl}: ${b.v.toLocaleString(localeTag(lang))} (${pctText(pct.toLocaleString(localeTag(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }), lang)})`}
                      >
                        {pct > 12 && <span className="text-[10px] font-semibold text-white">{pctText(pct.toFixed(0), lang)}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-4 gap-1 mt-2 text-[10px]">
                  {([
                    { v: buckets.zero, cls: 'bg-red-400 dark:bg-red-600',         lbl: lang === 'tr' ? 'Hiç dolu değil' : 'Empty' },
                    { v: buckets.low,  cls: 'bg-orange-400 dark:bg-orange-600',   lbl: pctText('1–49', lang) },
                    { v: buckets.mid,  cls: 'bg-amber-400 dark:bg-amber-500',     lbl: pctText('50–79', lang) },
                    { v: buckets.high, cls: 'bg-emerald-500 dark:bg-emerald-600', lbl: lang === 'tr' ? '%80+ (activated)' : '80%+ (activated)' },
                  ]).map((b, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-sm ${b.cls}`} />
                        <span className="text-slate-500 dark:text-slate-400 truncate">{b.lbl}</span>
                      </div>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{b.v.toLocaleString(localeTag(lang))}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  {lang === 'tr'
                    ? `Pazarlama aktivasyon tanımı: profil doluluğu %80+. ${activated.toLocaleString('tr-TR')} kullanıcı (%${activationRate}) bu eşiğe ulaştı.`
                    : `Marketing activation definition: profile completion 80%+. ${activated.toLocaleString('en-GB')} users (${activationRate}%) reached it.`}
                </p>

                {/* Aktivasyon hunisi */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-600">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    {lang === 'tr' ? '🔽 Aktivasyon Hunisi' : '🔽 Activation funnel'}
                  </p>
                  {[
                    { lbl: lang === 'tr' ? 'Kayıtlı' : 'Registered',    n: total,            cls: 'bg-slate-200 dark:bg-slate-600' },
                    { lbl: lang === 'tr' ? 'Profil açmış' : 'Started',   n: total - buckets.zero, cls: 'bg-orange-300 dark:bg-orange-700' },
                    { lbl: lang === 'tr' ? '%50+ dolu' : '50%+ filled', n: buckets.mid + buckets.high, cls: 'bg-amber-400 dark:bg-amber-600' },
                    { lbl: lang === 'tr' ? 'Activated %80+' : 'Activated 80%+', n: activated, cls: 'bg-emerald-500 dark:bg-emerald-600' },
                  ].map((step, i) => {
                    const w = total > 0 ? Math.max(4, Math.round((step.n / total) * 100)) : 0;
                    return (
                      <div key={i} className="flex items-center gap-2 mb-1">
                        <div className="w-28 shrink-0 text-[10px] text-slate-500 dark:text-slate-400 text-right">{step.lbl}</div>
                        <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700 rounded-sm overflow-hidden">
                          <div className={`h-full ${step.cls} rounded-sm transition-all`} style={{ width: `${w}%` }} />
                        </div>
                        <div className="w-14 shrink-0 text-[10px] font-semibold text-slate-700 dark:text-slate-200">{step.n.toLocaleString(localeTag(lang))}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Kritik durum uyarısı */}
                {buckets.zero > 0 && (
                  <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-[11px] font-semibold text-red-700 dark:text-red-400 mb-1">
                      🚨 {lang === 'tr' ? 'Kritik Bottleneck' : 'Critical bottleneck'}
                    </p>
                    <p className="text-[10px] text-red-600 dark:text-red-300 leading-relaxed">
                      {lang === 'tr'
                        ? `${buckets.zero.toLocaleString('tr-TR')} kullanıcı (%${((buckets.zero/total)*100).toFixed(0)}) kayıt sonrası profil bölümüne hiç girmemiş. Asıl kaldıraç: CV parse ile otomatik profil doldurma.`
                        : `${buckets.zero.toLocaleString('en-GB')} users (${((buckets.zero/total)*100).toFixed(0)}%) never opened their profile after signing up. Key lever: automatic profile filling with CV parsing.`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
            <span aria-hidden="true">📊</span> {lang === 'tr' ? 'Haftalık KPI Analizi' : 'Weekly KPI analysis'}
          </h3>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => showKpiHistory ? setShowKpiHistory(false) : loadKpiHistory()}
              aria-expanded={showKpiHistory}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                showKpiHistory
                  ? 'bg-purple-700 text-white'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              📋 {lang === 'tr' ? 'Geçmiş' : 'History'}
              {kpiHistory.length > 0 && <span className="bg-white/20 px-1 rounded text-[10px]">{kpiHistory.length}</span>}
            </button>
            {output && !loading && (
              <>
                <button
                  onClick={() => exportCSV(output, kpis, lang)}
                  className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                  title={lang === 'tr' ? 'Excel/CSV olarak indir' : 'Download as Excel/CSV'}
                >
                  📊 {lang === 'tr' ? 'CSV İndir' : 'Download CSV'}
                </button>
                <button
                  onClick={() => exportPDF(output, kpis, lang)}
                  className="flex items-center gap-1.5 text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                  title={lang === 'tr' ? 'PDF olarak kaydet (Yazdır → PDF Kaydet)' : 'Save as PDF (Print → Save as PDF)'}
                >
                  📄 {lang === 'tr' ? 'PDF İndir' : 'Download PDF'}
                </button>
              </>
            )}
          </div>
        </div>
        <OutputPanel
          content={output}
          loading={loading}
          error={translateMessage(error, lang)}
          platform="kpi"
          contentType="kpi"
        />

        {output && !loading && stats && (() => {
          const actions = deriveActions(stats, lang);
          const criticalCount = actions.filter(a => a.priority === 'critical').length;
          const priorityColors = {
            critical: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20',
            important: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
            routine:   'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40',
          };
          const badgeColors = {
            critical:  'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',
            important: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
            routine:   'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300',
          };
          const badgeLabel = {
            critical:  lang === 'tr' ? 'KRİTİK' : 'CRITICAL',
            important: lang === 'tr' ? 'ÖNEMLİ' : 'IMPORTANT',
            routine:   lang === 'tr' ? 'RUTİN'  : 'ROUTINE',
          };
          return (
            <div className="mt-5 border-t border-slate-200 dark:border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <span aria-hidden="true">⚡</span>
                  {lang === 'tr' ? 'KPI\'ya Göre Önerilen Aksiyonlar' : 'Recommended actions from KPIs'}
                </h3>
                {criticalCount > 0 && (
                  <span className="text-[10px] bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-bold px-2 py-0.5 rounded-full">
                    {criticalCount} {lang === 'tr' ? 'kritik' : 'critical'}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5">
                {actions.map(action => {
                  const st = actionStates[action.id];
                  return (
                    <div key={action.id} className={`rounded-lg border p-3 transition-all ${priorityColors[action.priority]}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide ${badgeColors[action.priority]}`}>
                              {badgeLabel[action.priority]}
                            </span>
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                              {action.icon} {action.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{action.reason}</p>
                        </div>
                        <button
                          onClick={() => runAction(action)}
                          disabled={st?.loading}
                          className="shrink-0 text-xs bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 whitespace-nowrap"
                        >
                          {st?.loading ? (
                            <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{lang === 'tr' ? ' Üretiliyor' : ' Generating'}</>
                          ) : st?.output ? (
                            lang === 'tr' ? '↺ Yenile' : '↺ Regenerate'
                          ) : (
                            lang === 'tr' ? '⚡ Üret' : '⚡ Generate'
                          )}
                        </button>
                      </div>
                      {st?.error && (
                        <p role="alert" className="text-[11px] text-red-600 dark:text-red-400 mt-2 pl-0.5"><Msg text={st.error} /></p>
                      )}
                      {st?.output && (
                        <div className="mt-2 relative">
                          <pre className="text-[10px] bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-md p-3 overflow-auto max-h-52 whitespace-pre-wrap leading-relaxed font-mono">
                            {st.output}
                          </pre>
                          <button
                            onClick={() => copyAction(action.id, st.output)}
                            className="absolute top-1.5 right-1.5 text-[10px] bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded transition-colors"
                          >
                            {copiedId === action.id ? (lang === 'tr' ? '✓ Kopyalandı' : '✓ Copied') : (lang === 'tr' ? 'Kopyala' : 'Copy')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── KPI Geçmiş Paneli ── */}
        {showKpiHistory && (
          <div className="mt-5 border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <span aria-hidden="true">📋</span>
                {lang === 'tr' ? 'Önceki KPI Raporları' : 'Previous KPI reports'}
              </h3>
              <div className="flex items-center gap-2">
                {compareIds.length === 2 && (
                  <span className="text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-semibold">
                    {lang === 'tr' ? '2 rapor seçildi — karşılaştırma aktif' : '2 reports selected — comparison active'}
                  </span>
                )}
                {compareIds.length > 0 && (
                  <button onClick={() => setCompareIds([])} className="text-[10px] text-slate-600 hover:text-slate-600 dark:hover:text-slate-300">
                    {lang === 'tr' ? 'Seçimi temizle' : 'Clear selection'}
                  </button>
                )}
                <button
                  onClick={() => loadKpiHistory(true)}
                  className="text-[10px] text-ocean hover:underline"
                >
                  {lang === 'tr' ? '↺ Yenile' : '↺ Refresh'}
                </button>
              </div>
            </div>

            {historyLoading ? (
              <div className="flex items-center gap-2 py-6 justify-center text-slate-600 text-sm">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'Yükleniyor…' : 'Loading…'}
              </div>
            ) : kpiHistory.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center py-6">
                {lang === 'tr' ? 'Henüz kaydedilmiş KPI raporu yok. İlk raporu üret!' : 'No saved KPI reports yet. Generate your first report!'}
              </p>
            ) : (
              <>
                {/* Karşılaştırma görünümü */}
                {compareIds.length === 2 && (() => {
                  const a = kpiHistory.find(h => h.id === compareIds[0])!;
                  const b = kpiHistory.find(h => h.id === compareIds[1])!;
                  // Eski/yeni doğru sıraya koy (a = eski, b = yeni)
                  const [older, newer] = a.timestamp <= b.timestamp ? [a, b] : [b, a];
                  const ma = (older.metadata ?? {}) as Record<string, number | null>;
                  const mb = (newer.metadata ?? {}) as Record<string, number | null>;
                  const hasMetrics = Object.keys(ma).length > 0 || Object.keys(mb).length > 0;

                  type MetricDef = { label: string; higherIsBetter: boolean };
                  const METRICS: [string, MetricDef][] = [
                    ['total',        { label: lang === 'tr' ? 'Toplam Seafarer'  : 'Total seafarers',   higherIsBetter: true  }],
                    ['readyToHire',  { label: lang === 'tr' ? 'Activated (%80+)' : 'Activated (80%+)', higherIsBetter: true  }],
                    ['zero',         { label: lang === 'tr' ? '%0\'da Bekleyen'  : 'Never started (0%)', higherIsBetter: false }],
                    ['mid',          { label: lang === 'tr' ? '%50–79 Dolu'      : '50–79% filled',     higherIsBetter: true  }],
                    ['newThisWeek',  { label: lang === 'tr' ? 'Bu Hafta Yeni'    : 'New this week',     higherIsBetter: true  }],
                    ['activeJobs',   { label: lang === 'tr' ? 'Toplam İlan'      : 'Total job postings',        higherIsBetter: true  }],
                    ['companies',    { label: lang === 'tr' ? 'Toplam Şirket'    : 'Total companies',   higherIsBetter: true  }],
                    ['newCompanies', { label: lang === 'tr' ? 'Yeni Şirket'      : 'New companies',     higherIsBetter: true  }],
                  ];

                  const fmt = (v: number | null | undefined) =>
                    v == null ? '–' : v.toLocaleString(localeTag(lang));

                  const deltaCell = (key: string, def: MetricDef) => {
                    const va = ma[key], vb = mb[key];
                    if (va == null || vb == null) return <span className="text-slate-600">–</span>;
                    const d = vb - va;
                    if (d === 0) return <span className="text-slate-600">→ 0</span>;
                    const good = def.higherIsBetter ? d > 0 : d < 0;
                    const arrow = d > 0 ? '▲' : '▼';
                    const cls = good
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400';
                    return (
                      <span className={`font-semibold ${cls}`}>
                        {arrow} {d > 0 ? '+' : ''}{d.toLocaleString(localeTag(lang))}
                      </span>
                    );
                  };

                  return (
                    <div className="mb-4 space-y-3">
                      {/* Metrik karşılaştırma tablosu */}
                      {hasMetrics ? (
                        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                <th className="text-left px-3 py-2 font-semibold">{lang === 'tr' ? 'Metrik' : 'Metric'}</th>
                                <th className="text-right px-3 py-2 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                                  A — {fmtDate(older.timestamp, lang)}
                                </th>
                                <th className="text-right px-3 py-2 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                  B — {fmtDate(newer.timestamp, lang)}
                                </th>
                                <th className="text-right px-3 py-2 font-semibold">{lang === 'tr' ? 'Δ Değişim' : 'Δ Change'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {METRICS.map(([key, def], i) => (
                                <tr key={key} className={i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60'}>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{def.label}</td>
                                  <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{fmt(ma[key])}</td>
                                  <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{fmt(mb[key])}</td>
                                  <td className="px-3 py-2 text-right font-mono">{deltaCell(key, def)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 italic px-1">
                          {lang === 'tr'
                            ? 'Bu raporlarda metrik snapshot yok (eski raporlar). Yeni rapor üretince karşılaştırma tablosu görünür.'
                            : 'No metric snapshot in these reports (older records). Generate a new report to enable metric comparison.'}
                        </p>
                      )}

                      {/* AI Değerlendirmesi */}
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/10 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            ✦ {lang === 'tr' ? 'AI Trend Değerlendirmesi' : 'AI trend analysis'}
                          </span>
                          {!compareAnalysis && !compareAnalysisLoading && (
                            <button
                              onClick={() => void runCompareAnalysis(older, newer)}
                              className="text-[11px] px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
                            >
                              {lang === 'tr' ? 'Değerlendir' : 'Analyze'}
                            </button>
                          )}
                          {compareAnalysis && !compareAnalysisLoading && (
                            <button
                              onClick={() => void runCompareAnalysis(older, newer)}
                              className="text-[10px] px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                            >
                              {lang === 'tr' ? 'Yenile' : 'Refresh'}
                            </button>
                          )}
                        </div>
                        {compareAnalysisLoading && (
                          <div className="flex items-center gap-2 py-2">
                            <svg className="animate-spin w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">
                              {lang === 'tr' ? 'AI değerlendiriyor…' : 'AI is analyzing…'}
                            </span>
                          </div>
                        )}
                        {compareAnalysis && !compareAnalysisLoading && (
                          <pre className="text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
                            {compareAnalysis}
                          </pre>
                        )}
                        {!compareAnalysis && !compareAnalysisLoading && (
                          <p className="text-[11px] text-amber-600/70 dark:text-amber-500/70">
                            {lang === 'tr'
                              ? 'İki rapor arasındaki trendleri, kritik bulguları ve öncelikli aksiyonları AI ile analiz et.'
                              : 'Use AI to analyze trends, critical findings, and priority actions between the two reports.'}
                          </p>
                        )}
                      </div>

                      {/* Yan yana tam metin */}
                      <div className="grid grid-cols-2 gap-3">
                        {[older, newer].map((item, i) => (
                          <div key={item.id} className="flex flex-col gap-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${i === 0 ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'}`}>
                              {i === 0 ? (lang === 'tr' ? 'A — Eski' : 'A — Older') : (lang === 'tr' ? 'B — Yeni' : 'B — Newer')}
                            </span>
                            <pre className="text-[10px] bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap font-mono leading-relaxed">
                              {item.content}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Rapor listesi */}
                <div className="flex flex-col gap-2">
                  {kpiHistory.map((item, idx) => {
                    const isSelected = compareIds.includes(item.id);
                    const preview = item.content.split('\n').find(l => l.trim() && !l.startsWith('#'))?.slice(0, 120) ?? '';
                    const headings = item.content.match(/^## .+$/gm)?.slice(0, 3).map(h => h.replace('## ', '')) ?? [];
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg border p-3 transition-all ${
                          isSelected
                            ? 'border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/20'
                            : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCompare(item.id)}
                            className="mt-0.5 w-3.5 h-3.5 accent-purple-600 cursor-pointer shrink-0"
                            title={lang === 'tr' ? 'Karşılaştırmak için seç' : 'Select to compare'}
                            aria-label={lang === 'tr' ? 'Karşılaştırmak için seç' : 'Select to compare'}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">
                                #{kpiHistory.length - idx}
                              </span>
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {fmtDate(item.timestamp, lang)}
                              </span>
                              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                                {item.content.length.toLocaleString(localeTag(lang))} {lang === 'tr' ? 'karakter' : 'characters'}
                              </span>
                            </div>
                            {headings.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1">
                                {headings.map((h, i) => (
                                  <span key={i} className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded">
                                    {h}
                                  </span>
                                ))}
                              </div>
                            )}
                            {preview && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed truncate">{preview}…</p>
                            )}
                          </div>
                          <button
                            onClick={() => { setOutput(item.content); setShowKpiHistory(false); }}
                            className="shrink-0 text-[11px] bg-ocean hover:bg-ocean-dark text-white px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap"
                          >
                            {lang === 'tr' ? 'Yükle' : 'Load'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

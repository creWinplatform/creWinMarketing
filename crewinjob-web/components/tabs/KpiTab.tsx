'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { logActivity } from '@/lib/activity-log';
import type { StatsResponse } from '@/lib/types';

interface Props {
  stats?: StatsResponse;
}

/** KPI raporunu PDF olarak yazdır (tarayıcı PDF kaydet diyaloğu açılır) */
function exportPDF(output: string, kpis: { label: string; value: string; icon: string }[]) {
  const date = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const metricsRows = kpis.map(k =>
    `<tr><td>${k.icon} ${k.label}</td><td><strong>${k.value}</strong></td></tr>`
  ).join('');
  const reportHtml = output
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>');

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"/>
  <title>crewinjob KPI Raporu — ${date}</title>
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
      <p style="font-size:11px;color:#64748b;margin-top:2px">KPI & Haftalık Performans Raporu</p>
    </div>
    <div style="text-align:right">
      <div class="badge">HAFTALIK RAPOR</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">${date}</div>
    </div>
  </header>

  <h2>📊 Anlık Metrikler</h2>
  <table>
    <thead><tr><th>Metrik</th><th>Değer</th></tr></thead>
    <tbody>${metricsRows || '<tr><td colspan="2" style="color:#94a3b8">Metrik verisi yok</td></tr>'}</tbody>
  </table>

  <h2>📋 Haftalık Analiz</h2>
  <div>${reportHtml || '<p style="color:#94a3b8">Henüz rapor üretilmedi.</p>'}</div>

  <footer>
    <span>crewinjob.com — The Right Job, The Right Talent</span>
    <span>Üretim: ${new Date().toLocaleString('tr-TR')}</span>
  </footer>
  <script>window.onload=()=>{window.print();}</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) { URL.revokeObjectURL(url); return; }
  win.addEventListener('afterprint', () => URL.revokeObjectURL(url), { once: true });
}

/** KPI metriklerini + rapor metnini CSV olarak indir */
function exportCSV(output: string, kpis: { label: string; value: string }[]) {
  const date = new Date().toISOString().slice(0, 10);
  const rows: string[][] = [
    ['crewinjob KPI Raporu', date],
    [],
    ['Metrik', 'Değer'],
    ...kpis.map(k => [k.label, k.value]),
    [],
    ['Analiz Raporu'],
    [output.replace(/"/g, '""')],
  ];
  const csv = rows.map(r => r.map(cell => `"${cell}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel TR
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `crewinjob_kpi_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function KpiTab({ stats }: Props) {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'kpi', textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
      logActivity('kpi_generated', 'Haftalık KPI raporu üretildi', `${data.content.length} karakter`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const kpis = stats ? [
    { label: 'Toplam Seafarer',  value: stats.seafarers?.total?.toLocaleString('tr-TR') || '–',    icon: '👥', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300' },
    { label: 'Bu Hafta Yeni',    value: `+${stats.seafarers?.newThisWeek || 0}`,                    icon: '📈', color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' },
    { label: 'Aktif İlanlar',    value: stats.jobs?.active?.toString() || '–',                      icon: '📋', color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-300' },
    { label: 'Profil Tamamlama', value: `%${stats.seafarers?.profileCompletion || 0}`,              icon: '📊', color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-300' },
    { label: 'Yarım Profil',     value: stats.seafarers?.incompleteProfiles?.toLocaleString('tr-TR') || '–', icon: '⚠️', color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-800 dark:text-red-300' },
    { label: 'Haftalık İlan',    value: `+${stats.jobs?.newThisWeek || 0}`,                         icon: '🆕', color: 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100' },
  ] : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-5">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">KPI & Haftalık Rapor</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Mevcut platform verilerine göre AI destekli haftalık analiz üretin.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
              <span>📋</span> Rapor kapsamı:
            </div>
            <ul className="pl-4 flex flex-col gap-0.5 mt-1">
              <li>• Seafarer büyüme analizi</li>
              <li>• İlan performans özeti</li>
              <li>• Retention risk değerlendirmesi</li>
              <li>• Sosyal medya önerileri</li>
              <li>• Bu haftanın öncelikleri</li>
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
                Rapor üretiliyor...
              </>
            ) : (
              <>📊 Haftalık KPI Raporu Üret</>
            )}
          </button>
        </div>

        {kpis.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Anlık Metrikler</h3>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map((kpi, i) => (
                <div key={i} className={`rounded-lg border p-3 ${kpi.color}`}>
                  <div className="text-lg mb-0.5">{kpi.icon}</div>
                  <div className="text-lg font-bold leading-tight">{kpi.value}</div>
                  <div className="text-xs opacity-70 mt-0.5">{kpi.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
            <span>📊</span> Haftalık KPI Analizi
          </h3>
          {output && !loading && (
            <div className="flex gap-2">
              <button
                onClick={() => exportCSV(output, kpis)}
                className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                title="Excel/CSV olarak indir"
              >
                📊 CSV İndir
              </button>
              <button
                onClick={() => exportPDF(output, kpis)}
                className="flex items-center gap-1.5 text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                title="PDF olarak kaydet (Yazdır → PDF Kaydet)"
              >
                📄 PDF İndir
              </button>
            </div>
          )}
        </div>
        <OutputPanel
          content={output}
          loading={loading}
          error={error}
          platform="kpi"
          contentType="kpi"
          autoSaveHistory={{ prompt: 'KPI Raporu', language: 'tr' }}
        />
      </div>
    </div>
  );
}

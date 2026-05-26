'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { BreakdownItem, BreakdownData, CompanyItem, CompaniesResponse } from '@/lib/types';

/* ISO-2 → emoji flag */
function flag(iso2?: string) {
  if (!iso2 || iso2.length !== 2) return '';
  const b = 0x1F1E6 - 65;
  return String.fromCodePoint(b + iso2.toUpperCase().charCodeAt(0)) +
         String.fromCodePoint(b + iso2.toUpperCase().charCodeAt(1));
}

/* ── Tek bar satırı ──────────────────────────────────────────────────────────── */
function BarRow({ item, rank, max, color }: {
  item: BreakdownItem; rank: number; max: number; color: string;
}) {
  const pct = max > 0 ? Math.max((item.count / max) * 100, item.count > 0 ? 1.5 : 0) : 0;
  return (
    <div className="flex items-center gap-2 group">
      <span className="w-5 text-right text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0">{rank}</span>
      <div className="w-36 shrink-0 flex items-center gap-1.5 overflow-hidden">
        {item.code && <span className="shrink-0 text-sm">{flag(item.code)}</span>}
        <span className="text-xs text-slate-700 dark:text-slate-200 truncate font-medium" title={item.name}>
          {item.name}
        </span>
      </div>
      <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
        {item.count > 0 ? item.count.toLocaleString('tr-TR') : '–'}
      </span>
    </div>
  );
}

/* ── Count input ─────────────────────────────────────────────────────────────── */
function CountInput({ label, value, onChange }: {
  label: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{label}</span>
      <input
        type="number"
        min={1} max={50}
        value={value}
        onChange={e => {
          const n = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
          onChange(n);
        }}
        className="w-14 text-xs text-center border border-slate-200 dark:border-slate-600 rounded-lg py-1 px-1.5 bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/40"
      />
      <span className="text-[10px] text-slate-400">kayıt</span>
    </div>
  );
}

/* ── Ülke / Pozisyon listesi seksiyon ───────────────────────────────────────── */
function BreakdownSection({ title, icon, items, color, emptyMsg, count, onCountChange }: {
  title: string; icon: string; items: BreakdownItem[]; color: string;
  emptyMsg: string; count: number; onCountChange: (n: number) => void;
}) {
  const [search,  setSearch]  = useState('');
  const [showAll, setShowAll] = useState(false);
  const PAGE = 15;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const visible  = showAll ? filtered : filtered.slice(0, PAGE);
  const maxCount = filtered[0]?.count || 1;
  const total    = items.reduce((s, i) => s + i.count, 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
      {/* Başlık */}
      <div className="bg-slate-50 dark:bg-slate-700/50 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {items.length} kayıt · toplam {total.toLocaleString('tr-TR')} gemi adamı
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Count input */}
          <CountInput label="Göster:" value={count} onChange={onCountChange} />
          {/* Arama */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Ara..."
              className="pl-7 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/40 w-28 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400 dark:text-slate-500">
            <span className="text-3xl opacity-20">📭</span>
            <p className="text-xs text-center">{emptyMsg}</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">"{search}" için sonuç yok.</p>
        ) : (
          visible.map((item, idx) => (
            <BarRow key={item.id} item={item} rank={idx + 1} max={maxCount} color={color} />
          ))
        )}
      </div>

      {filtered.length > PAGE && (
        <div className="px-4 pb-4">
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-ocean hover:text-ocean-dark font-medium py-2 rounded-lg border border-ocean/30 hover:border-ocean/60 transition-colors"
          >
            {showAll ? '▲ Daha az göster' : `▼ Tümünü göster (${filtered.length - PAGE} daha)`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Son Firmalar satırı ─────────────────────────────────────────────────────── */
function CompanyRow({ item, rank }: { item: CompanyItem; rank: number }) {
  const date = item.registeredAt
    ? new Date(item.registeredAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
    : '–';
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-50 dark:border-slate-700/50 last:border-0 group">
      <span className="w-6 text-center text-[11px] text-slate-400 font-mono shrink-0">{rank}</span>
      <div className="w-5 shrink-0 text-base">{flag(item.countryCode) || '🏢'}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate" title={item.name}>
          {item.name}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
          {item.country}{item.type ? ` · ${item.type}` : ''}
        </p>
      </div>
      {item.crewCount > 0 && (
        <span className="text-[10px] bg-ocean/10 text-ocean dark:bg-ocean/20 px-2 py-0.5 rounded-full font-medium shrink-0">
          {item.crewCount} mür.
        </span>
      )}
      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">{date}</span>
    </div>
  );
}

/* ── Son Firmalar seksiyon ───────────────────────────────────────────────────── */
function CompaniesSection({ data, loading, count, onCountChange }: {
  data: CompaniesResponse | null; loading: boolean;
  count: number; onCountChange: (n: number) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!data?.companies) return [];
    const q = search.trim().toLowerCase();
    return q ? data.companies.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q)
    ) : data.companies;
  }, [data?.companies, search]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
      {/* Başlık */}
      <div className="bg-slate-50 dark:bg-slate-700/50 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏢</span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Son Kayıt Olan Firmalar</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              GetLastRegisteredCompanies · {data?.companies?.length ?? 0} firma
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CountInput label="Göster:" value={count} onChange={onCountChange} />
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Ara..."
              className="pl-7 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/40 w-28 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* İçerik */}
      <div className="px-5 py-3 flex-1">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-slate-400 text-xs">
            <div className="w-4 h-4 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
            Firmalar yükleniyor...
          </div>
        ) : !data || data.companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400 dark:text-slate-500">
            <span className="text-3xl opacity-20">📭</span>
            <p className="text-xs text-center">GetLastRegisteredCompanies veri döndürmedi</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">"{search}" için sonuç yok.</p>
        ) : (
          <div>
            {filtered.map((c, i) => (
              <CompanyRow key={c.id} item={c} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ANA PANEL
══════════════════════════════════════════════════════════════════════════════ */
export default function BreakdownPanel() {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(false);

  // Firma verisi
  const [compData,    setCompData]    = useState<CompaniesResponse | null>(null);
  const [compLoading, setCompLoading] = useState(false);

  // Count parametreleri — arayüzden alınır
  const [countCountries, setCountCountries] = useState(10);
  const [countPositions, setCountPositions] = useState(10);
  const [countCompanies, setCountCompanies] = useState(10);

  // Ülke + pozisyon verisi çek
  const fetchBreakdown = (cC: number, cP: number) => {
    setLoading(true);
    fetch(`/api/breakdown?countCountries=${cC}&countPositions=${cP}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => setData({ countries: [], positions: [], source: 'mock', fetchedAt: '', error: e.message }))
      .finally(() => setLoading(false));
  };

  // Firma verisi çek
  const fetchCompanies = (count: number) => {
    setCompLoading(true);
    fetch(`/api/crewinjob/companies?count=${count}`)
      .then(r => r.json())
      .then(d => setCompData(d))
      .catch(e => setCompData({ companies: [], source: 'mock', fetchedAt: '', error: e.message }))
      .finally(() => setCompLoading(false));
  };

  // Panel açıldığında ilk veriyi çek
  useEffect(() => {
    if (!open) return;
    if (!data)     fetchBreakdown(countCountries, countPositions);
    if (!compData) fetchCompanies(countCompanies);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce ref'leri — hızlı yazışta son değeri bekle
  const timerBreakdown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCompanies = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Count değişince yeniden çek (500ms debounce)
  const handleCountCountriesChange = useCallback((n: number) => {
    setCountCountries(n);
    if (timerBreakdown.current) clearTimeout(timerBreakdown.current);
    timerBreakdown.current = setTimeout(() => fetchBreakdown(n, countPositions), 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countPositions]);
  const handleCountPositionsChange = useCallback((n: number) => {
    setCountPositions(n);
    if (timerBreakdown.current) clearTimeout(timerBreakdown.current);
    timerBreakdown.current = setTimeout(() => fetchBreakdown(countCountries, n), 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countCountries]);
  const handleCountCompaniesChange = useCallback((n: number) => {
    setCountCompanies(n);
    if (timerCompanies.current) clearTimeout(timerCompanies.current);
    timerCompanies.current = setTimeout(() => fetchCompanies(n), 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    fetchBreakdown(countCountries, countPositions);
    fetchCompanies(countCompanies);
  };

  return (
    <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      {/* Toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span>📊</span>
          <span>Ülke & Pozisyon & Firma Dağılımı</span>
          {data && !loading && (
            <>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                data.source === 'api'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
              }`}>
                {data.source === 'api' ? '● Gerçek API' : '◐ Mock'}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {data.countries.length} ülke · {data.positions.length} pozisyon
                {compData ? ` · ${compData.companies.length} firma` : ''}
              </span>
            </>
          )}
        </div>
        <span className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="px-6 pb-6 pt-1">
          {loading && (
            <div className="flex items-center gap-3 py-8 text-slate-400 dark:text-slate-500 text-sm">
              <div className="w-5 h-5 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
              Veriler yükleniyor...
            </div>
          )}

          {data?.error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm flex gap-2 mb-4">
              <span>❌</span>
              <div>
                <p className="font-semibold">Veri çekilemedi</p>
                <p className="text-xs mt-0.5 opacity-80">{data.error}</p>
              </div>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Üst bar: kaynak + yenile */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {data.source === 'api' && data.fetchedAt
                    ? `api.crewin.org · ${new Date(data.fetchedAt).toLocaleString('tr-TR')}`
                    : 'Mock veri — CREWINJOB_API_KEY eksik'}
                </p>
                <button
                  onClick={refresh}
                  className="text-xs text-ocean hover:text-ocean-dark font-medium flex items-center gap-1 transition-colors"
                >
                  🔄 Yenile
                </button>
              </div>

              {/* Ülke + Pozisyon (2 sütun) */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
                <BreakdownSection
                  title="Ülke Dağılımı"
                  icon="🌍"
                  items={data.countries}
                  color="bg-emerald-500"
                  emptyMsg="GetCountriesWithMostGemiAdamiGenelMembersCount veri döndürmedi"
                  count={countCountries}
                  onCountChange={handleCountCountriesChange}
                />
                <BreakdownSection
                  title="Pozisyon Dağılımı"
                  icon="⚓"
                  items={data.positions}
                  color="bg-ocean"
                  emptyMsg="GetTheTopPositionsWithHighestCountOfSeafarers veri döndürmedi"
                  count={countPositions}
                  onCountChange={handleCountPositionsChange}
                />
              </div>

              {/* Son Firmalar (tam genişlik) */}
              <CompaniesSection
                data={compData}
                loading={compLoading}
                count={countCompanies}
                onCountChange={handleCountCompaniesChange}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

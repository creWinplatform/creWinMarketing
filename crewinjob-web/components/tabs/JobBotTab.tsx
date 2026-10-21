'use client';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { onTabKeys } from '@/components/platform/tab-keys';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

// ── Sabit lookup veriler (crewinjob API'sinden alınmış) ──────────────────────
const SHIP_TYPES = [
  { id: 1,  name: 'Bulk Carrier' },
  { id: 2,  name: 'General Cargo Vessel' },
  { id: 3,  name: 'Container Vessel' },
  { id: 5,  name: 'Ro-Ro Vessel' },
  { id: 6,  name: 'Oil Tanker' },
  { id: 7,  name: 'Product Tanker' },
  { id: 8,  name: 'Chemical Tanker' },
  { id: 9,  name: 'LNG/LPG Tanker' },
  { id: 10, name: 'Passenger/Cruise Ship' },
  { id: 11, name: 'Multi-Purpose Vessel' },
  { id: 12, name: 'Livestock Carrier' },
  { id: 13, name: 'Heavy-lift/Project Cargo Vessel' },
  { id: 14, name: 'Fishing Vessel' },
  { id: 15, name: 'Tug' },
  { id: 16, name: 'Platform' },
  { id: 17, name: 'Yacht' },
  { id: 18, name: 'Other' },
];

const CONTRACT_TYPES = [
  { id: 1, name: '2+/-1 mon.' },
  { id: 2, name: '3+/-1 mon.' },
  { id: 3, name: '4+/-1 mon.' },
  { id: 4, name: '5+/-1 mon.' },
  { id: 5, name: '6+/-1 mon.' },
  { id: 6, name: '7+/-1 mon.' },
  { id: 7, name: '8+/-1 mon.' },
];

const CURRENCIES = [
  { id: 1, name: 'USD' },
  { id: 2, name: 'EUR' },
  { id: 3, name: 'TL' },
  { id: 4, name: 'GBP' },
  { id: 5, name: 'RMB' },
  { id: 6, name: 'JPY' },
  { id: 7, name: 'INR' },
  { id: 8, name: 'RUB' },
];

// Tüm 264 ülke
const ALL_COUNTRIES = [
  {id:1,name:'Afghanistan',tr:'Afganistan'},{id:2,name:'Albania',tr:'Arnavutluk'},{id:3,name:'Algeria',tr:'Cezayir'},{id:9,name:'Antigua And Barbuda',tr:'Antigua ve Barbuda'},{id:10,name:'Argentina',tr:'Arjantin'},{id:11,name:'Armenia',tr:'Ermenistan'},{id:13,name:'Australia',tr:'Avustralya'},{id:14,name:'Austria',tr:'Avusturya'},{id:15,name:'Azerbaijan',tr:'Azerbeycan'},{id:16,name:'Bahamas',tr:'Bahamas'},{id:17,name:'Bahrain',tr:'Bahreyn'},{id:18,name:'Bangladesh',tr:'Banglades'},{id:20,name:'Belarus',tr:'Belarus'},{id:21,name:'Belgium',tr:'Belçika'},{id:22,name:'Belize',tr:'Belize'},{id:24,name:'Bermuda',tr:'Bermuda'},{id:26,name:'Bolivia',tr:'Bolivya'},{id:27,name:'Bosnia And Herzegovina',tr:'Bosna Hersek'},{id:30,name:'Brazil',tr:'Brezilya'},{id:32,name:'Brunei',tr:'Brunei'},{id:33,name:'Bulgaria',tr:'Bulgaristan'},{id:36,name:'Cambodia',tr:'Kamboçya'},{id:37,name:'Cameroon',tr:'Kamerun'},{id:38,name:'Canada',tr:'Kanada'},{id:40,name:'Cayman Islands',tr:'Cayman Adalari'},{id:43,name:'Chile',tr:'Sili'},{id:44,name:'China',tr:'Çin'},{id:47,name:'Colombia',tr:'Kolombiya'},{id:48,name:'Comoros',tr:'Komorlar'},{id:52,name:'Costa Rica',tr:'Kosta Rika'},{id:54,name:'Croatia',tr:'Hirvatistan'},{id:55,name:'Cuba',tr:'Küba'},{id:56,name:'Cyprus',tr:'Kibris'},{id:57,name:'Czech Republic',tr:'Çek Cumhuriyeti'},{id:58,name:'Denmark',tr:'Danimarka'},{id:59,name:'Djibouti',tr:'Cibuti'},{id:61,name:'Dominican Republic',tr:'Dominik Cumhuriyeti'},{id:63,name:'Ecuador',tr:'Ekvador'},{id:64,name:'Egypt',tr:'Misir'},{id:68,name:'Estonia',tr:'Estonya'},{id:69,name:'Ethiopia',tr:'Etiyopya'},{id:73,name:'Fiji Islands',tr:'Fiji Adalari'},{id:74,name:'Finland',tr:'Finlandiya'},{id:75,name:'France',tr:'Fransa'},{id:79,name:'Gabon',tr:'Gabon'},{id:81,name:'Georgia',tr:'Gürcistan'},{id:82,name:'Germany',tr:'Almanya'},{id:83,name:'Ghana',tr:'Gana'},{id:85,name:'Greece',tr:'Yunanistan'},{id:90,name:'Guatemala',tr:'Guatemala'},{id:94,name:'Guyana',tr:'Guyana'},{id:95,name:'Haiti',tr:'Haiti'},{id:97,name:'Honduras',tr:'Honduras'},{id:98,name:'Hong Kong S.A.R.',tr:'Hong Kong'},{id:99,name:'Hungary',tr:'Macaristan'},{id:100,name:'Iceland',tr:'Izlanda'},{id:101,name:'India',tr:'Hindistan'},{id:102,name:'Indonesia',tr:'Endonezya'},{id:103,name:'Iran',tr:'Iran'},{id:104,name:'Iraq',tr:'Irak'},{id:105,name:'Ireland',tr:'Irlanda'},{id:106,name:'Israel',tr:'Israil'},{id:107,name:'Italy',tr:'Italya'},{id:108,name:'Jamaica',tr:'Jamaika'},{id:109,name:'Japan',tr:'Japonya'},{id:111,name:'Jordan',tr:'Ürdün'},{id:112,name:'Kazakhstan',tr:'Kazakistan'},{id:113,name:'Kenya',tr:'Kenya'},{id:116,name:'Korea South',tr:'Güney Kore'},{id:117,name:'Kuwait',tr:'Kuveyt'},{id:118,name:'Kyrgyzstan',tr:'Kirgizistan'},{id:120,name:'Latvia',tr:'Letonya'},{id:121,name:'Lebanon',tr:'Lübnan'},{id:123,name:'Liberia',tr:'Liberya'},{id:124,name:'Libya',tr:'Libya'},{id:126,name:'Lithuania',tr:'Litvanya'},{id:127,name:'Luxembourg',tr:'Lüksemburg'},{id:129,name:'Macedonia',tr:'Makedonya'},{id:130,name:'Madagascar',tr:'Madagaskar'},{id:132,name:'Malaysia',tr:'Malezya'},{id:133,name:'Maldives',tr:'Maldivler'},{id:135,name:'Malta',tr:'Malta'},{id:136,name:'Man (Isle of)',tr:'Isle of Man'},{id:137,name:'Marshall Islands',tr:'Marsal Adalari'},{id:139,name:'Mauritania',tr:'Moritanya'},{id:140,name:'Mauritius',tr:'Mauritius'},{id:142,name:'Mexico',tr:'Meksika'},{id:144,name:'Moldova',tr:'Moldova'},{id:145,name:'Monaco',tr:'Monako'},{id:146,name:'Mongolia',tr:'Mogolistan'},{id:148,name:'Morocco',tr:'Fas'},{id:149,name:'Mozambique',tr:'Mozambik'},{id:150,name:'Myanmar',tr:'Myanmar'},{id:151,name:'Namibia',tr:'Namibya'},{id:153,name:'Nepal',tr:'Nepal'},{id:155,name:'Netherlands',tr:'Hollanda'},{id:157,name:'New Zealand',tr:'Yeni Zelanda'},{id:158,name:'Nicaragua',tr:'Nikaragua'},{id:160,name:'Nigeria',tr:'Nijerya'},{id:164,name:'Norway',tr:'Norveç'},{id:165,name:'Oman',tr:'Umman'},{id:166,name:'Pakistan',tr:'Pakistan'},{id:169,name:'Panama',tr:'Panama'},{id:170,name:'Papua New Guinea',tr:'Papua Yeni Gine'},{id:172,name:'Peru',tr:'Peru'},{id:173,name:'Philippines',tr:'Filipinler'},{id:175,name:'Poland',tr:'Polonya'},{id:176,name:'Portugal',tr:'Portekiz'},{id:177,name:'Puerto Rico',tr:'Porto Riko'},{id:178,name:'Qatar',tr:'Katar'},{id:180,name:'Romania',tr:'Romanya'},{id:181,name:'Russia',tr:'Rusya'},{id:184,name:'Saint Kitts And Nevis',tr:'Saint Kitts And Nevis'},{id:191,name:'Saudi Arabia',tr:'Suudi Arabistan'},{id:192,name:'Senegal',tr:'Senegal'},{id:193,name:'Serbia',tr:'Sirbistan'},{id:194,name:'Seychelles',tr:'Seyseller'},{id:196,name:'Singapore',tr:'Singapur'},{id:197,name:'Slovakia',tr:'Slovakya'},{id:202,name:'South Africa',tr:'Güney Afrika'},{id:204,name:'South Sudan',tr:'Güney Sudan'},{id:205,name:'Spain',tr:'Ispanya'},{id:206,name:'Sri Lanka',tr:'Srilanka'},{id:207,name:'Sudan',tr:'Sudan'},{id:211,name:'Sweden',tr:'Isveç'},{id:212,name:'Switzerland',tr:'Isviçre'},{id:213,name:'Syria',tr:'Suriye'},{id:214,name:'Taiwan',tr:'Tayvan'},{id:216,name:'Tanzania',tr:'Tanzanya'},{id:217,name:'Thailand',tr:'Tayland'},{id:221,name:'Trinidad And Tobago',tr:'Trinidad ve Tobago'},{id:222,name:'Tunisia',tr:'Tunus'},{id:223,name:'Turkiye',tr:'Türkiye'},{id:224,name:'Turkmenistan',tr:'Türkmenistan'},{id:227,name:'Uganda',tr:'Uganda'},{id:228,name:'Ukraine',tr:'Ukrayna'},{id:229,name:'United Arab Emirates',tr:'Birlesik Arap Emirlikleri'},{id:230,name:'United Kingdom',tr:'Birlesik Krallik'},{id:231,name:'United States',tr:'Amerika Birlesik Devletleri'},{id:233,name:'Uruguay',tr:'Uruguay'},{id:234,name:'Uzbekistan',tr:'Özbekistan'},{id:237,name:'Venezuela',tr:'Venezuela'},{id:238,name:'Vietnam',tr:'Vietnam'},{id:243,name:'Yemen',tr:'Yemen'},{id:245,name:'Zambia',tr:'Zambiya'},{id:246,name:'Zimbabwe',tr:'Zimbabve'},{id:262,name:'Montenegro',tr:'Karadağ'},
];

// ── Sabit küçük listeler ──────────────────────────────────────────────────────
const VISA_TYPES = [
  { id: 1, name: 'International passport', tr: 'Uluslararası pasaport' },
  { id: 2, name: 'National passport',      tr: 'Ulusal pasaport' },
  { id: 3, name: 'US visa C1/D',           tr: 'ABD vizesi C1/D' },
  { id: 4, name: 'US visa B1/B2',          tr: 'ABD vizesi B1/B2' },
  { id: 5, name: 'US visa B1/OCS',         tr: 'ABD vizesi B1/OCS' },
  { id: 6, name: 'Schengen visa',          tr: 'Schengen vizesi' },
];

const LANG_LEVELS = [
  { id: 1, name: 'Elementary',         tr: 'Başlangıç' },
  { id: 2, name: 'Lower intermediate', tr: 'Orta altı' },
  { id: 3, name: 'Intermediate',       tr: 'Orta' },
  { id: 4, name: 'Upper intermediate', tr: 'Orta üstü' },
  { id: 5, name: 'Advanced',           tr: 'İleri' },
  { id: 6, name: 'Native',             tr: 'Ana dil' },
];

// ── Tipler ────────────────────────────────────────────────────────────────────
interface PosOption { id: number; name: string; trName: string; }
interface CompanyOption { id: number; name: string; country: string; email: string; }
interface LookupItem { id: number; name: string; }
interface LangRow { langId: number | null; levelId: number | null; }

interface JobForm {
  positionId:     number | null;
  positionText:   string;
  shipTypeId:     number | null;
  shipTypeText:   string;
  countryId:      number | null;
  countryText:    string;
  cityId:         number | null;
  cityText:       string;
  contractTypeId: number | null;
  contractTypeText: string;
  currencyId:     number | null;
  currencyText:   string;
  minPrice:       string;
  maxPrice:       string;
  companyId:      number | null;
  companyText:    string;
  email:          string;
  explanation:    string;
  startDate:      string;
  expirationDate: string;
  languages:      LangRow[];
  visaTypes:      (number | null)[];
  certificates:   (number | null)[];
  endorsements:   string[];
}

interface QueueItem {
  id:        string;
  source:    string;
  status:    'pending' | 'posting' | 'posted' | 'error';
  createdAt: string;
  postedAt?: string;
  error?:    string;
  data:      Record<string, unknown>;
}

interface Stats { total: number; pending: number; posted: number; errors: number; }

const EMPTY_FORM: JobForm = {
  positionId: null, positionText: '',
  shipTypeId: null, shipTypeText: '',
  countryId:  null, countryText:  '',
  cityId:     null, cityText:     '',
  contractTypeId: null, contractTypeText: '',
  currencyId: null, currencyText: '',
  minPrice: '', maxPrice: '', companyId: null, companyText: '', email: '', explanation: '',
  startDate: '', expirationDate: '',
  languages: [], visaTypes: [], certificates: [], endorsements: [],
};

// ── Fuzzy match yardımcısı ─────────────────────────────────────────────────────
function matchOption<T extends { id: number; name: string }>(
  text: string, options: T[]
): T | undefined {
  if (!text) return undefined;
  const lo = text.toLowerCase();
  return (
    options.find(o => o.name.toLowerCase() === lo) ||
    options.find(o => o.name.toLowerCase().includes(lo)) ||
    options.find(o => lo.includes(o.name.toLowerCase()))
  );
}

// ── Combobox bileşeni ─────────────────────────────────────────────────────────
function Combobox({
  value, inputVal, onChange, onSelect, options, placeholder, loading = false,
}: {
  value: number | null;
  inputVal: string;
  onChange: (text: string) => void;
  onSelect: (id: number | null, text: string) => void;
  options: { id: number; label: string; sub?: string }[];
  placeholder?: string;
  loading?: boolean;
}) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const wrapRef         = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);

  const filtered = inputVal
    ? options.filter(o =>
        o.label.toLowerCase().includes(inputVal.toLowerCase()) ||
        (o.sub && o.sub.toLowerCase().includes(inputVal.toLowerCase()))
      )
    : options;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); inputRef.current?.focus(); } }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-400 outline-none pr-8 dark:border-slate-700"
          style={{ backgroundColor: value ? '#f0f9ff' : undefined, color: '#1e293b' }}
          placeholder={placeholder}
          value={inputVal}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label={placeholder}
          aria-expanded={open}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={lang === 'tr' ? 'Seçenekleri göster' : 'Show options'}
          aria-expanded={open}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600 text-xs dark:text-slate-400"
          onClick={() => setOpen(o => !o)}
        >
          {value ? '✓' : '▾'}
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          maxHeight: 220, overflowY: 'auto',
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
          marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {loading ? (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{lang === 'tr' ? 'Yükleniyor…' : 'Loading…'}</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{lang === 'tr' ? 'Bulunamadı' : 'Not found'}</div>
          ) : filtered.map(opt => (
            <button
              type="button"
              key={opt.id}
              className="w-full text-left flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-blue-50"
              style={{ borderBottom: '1px solid #f3f4f6' }}
              onMouseDown={e => { e.preventDefault(); onSelect(opt.id, opt.label); setOpen(false); }}
              onClick={() => { onSelect(opt.id, opt.label); setOpen(false); inputRef.current?.focus(); }}
            >
              <span className={opt.id === value ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-slate-100'}>
                {opt.label}
              </span>
              {opt.sub && <span className="text-xs text-gray-500 ml-2 dark:text-slate-400">{opt.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: QueueItem['status'] }) {
  const { lang } = useLang();
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    posting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    posted:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    error:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  const label: Record<string, string> = lang === 'tr' ? {
    pending: 'Bekliyor', posting: 'Yayınlanıyor…', posted: 'Yayında', error: 'Hata',
  } : {
    pending: 'Pending', posting: 'Publishing…', posted: 'Live', error: 'Error',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] || ''}`}>
      {label[status] || status}
    </span>
  );
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────
export default function JobBotTab() {
  const { lang } = useLang();
  const t = (tr: string, en: string) => (lang === 'tr' ? tr : en);
  const [subTab, setSubTab]  = useState<'create' | 'queue' | 'history'>('create');
  const [form,    setForm]    = useState<JobForm>(EMPTY_FORM);
  const [aiLoad,  setAiLoad]  = useState(false);
  const aiTextRef             = useRef<HTMLTextAreaElement>(null);
  const [positions,  setPositions]  = useState<PosOption[]>([]);
  const [posLoad,    setPosLoad]    = useState(false);
  const [companies,  setCompanies]  = useState<CompanyOption[]>([]);
  const [compLoad,   setCompLoad]   = useState(false);
  const [cities,     setCities]     = useState<{ id: number; name: string }[]>([]);
  const [cityLoad,   setCityLoad]   = useState(false);
  const [apiLanguages, setApiLanguages] = useState<LookupItem[]>([]);
  const [apiCerts,     setApiCerts]     = useState<LookupItem[]>([]);
  const [queue,   setQueue]   = useState<QueueItem[]>([]);
  const [stats,   setStats]   = useState<Stats>({ total: 0, pending: 0, posted: 0, errors: 0 });
  const [msg,     setMsg]     = useState('');
  const [msgUrl,  setMsgUrl]  = useState<string | null>(null);
  const [msgOk,   setMsgOk]   = useState(true);
  const [busy,    setBusy]    = useState<string | null>(null);
  const [editId,  setEditId]  = useState<string | null>(null);
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);
  const explanationId         = useId();

  // ── Position + Company options yükleme ───────────────────────────────────
  useEffect(() => {
    setPosLoad(true);
    fetch('/api/job-bot?action=positions')
      .then(r => r.json())
      .then(d => { if (d.ok && d.positions?.length) setPositions(d.positions); })
      .catch(() => {})
      .finally(() => setPosLoad(false));
  }, []);

  useEffect(() => {
    setCompLoad(true);
    fetch('/api/job-bot?action=companies')
      .then(r => r.json())
      .then(d => { if (d.ok && d.companies?.length) setCompanies(d.companies); })
      .catch(() => {})
      .finally(() => setCompLoad(false));
  }, []);

  useEffect(() => {
    fetch('/api/job-bot?action=languages')
      .then(r => r.json())
      .then(d => { if (d.ok && d.languages?.length) setApiLanguages(d.languages); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/job-bot?action=certificates')
      .then(r => r.json())
      .then(d => { if (d.ok && d.certificates?.length) setApiCerts(d.certificates); })
      .catch(() => {});
  }, []);

  // ── Ülke değişince şehirleri yükle ───────────────────────────────────────
  useEffect(() => {
    if (!form.countryId) { setCities([]); return; }
    setCityLoad(true);
    setCities([]);
    setForm(f => ({ ...f, cityId: null, cityText: '' }));
    fetch(`/api/job-bot?action=cities&countryId=${form.countryId}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setCities(d.cities || []); })
      .catch(() => {})
      .finally(() => setCityLoad(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.countryId]);

  // ── Kuyruk polling ────────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    try {
      const res  = await fetch('/api/job-bot');
      const data = await res.json();
      if (data.ok) { setQueue(data.queue || []); setStats(data.stats || {}); }
    } catch {}
  }, []);

  useEffect(() => {
    loadQueue();
    pollRef.current = setInterval(loadQueue, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadQueue]);

  const showMsg = (text: string, ok = true, url: string | null = null) => {
    setMsg(text); setMsgOk(ok); setMsgUrl(url);
    setTimeout(() => { setMsg(''); setMsgUrl(null); }, 15000);
  };

  // ── Pozisyon combobox seçenekleri ─────────────────────────────────────────
  const posOptions = positions.length > 0
    ? positions.map(p => ({ id: p.id, label: p.name, sub: p.trName !== p.name ? p.trName : undefined }))
    : [];

  const shipOptions  = SHIP_TYPES.map(s => ({ id: s.id, label: s.name }));
  const ctOptions    = CONTRACT_TYPES.map(c => ({ id: c.id, label: c.name }));
  const curOptions   = CURRENCIES.map(c => ({ id: c.id, label: c.name }));
  const cntOptions   = ALL_COUNTRIES.map(c => ({ id: c.id, label: c.name, sub: lang === 'tr' && c.tr !== c.name ? c.tr : undefined }));
  const compOptions  = companies.map(c => ({ id: c.id, label: c.name, sub: c.country || undefined }));

  // ── AI sonucunu forma uygula (parse + generate ortak) ─────────────────────
  const applyAiResult = (d: Record<string, string | number | null>) => {
    // Pozisyon eşleştir
    const posOpt = posOptions.length > 0
      ? posOptions.find(o => o.label.toLowerCase() === String(d.positionName || '').toLowerCase()) ||
        posOptions.find(o => o.label.toLowerCase().includes(String(d.positionName || '').toLowerCase())) ||
        posOptions.find(o => String(d.positionName || '').toLowerCase().includes(o.label.toLowerCase()))
      : undefined;

    const shipOpt = matchOption(String(d.shipType || ''), SHIP_TYPES);
    const ctOpt   = CONTRACT_TYPES.find(c => c.name === d.contractType);
    const curOpt  = CURRENCIES.find(c => c.name === d.currency);
    const cntOpt  = ALL_COUNTRIES.find(c =>
      c.name.toLowerCase() === String(d.country || '').toLowerCase() ||
      c.tr?.toLowerCase() === String(d.country || '').toLowerCase() ||
      c.name.toLowerCase().includes(String(d.country || '').toLowerCase())
    );

    setForm(f => ({
      ...f,
      positionId:      posOpt?.id    ?? f.positionId,
      positionText:    posOpt?.label ?? String(d.positionName || f.positionText),
      shipTypeId:      shipOpt?.id   ?? f.shipTypeId,
      shipTypeText:    shipOpt?.name ?? String(d.shipType || f.shipTypeText),
      countryId:       cntOpt?.id    ?? f.countryId,
      countryText:     cntOpt?.name  ?? String(d.country || f.countryText),
      contractTypeId:  ctOpt?.id     ?? f.contractTypeId,
      contractTypeText: ctOpt?.name  ?? String(d.contractType || f.contractTypeText),
      currencyId:      curOpt?.id    ?? f.currencyId,
      currencyText:    curOpt?.name  ?? String(d.currency || f.currencyText),
      minPrice:        d.minPrice    != null ? String(d.minPrice) : f.minPrice,
      maxPrice:        d.maxPrice    != null ? String(d.maxPrice) : f.maxPrice,
      email:           String(d.email        || f.email),
      explanation:     String(d.explanation  || f.explanation),
      startDate:       String(d.startDate    || f.startDate),
      expirationDate:  String(d.expirationDate || f.expirationDate),
    }));
  };

  // ── AI ile Doldur — metin varsa parse, boşsa sıfırdan üret ────────────────
  const handleAiParse = async () => {
    const aiText = (aiTextRef.current?.value || '').trim();
    const generateMode = !aiText;   // kutu boşsa AI sıfırdan üretir
    setAiLoad(true);
    try {
      const res  = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          generateMode
            ? { action: 'generate_ai', hint: '' }
            : { action: 'parse_ai', text: aiText }
        ),
      });
      const data = await res.json();
      if (!data.ok) { showMsg(data.message || t('AI işlemi başarısız', 'AI operation failed'), false); return; }

      applyAiResult(data.data as Record<string, string | number | null>);

      if (aiTextRef.current) aiTextRef.current.value = '';
      showMsg(generateMode
        ? t('✨ AI yeni bir ilan üretti — kontrol edip yayınla', '✨ AI generated a new job posting — review and publish it')
        : t('✅ AI alanları doldurdu — kontrol edip yayınla', '✅ AI filled in the fields — review and publish it'));
    } catch (e) {
      showMsg(t('Bağlantı hatası: ', 'Connection error: ') + (e as Error).message, false);
    } finally {
      setAiLoad(false);
    }
  };

  // ── Form → API DTO dönüştür ───────────────────────────────────────────────
  const formToJobData = () => {
    const langFields: Record<string, number | null> = {};
    form.languages.forEach((row, i) => {
      langFields[`language${i + 1}`]      = row.langId  ?? null;
      langFields[`languageLevel${i + 1}`] = row.levelId ?? null;
    });

    const visaFields: Record<string, number | null> = {};
    form.visaTypes.forEach((v, i) => { visaFields[`visaType${i + 1}`] = v ?? null; });

    const certFields: Record<string, number | null> = {};
    form.certificates.forEach((c, i) => { certFields[`certificateNameId${i + 1}`] = c ?? null; });

    const endorseFields: Record<string, string | null> = {};
    form.endorsements.forEach((e, i) => { endorseFields[`endorsement${i + 1}`] = e || null; });

    return {
      positionId:     form.positionId,
      shipTypeId:     form.shipTypeId,
      countryId:      form.countryId,
      contractTypeId: form.contractTypeId,
      currencyId:     form.currencyId,
      minPrice:       form.minPrice ? parseFloat(form.minPrice) : null,
      maxPrice:       form.maxPrice ? parseFloat(form.maxPrice) : null,
      cityId:         form.cityId    || null,
      companyId:      form.companyId || null,
      email:          form.email     || null,
      explanation:    form.explanation || null,
      startDate:      form.startDate   || null,
      expirationDate: form.expirationDate || null,
      ...langFields,
      ...visaFields,
      ...certFields,
      ...endorseFields,
      // Display labels (kuyrukta gösterim için)
      _positionName:   form.positionText,
      _shipTypeName:   form.shipTypeText,
      _countryName:    form.countryText,
      _contractName:   form.contractTypeText,
      _currencyName:   form.currencyText,
      _cityName:       form.cityText,
      _companyName:    form.companyText,
      _languages:      form.languages,
      _visaTypes:      form.visaTypes,
      _certificates:   form.certificates,
      _endorsements:   form.endorsements,
    };
  };

  // ── Direkt yayınla ───────────────────────────────────────────────────────
  const handlePublishDirect = async () => {
    if (!form.positionId) { showMsg(t('Lütfen pozisyon seçin', 'Please select a position'), false); return; }
    setBusy('direct');
    try {
      const res  = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_direct', jobData: formToJobData() }),
      });
      const data = await res.json();
      if (data.ok) { setForm(EMPTY_FORM); showMsg(t('🎉 İlan crewinjob.com\'a yayınlandı!', '🎉 Job posting published to crewinjob.com!'), true, data.ilanUrl || null); }
      else showMsg(data.message || t('API hatası', 'API error'), false);
    } catch { showMsg(t('Bağlantı hatası', 'Connection error'), false); }
    setBusy(null);
  };

  // ── Kuyruğa ekle ─────────────────────────────────────────────────────────
  const handleAddQueue = async () => {
    if (!form.positionId) { showMsg(t('Lütfen pozisyon seçin', 'Please select a position'), false); return; }
    setBusy('queue');
    try {
      const res  = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_to_queue', jobData: formToJobData(), source: 'manual' }),
      });
      const data = await res.json();
      if (data.ok) { setForm(EMPTY_FORM); await loadQueue(); setSubTab('queue'); showMsg(t('✅ Kuyruğa eklendi', '✅ Added to queue')); }
      else showMsg(data.message || t('Hata', 'Error'), false);
    } catch { showMsg(t('Bağlantı hatası', 'Connection error'), false); }
    setBusy(null);
  };

  // ── Onayla ───────────────────────────────────────────────────────────────
  const handleApprove = async (id: string) => {
    setBusy(id);
    try {
      const res  = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id }),
      });
      const data = await res.json();
      if (data.ok) { await loadQueue(); showMsg(t('🎉 Yayınlandı!', '🎉 Published!'), true, data.ilanUrl || null); }
      else showMsg(data.message || t('Hata', 'Error'), false);
    } catch { showMsg(t('Bağlantı hatası', 'Connection error'), false); }
    setBusy(null);
  };

  const handleRemove = async (id: string) => {
    setBusy(id + '_del');
    try {
      await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id }),
      });
      await loadQueue();
    } catch {}
    setBusy(null);
  };

  const handleEdit = (item: QueueItem) => {
    const d = item.data as Record<string, unknown>;
    setForm({
      positionId:      (d.positionId as number)     ?? null,
      positionText:    (d._positionName as string)  || '',
      shipTypeId:      (d.shipTypeId as number)     ?? null,
      shipTypeText:    (d._shipTypeName as string)  || '',
      countryId:       (d.countryId as number)      ?? null,
      countryText:     (d._countryName as string)   || '',
      cityId:          (d.cityId as number)         ?? null,
      cityText:        (d._cityName as string)      || '',
      contractTypeId:  (d.contractTypeId as number) ?? null,
      contractTypeText:(d._contractName as string)  || '',
      currencyId:      (d.currencyId as number)     ?? null,
      currencyText:    (d._currencyName as string)  || '',
      minPrice:        String(d.minPrice ?? ''),
      maxPrice:        String(d.maxPrice ?? ''),
      companyId:       (d.companyId as number) ?? null,
      companyText:     (d._companyName as string) || '',
      email:           (d.email as string)          || '',
      explanation:     (d.explanation as string)    || '',
      startDate:       (d.startDate as string)      || '',
      expirationDate:  (d.expirationDate as string) || '',
      languages:       (d._languages as LangRow[])           || [],
      visaTypes:       (d._visaTypes as (number | null)[])   || [],
      certificates:    (d._certificates as (number | null)[])|| [],
      endorsements:    (d._endorsements as string[])          || [],
    });
    setEditId(item.id);
    setSubTab('create');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateQueue = async () => {
    if (!editId) return;
    setBusy('update');
    try {
      const res  = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: editId, jobData: formToJobData() }),
      });
      const data = await res.json();
      if (data.ok) { setForm(EMPTY_FORM); setEditId(null); await loadQueue(); showMsg(t('Güncellendi', 'Updated')); }
      else showMsg(data.message || t('Hata', 'Error'), false);
    } catch { showMsg(t('Bağlantı hatası', 'Connection error'), false); }
    setBusy(null);
  };

  const pending = queue.filter(i => ['pending','posting','error'].includes(i.status));
  const posted  = queue.filter(i => i.status === 'posted');

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* ── Başlık + statlar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100">{t('📋 İlan Botu', '📋 Job bot')}</h2>
          <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{t("crewinjob.com'a denizcilik iş ilanı oluştur", 'Create maritime job postings on crewinjob.com')}</p>
        </div>
        <div className="flex gap-2">
          {[
            { label: t('Toplam', 'Total'),  val: stats.total,   cls: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
            { label: t('Bekliyor', 'Pending'), val: stats.pending, cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
            { label: t('Yayında', 'Live'), val: stats.posted,  cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
            { label: t('Hata', 'Error'),    val: stats.errors,  cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
          ].map(s => (
            <div key={s.label} className={`px-3 py-1.5 rounded-xl text-center ${s.cls}`}>
              <div className="text-lg font-bold leading-tight">{(s.val ?? 0).toLocaleString(localeTag(lang))}</div>
              <div className="text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Mesaj banner ───────────────────────────────────────────────────── */}
      {msg && (
        <div role={msgOk ? 'status' : 'alert'} className={`px-4 py-3 rounded-lg text-sm font-medium flex flex-col gap-1.5 ${msgOk ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'}`}>
          <span><Msg text={msg} /></span>
          {msgUrl && (
            <a
              href={msgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline font-semibold text-sm dark:text-blue-400"
            >
              <span aria-hidden="true">🔗</span> {msgUrl}
            </a>
          )}
        </div>
      )}

      {/* ── Sub-tab navigation ─────────────────────────────────────────────── */}
      <div role="tablist" aria-label={t('İlan botu bölümleri', 'Job bot sections')} onKeyDown={onTabKeys} className="flex gap-1 bg-gray-100 rounded-xl p-1 dark:bg-slate-700">
        {([
          ['create',  t('✏️ İlan Oluştur', '✏️ Create job posting')],
          ['queue',   `${t('📥 Kuyruk', '📥 Queue')}${stats.pending > 0 ? ` (${stats.pending})` : ''}`],
          ['history', `${t('✅ Yayınlananlar', '✅ Published')}${stats.posted > 0 ? ` (${stats.posted})` : ''}`],
        ] as [typeof subTab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={subTab === key}
            tabIndex={subTab === key ? 0 : -1}
            onClick={() => { setSubTab(key); if (key !== 'create') setEditId(null); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              subTab === key ? 'bg-white shadow text-blue-600 dark:bg-slate-800 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB: İLAN OLUŞTUR                                              */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === 'create' && (
        <div className="space-y-5">

          {/* Düzenleme modu banner */}
          {editId && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300">
              {t('✏️ Kuyruk öğesi düzenleniyor', '✏️ Editing queue item')}
              <button onClick={() => { setForm(EMPTY_FORM); setEditId(null); }} className="ml-auto underline text-blue-500 dark:text-blue-400">{t('İptal', 'Cancel')}</button>
            </div>
          )}

          {/* ── AI Otomatik Doldur ──────────────────────────────────────── */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/40 dark:to-slate-800 border border-purple-200 rounded-xl p-4 space-y-3 dark:border-purple-800">
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">🤖</span>
              <span className="font-semibold text-gray-700 dark:text-slate-200">{t('AI ile Otomatik Doldur', 'Auto-fill with AI')}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full dark:bg-purple-900/30 dark:text-purple-300">Gemini</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {t('Metin yapıştırırsan (Telegram, e-posta, LinkedIn…) AI alanları çıkarır.', 'If you paste text (Telegram, email, LinkedIn…), AI extracts the fields.')} <strong>{t('Boş bırakıp butona basarsan AI sıfırdan gerçekçi bir denizcilik ilanı üretir.', 'If you leave it empty and press the button, AI generates a realistic maritime job posting from scratch.')}</strong>
            </p>
            <textarea
              ref={aiTextRef}
              rows={5}
              className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-600 outline-none resize-none bg-white dark:border-purple-800 dark:bg-slate-800"
              style={{ color: '#1e293b' }}
              placeholder={t('İlan metnini buraya yapıştır — VEYA boş bırak, AI senin için bir ilan üretsin…', 'Paste the job posting text here — or leave it empty and let AI generate one for you…')}
              defaultValue=""
              aria-label={t('İlan metni', 'Job posting text')}
            />
            <button
              onClick={handleAiParse}
              disabled={aiLoad}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
            >
              {aiLoad ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  {t('AI çalışıyor…', 'AI is working…')}
                </>
              ) : t('✨ AI ile Doldur / Üret', '✨ Fill / Generate with AI')}
            </button>
          </div>

          {/* ── Form ───────────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 dark:bg-slate-800 dark:border-slate-700" style={{ color: '#1e293b' }}>
            <h3 className="font-semibold text-gray-700 flex items-center gap-2 dark:text-slate-200">
              {t('📝 İlan Detayları', '📝 Job posting details')}
              <span className="text-xs font-normal text-gray-500 dark:text-slate-400">{t('(mavi arka plan = seçildi)', '(blue background = selected)')}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Pozisyon */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
                  {t('Pozisyon *', 'Position *')}
                  {posLoad && <span className="ml-1 text-blue-400 font-normal">{t('yükleniyor…', 'loading…')}</span>}
                  {!posLoad && posOptions.length > 0 && <span className="ml-1 text-green-500 font-normal dark:text-green-400">({posOptions.length} {t('seçenek', 'options')})</span>}
                </label>
                <Combobox
                  value={form.positionId}
                  inputVal={form.positionText}
                  onChange={text => setForm(f => ({ ...f, positionText: text, positionId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, positionId: id, positionText: text }))}
                  options={posOptions}
                  placeholder={t('Pozisyon ara veya seç…', 'Search or select a position…')}
                  loading={posLoad}
                />
              </div>

              {/* Gemi Tipi */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Gemi Tipi', 'Ship type')}</label>
                <Combobox
                  value={form.shipTypeId}
                  inputVal={form.shipTypeText}
                  onChange={text => setForm(f => ({ ...f, shipTypeText: text, shipTypeId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, shipTypeId: id, shipTypeText: text }))}
                  options={shipOptions}
                  placeholder={t('Gemi tipi seç…', 'Select ship type…')}
                />
              </div>

              {/* Ülke */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Ülke / Bayrak', 'Country / Flag')}</label>
                <Combobox
                  value={form.countryId}
                  inputVal={form.countryText}
                  onChange={text => setForm(f => ({ ...f, countryText: text, countryId: null, cityId: null, cityText: '' }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, countryId: id, countryText: text, cityId: null, cityText: '' }))}
                  options={cntOptions}
                  placeholder={t('Ülke ara…', 'Search country…')}
                />
              </div>

              {/* Şehir */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
                  {t('Şehir', 'City')}
                  {cityLoad && <span className="ml-1 text-blue-400 font-normal">{t('yükleniyor…', 'loading…')}</span>}
                  {!cityLoad && cities.length > 0 && <span className="ml-1 text-green-500 font-normal dark:text-green-400">({cities.length} {t('şehir', 'cities')})</span>}
                  {!form.countryId && <span className="ml-1 text-gray-500 font-normal dark:text-slate-400">{t('(önce ülke seç)', '(select a country first)')}</span>}
                </label>
                <Combobox
                  value={form.cityId}
                  inputVal={form.cityText}
                  onChange={text => setForm(f => ({ ...f, cityText: text, cityId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, cityId: id, cityText: text }))}
                  options={cities.map(c => ({ id: c.id, label: c.name }))}
                  placeholder={form.countryId ? t('Şehir ara veya seç…', 'Search or select a city…') : t('Önce ülke seçin', 'Select a country first')}
                  loading={cityLoad}
                />
              </div>

              {/* Kontrat Tipi */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Kontrat Süresi', 'Contract duration')}</label>
                <Combobox
                  value={form.contractTypeId}
                  inputVal={form.contractTypeText}
                  onChange={text => setForm(f => ({ ...f, contractTypeText: text, contractTypeId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, contractTypeId: id, contractTypeText: text }))}
                  options={ctOptions}
                  placeholder={t('Kontrat süresi seç…', 'Select contract duration…')}
                />
              </div>

              {/* Para Birimi */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Para Birimi', 'Currency')}</label>
                <Combobox
                  value={form.currencyId}
                  inputVal={form.currencyText}
                  onChange={text => setForm(f => ({ ...f, currencyText: text, currencyId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, currencyId: id, currencyText: text }))}
                  options={curOptions}
                  placeholder="USD, EUR…"
                />
              </div>

              {/* Maaş Aralığı */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Maaş Aralığı', 'Salary range')}</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" placeholder="Min" aria-label={t('Minimum maaş', 'Minimum salary')}
                    className="w-1/2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
                    value={form.minPrice}
                    onChange={e => setForm(f => ({ ...f, minPrice: e.target.value }))}
                  />
                  <input
                    type="number" min="0" placeholder="Max" aria-label={t('Maksimum maaş', 'Maximum salary')}
                    className="w-1/2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
                    value={form.maxPrice}
                    onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))}
                  />
                </div>
              </div>

              {/* Firma */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
                  {t('Firma', 'Company')}
                  {compLoad && <span className="ml-1 text-blue-400 font-normal">{t('yükleniyor…', 'loading…')}</span>}
                  {!compLoad && compOptions.length > 0 && <span className="ml-1 text-green-500 font-normal dark:text-green-400">({compOptions.length} {t('firma', 'companies')})</span>}
                </label>
                <Combobox
                  value={form.companyId}
                  inputVal={form.companyText}
                  onChange={text => setForm(f => ({ ...f, companyText: text, companyId: null }))}
                  onSelect={(id, text) => setForm(f => ({ ...f, companyId: id, companyText: text }))}
                  options={compOptions}
                  placeholder={t('Firma ara veya seç…', 'Search or select a company…')}
                  loading={compLoad}
                />
              </div>

              {/* Email */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('İletişim E-postası', 'Contact email')}</label>
                <input
                  type="email" placeholder="jobs@company.com" aria-label={t('İletişim E-postası', 'Contact email')}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* Tarihler */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Başlangıç Tarihi', 'Start date')}</label>
                <input
                  type="date"
                  aria-label={t('Başlangıç Tarihi', 'Start date')}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Son Başvuru Tarihi', 'Application deadline')}</label>
                <input
                  type="date"
                  aria-label={t('Son Başvuru Tarihi', 'Application deadline')}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
                  value={form.expirationDate}
                  onChange={e => setForm(f => ({ ...f, expirationDate: e.target.value }))}
                />
              </div>

            </div>

            {/* Açıklama */}
            <div className="flex flex-col gap-1">
              <label htmlFor={explanationId} className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('İş Tanımı / Açıklama', 'Job description')}</label>
              <textarea
                id={explanationId}
                rows={4}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none resize-none dark:border-slate-700"
                placeholder={t('İş gereksinimleri, sorumluluklar, avantajlar…', 'Requirements, responsibilities, benefits…')}
                value={form.explanation}
                onChange={e => setForm(f => ({ ...f, explanation: e.target.value }))}
              />
            </div>

            {/* ── Ek Gereksinimler ─────────────────────────────────────── */}
            <div className="border-t border-gray-100 pt-4 space-y-4 dark:border-slate-700">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Ek Gereksinimler', 'Additional requirements')}</h4>

              {/* Diller */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
                  {t('Dil Gereksinimleri', 'Language requirements')}
                  {apiLanguages.length > 0 && <span className="ml-1 text-green-500 font-normal dark:text-green-400">({apiLanguages.length} {t('dil', 'languages')})</span>}
                </label>
                <LanguageRows
                  rows={form.languages}
                  languages={apiLanguages}
                  onChange={rows => setForm(f => ({ ...f, languages: rows }))}
                />
              </div>

              {/* Vize Tipleri */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">{t('Vize / Pasaport Gereksinimleri', 'Visa / passport requirements')}</label>
                <MultiSelectRows
                  rows={form.visaTypes}
                  options={VISA_TYPES.map(v => ({ id: v.id, name: lang === 'tr' ? v.tr : v.name }))}
                  onChange={rows => setForm(f => ({ ...f, visaTypes: rows }))}
                  placeholder={t('Vize / pasaport tipi seç…', 'Select visa / passport type…')}
                  addLabel={t('+ Vize Ekle', '+ Add visa')}
                />
              </div>

              {/* Sertifikalar */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
                  {t('Sertifikalar', 'Certificates')}
                  {apiCerts.length > 0 && <span className="ml-1 text-green-500 font-normal dark:text-green-400">({apiCerts.length} {t('sertifika', 'certificates')})</span>}
                </label>
                <MultiSelectRows
                  rows={form.certificates}
                  options={apiCerts}
                  onChange={rows => setForm(f => ({ ...f, certificates: rows }))}
                  placeholder={t('Sertifika seç…', 'Select certificate…')}
                  addLabel={t('+ Sertifika Ekle', '+ Add certificate')}
                />
              </div>

              {/* Endorsements */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Endorsements</label>
                <EndorsementRows
                  rows={form.endorsements}
                  onChange={rows => setForm(f => ({ ...f, endorsements: rows }))}
                />
              </div>
            </div>

            {/* Seçilen değerler özeti */}
            {(form.positionId || form.shipTypeId || form.countryId) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {form.positionId && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full dark:bg-blue-900/30 dark:text-blue-300">✓ {form.positionText}</span>}
                {form.shipTypeId && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full dark:bg-blue-900/30 dark:text-blue-300">✓ {form.shipTypeText}</span>}
                {form.countryId  && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full dark:bg-blue-900/30 dark:text-blue-300">✓ {form.countryText}</span>}
                {form.contractTypeId && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full dark:bg-blue-900/30 dark:text-blue-300">✓ {form.contractTypeText}</span>}
                {form.currencyId && (form.minPrice || form.maxPrice) && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full dark:bg-green-900/30 dark:text-green-300">
                    💰 {form.minPrice||'?'}–{form.maxPrice||'?'} {form.currencyText}
                  </span>
                )}
              </div>
            )}

            {/* Butonlar */}
            <div className="flex gap-3 pt-2 border-t border-gray-100 flex-wrap dark:border-slate-700">
              {editId ? (
                <>
                  <button onClick={handleUpdateQueue} disabled={busy === 'update'} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {busy === 'update' ? t('Kaydediliyor…', 'Saving…') : t('💾 Kuyruğu Güncelle', '💾 Update queue item')}
                  </button>
                  <button onClick={() => { setForm(EMPTY_FORM); setEditId(null); }} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold dark:bg-slate-600 dark:text-slate-200">
                    {t('İptal', 'Cancel')}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handlePublishDirect} disabled={!!busy} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {busy === 'direct' ? t('Yayınlanıyor…', 'Publishing…') : t('🚀 Hemen Yayınla', '🚀 Publish now')}
                  </button>
                  <button onClick={handleAddQueue} disabled={!!busy} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {busy === 'queue' ? t('Ekleniyor…', 'Adding…') : t('📥 Kuyruğa Ekle', '📥 Add to queue')}
                  </button>
                  <button onClick={() => setForm(EMPTY_FORM)} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold dark:bg-slate-600 dark:text-slate-200">
                    {t('Temizle', 'Clear')}
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              <strong>{t('Hemen Yayınla', 'Publish now')}</strong> {t("→ crewinjob API'ye direkt gönderir.", '→ sends directly to the crewinjob API.')} &nbsp;
              <strong>{t('Kuyruğa Ekle', 'Add to queue')}</strong> {t('→ inceleyip onaylarsın.', '→ you review and approve it.')}
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB: KUYRUK                                                    */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === 'queue' && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-slate-400">
              <div className="text-5xl mb-3" aria-hidden="true">📭</div>
              <p className="text-lg font-medium">{t('Kuyruk boş', 'Queue is empty')}</p>
              <p className="text-sm mt-1">{t('İlan oluştur → Kuyruğa Ekle', 'Create a job posting → Add to queue')}</p>
            </div>
          ) : pending.map(item => (
            <QueueCard key={item.id} item={item} onApprove={handleApprove} onRemove={handleRemove} onEdit={handleEdit} busy={busy} />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB: YAYINLANANLAR                                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === 'history' && (
        <div className="space-y-3">
          {posted.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-slate-400">
              <div className="text-5xl mb-3" aria-hidden="true">📋</div>
              <p className="text-lg font-medium">{t('Henüz yayınlanan ilan yok', 'No published job postings yet')}</p>
            </div>
          ) : posted.map(item => (
            <QueueCard key={item.id} item={item} onApprove={handleApprove} onRemove={handleRemove} onEdit={handleEdit} busy={busy} readonly />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dil satırları bileşeni ─────────────────────────────────────────────────────
function LanguageRows({ rows, languages, onChange }: {
  rows: LangRow[];
  languages: LookupItem[];
  onChange: (rows: LangRow[]) => void;
}) {
  const { lang } = useLang();
  const addRow    = () => onChange([...rows, { langId: null, levelId: null }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<LangRow>) =>
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
            style={{ color: '#1e293b' }}
            value={row.langId ?? ''}
            aria-label={lang === 'tr' ? `Dil ${i + 1}` : `Language ${i + 1}`}
            onChange={e => updateRow(i, { langId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{lang === 'tr' ? 'Dil seç…' : 'Select language…'}</option>
            {languages.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
            style={{ color: '#1e293b' }}
            value={row.levelId ?? ''}
            aria-label={lang === 'tr' ? `Dil seviyesi ${i + 1}` : `Language level ${i + 1}`}
            onChange={e => updateRow(i, { levelId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{lang === 'tr' ? 'Seviye…' : 'Level…'}</option>
            {LANG_LEVELS.map(l => <option key={l.id} value={l.id}>{lang === 'tr' ? l.tr : l.name}</option>)}
          </select>
          <button
            onClick={() => removeRow(i)}
            aria-label={lang === 'tr' ? 'Satırı kaldır' : 'Remove row'}
            title={lang === 'tr' ? 'Kaldır' : 'Remove'}
            className="text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded"
          >✕</button>
        </div>
      ))}
      {rows.length < 5 && (
        <button onClick={addRow} className="text-xs text-blue-600 hover:underline mt-1 dark:text-blue-400">
          {lang === 'tr' ? '+ Dil Ekle' : '+ Add language'}
        </button>
      )}
    </div>
  );
}

// ── Çoklu seçim satırları (vize, sertifika) ───────────────────────────────────
function MultiSelectRows({ rows, options, onChange, placeholder, addLabel }: {
  rows: (number | null)[];
  options: LookupItem[];
  onChange: (rows: (number | null)[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const { lang } = useLang();
  const addRow    = () => onChange([...rows, null]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, val: number | null) =>
    onChange(rows.map((r, idx) => idx === i ? val : r));

  return (
    <div className="space-y-2">
      {rows.map((val, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
            style={{ color: '#1e293b' }}
            value={val ?? ''}
            aria-label={placeholder || (lang === 'tr' ? 'Seç…' : 'Select…')}
            onChange={e => updateRow(i, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{placeholder || (lang === 'tr' ? 'Seç…' : 'Select…')}</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button
            onClick={() => removeRow(i)}
            aria-label={lang === 'tr' ? 'Satırı kaldır' : 'Remove row'}
            title={lang === 'tr' ? 'Kaldır' : 'Remove'}
            className="text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded"
          >✕</button>
        </div>
      ))}
      {rows.length < 5 && (
        <button onClick={addRow} className="text-xs text-blue-600 hover:underline mt-1 dark:text-blue-400">
          {addLabel || (lang === 'tr' ? '+ Ekle' : '+ Add')}
        </button>
      )}
    </div>
  );
}

// ── Endorsement satırları (serbest metin) ─────────────────────────────────────
function EndorsementRows({ rows, onChange }: {
  rows: string[];
  onChange: (rows: string[]) => void;
}) {
  const { lang } = useLang();
  const addRow    = () => onChange([...rows, '']);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, val: string) =>
    onChange(rows.map((r, idx) => idx === i ? val : r));

  return (
    <div className="space-y-2">
      {rows.map((val, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none dark:border-slate-700"
            style={{ color: '#1e293b' }}
            placeholder={lang === 'tr' ? 'Endorsement (örn: STCW II/1, IGF…)' : 'Endorsement (e.g. STCW II/1, IGF…)'}
            aria-label={`Endorsement ${i + 1}`}
            value={val}
            onChange={e => updateRow(i, e.target.value)}
          />
          <button
            onClick={() => removeRow(i)}
            aria-label={lang === 'tr' ? 'Satırı kaldır' : 'Remove row'}
            title={lang === 'tr' ? 'Kaldır' : 'Remove'}
            className="text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded"
          >✕</button>
        </div>
      ))}
      {rows.length < 5 && (
        <button onClick={addRow} className="text-xs text-blue-600 hover:underline mt-1 dark:text-blue-400">
          {lang === 'tr' ? '+ Endorsement Ekle' : '+ Add endorsement'}
        </button>
      )}
    </div>
  );
}

// ── Kuyruk kartı ──────────────────────────────────────────────────────────────
function QueueCard({
  item, onApprove, onRemove, onEdit, busy, readonly = false,
}: {
  item:      QueueItem;
  onApprove: (id: string) => void;
  onRemove:  (id: string) => void;
  onEdit:    (item: QueueItem) => void;
  busy:      string | null;
  readonly?: boolean;
}) {
  const { lang } = useLang();
  const t = (tr: string, en: string) => (lang === 'tr' ? tr : en);
  const locale = localeTag(lang);
  const [expanded, setExpanded] = useState(false);
  const d = item.data as Record<string, unknown>;

  const pos      = String(d._positionName || d.positionId   || '—');
  const ship     = String(d._shipTypeName || d.shipTypeId   || '');
  const country  = String(d._countryName  || d.countryId    || '');
  const contract = String(d._contractName || d.contractTypeId || '');
  const currency = String(d._currencyName || d.currencyId   || '');
  const minP     = d.minPrice ? String(d.minPrice) : '';
  const maxP     = d.maxPrice ? String(d.maxPrice) : '';

  return (
    <div className={`bg-white dark:bg-slate-800 border rounded-xl overflow-visible transition-shadow hover:shadow-md ${
      item.status === 'error' ? 'border-red-200 dark:border-red-800' : item.status === 'posted' ? 'border-green-200 dark:border-green-800' : 'border-gray-200 dark:border-slate-700'
    }`}>
      <button type="button" className="w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer" aria-expanded={expanded} onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800 dark:text-slate-100">{pos}</span>
            {ship && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full dark:bg-blue-900/30 dark:text-blue-300">{ship}</span>}
            <StatusBadge status={item.status} />
          </div>
          <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap dark:text-slate-400">
            {country && <span>🏴 {country}</span>}
            {contract && <span>📅 {contract}</span>}
            {(minP || maxP) && currency && <span>💰 {minP||'?'}–{maxP||'?'} {currency}</span>}
            {item.postedAt
              ? <span>✅ {new Date(item.postedAt).toLocaleDateString(locale)}</span>
              : <span>{new Date(item.createdAt).toLocaleDateString(locale)}</span>}
          </div>
        </div>
        <span className="text-gray-500 text-xs dark:text-slate-400" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 text-sm dark:border-slate-700">
          {item.error && (
            <div role="alert" className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-xs dark:bg-red-900/30 dark:text-red-300"><span aria-hidden="true">❌</span> <Msg text={item.error} /></div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              [t('Pozisyon', 'Position'),  pos],
              [t('Gemi Tipi', 'Ship type'), ship],
              [t('Ülke', 'Country'),      country],
              [t('Kontrat', 'Contract'),   contract],
              [t('Para Birimi', 'Currency'), currency],
              [t('Min Maaş', 'Min salary'),  minP],
              [t('Max Maaş', 'Max salary'),  maxP],
              [t('E-posta', 'Email'), String(d.email || '')],
              [t('Başlangıç', 'Start'), String(d.startDate || '')],
              [t('Son Başvuru', 'Deadline'), String(d.expirationDate || '')],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <span className="text-gray-500 w-24 shrink-0 dark:text-slate-400">{k}:</span>
                <span className="text-gray-700 dark:text-slate-200">{v}</span>
              </div>
            ))}
          </div>
          {d.explanation != null && d.explanation !== '' && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 dark:text-slate-300 dark:bg-slate-800">{String(d.explanation)}</div>
          )}
          {!readonly && (
            <div className="flex gap-2 pt-1">
              {(item.status === 'pending' || item.status === 'error') && (
                <button onClick={() => onApprove(item.id)} disabled={busy === item.id}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  {busy === item.id ? t('Yayınlanıyor…', 'Publishing…') : t('🚀 Onayla & Yayınla', '🚀 Approve & publish')}
                </button>
              )}
              <button onClick={() => onEdit(item)}
                className="px-4 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold dark:bg-blue-900/30 dark:text-blue-300">
                {t('✏️ Düzenle', '✏️ Edit')}
              </button>
              <button onClick={() => onRemove(item.id)} disabled={busy === item.id + '_del'}
                className="px-4 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400">
                {t('🗑 Sil', '🗑 Delete')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

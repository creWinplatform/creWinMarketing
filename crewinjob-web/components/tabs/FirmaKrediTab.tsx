'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang, type Lang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

type HakTipi = 1 | 2 | 3;
type KaynakTipi = 1 | 2 | 3 | 4 | 5 | 6;
type OdemeYontemi = 1 | 2 | 3 | 99;
type Page = 'bekleyen' | 'firma' | 'odemeler';

interface FirmaSearchItem {
  firmaId: number;
  unvan: string;
  email?: string;
  ulke?: string;
}

interface HakSatiri {
  hakTipi: HakTipi;
  miktar: number;
  gecerlilikBitis?: string | null;
}

interface BekleyenSiparis {
  siparisId: number;
  firmaId: number;
  firmaUnvan: string;
  referansKodu: string;
  paket: string;
  talepEdilenHaklar: HakSatiri[];
  tutar: number;
  paraBirimi: string;
  olusturmaTarihi: string;
  sonGecerlilikTarihi: string;
}

interface FirmaDurum {
  firmaId: number;
  unvan: string;
  email?: string;
  ulke?: string;
  bakiyeler: {
    cvKredisi: number;
    ilanHakki: number;
    bullseyeAktifMi: boolean;
    bullseyeBitisTarihi: string | null;
  };
  yakindaSonaErecek?: HakSatiri[];
  yakindaSonErecekHaklar?: HakSatiri[];
  toplamOdenenTutar: { paraBirimi: string; tutar: number; adet?: number }[];
}

interface Hareket {
  hareketId?: number;
  id?: number;
  hakTipi: HakTipi;
  miktar: number;
  kaynakTipi: KaynakTipi;
  kaynakTipAdi?: string;
  kaynakId?: number | null;
  gecerlilikBitis?: string | null;
  olusturanKullaniciAdi?: string;
  olusturmaTarihi: string;
  durum?: string;
  iptalEdildiMi?: boolean;
}

interface Odeme {
  odemeId?: number;
  id?: number;
  firmaUnvan: string;
  tutar: number;
  paraBirimi: string;
  odemeTarihi: string;
  odemeYontemi: OdemeYontemi;
  bankaReferansNo: string;
  gonderenUnvan?: string;
  faturaNo?: string;
  dekontDosyaId?: number | null;
  durum?: string;
  olusturanKullaniciAdi?: string;
  olusturmaTarihi?: string;
  iptalEdildiMi?: boolean;
}

interface Ozet {
  toplamOdeme?: { paraBirimi: string; tutar: number; adet: number }[];
  tanimlananHaklar?: { cvKredisi?: number; ilanHakki?: number; bullseyeGun?: number };
  odemeYapanFirmaSayisi?: number;
}

interface Paged<T> {
  toplamKayit?: number;
  totalCount?: number;
  kayitlar?: T[];
  items?: T[];
  toplamOdeme?: { paraBirimi: string; tutar: number; adet?: number }[];
}

// Etiketler [TR, EN]
const HAK_TIPI_LABEL: Record<HakTipi, [string, string]> = { 1: ['CV Kredisi', 'CV credits'], 2: ['İlan Hakkı', 'Job posting rights'], 3: ['Bullseye Gün', 'Bullseye days'] };
const KAYNAK_TIPI_LABEL: Record<KaynakTipi, [string, string]> = {
  1: ['Manuel Ödeme', 'Manual payment'],
  2: ['Kredi Kartı', 'Credit card'],
  3: ['Promosyon', 'Promotion'],
  4: ['Düzeltme', 'Adjustment'],
  5: ['Kullanım', 'Usage'],
  6: ['Açılış Bakiyesi', 'Opening balance'],
};
const ODEME_YONTEMI_LABEL: Record<OdemeYontemi, [string, string]> = { 1: ['Havale', 'Bank transfer'], 2: ['EFT', 'EFT'], 3: ['Swift', 'Swift'], 99: ['Diğer', 'Other'] };
const PARA_BIRIMLERI = ['USD', 'EUR', 'TRY'];
const today = () => new Date().toISOString().slice(0, 10);
const tt = (lang: Lang, tr: string, en: string) => lang === 'tr' ? tr : en;
const pick = (pair: [string, string] | undefined, lang: Lang, fallback = '-') => pair ? pair[lang === 'tr' ? 0 : 1] : fallback;
const hakLabel = (value: HakTipi, lang: Lang) => pick(HAK_TIPI_LABEL[value], lang, String(value));
const kaynakLabel = (value: KaynakTipi, lang: Lang) => pick(KAYNAK_TIPI_LABEL[value], lang, String(value));
const yontemLabel = (value: OdemeYontemi, lang: Lang) => pick(ODEME_YONTEMI_LABEL[value], lang, String(value));
// Ham hata mesajı state'te tutulur, render sırasında seçili dilde çevrilir (dil değişimi veri yeniden çekmez)
const UNKNOWN_ERROR = '__unknown__';
function rawError(err: unknown) {
  return (err instanceof Error ? err.message : String(err || '')) || UNKNOWN_ERROR;
}

function friendlyError(err: unknown, lang: Lang) {
  const raw = err instanceof Error ? err.message : String(err || '');
  const message = raw === UNKNOWN_ERROR ? '' : raw;
  if (message.includes('Pages.FirmaKrediYonetimi')) {
    return lang === 'tr' ? 'Kredi yönetimi API hesabında Pages.FirmaKrediYonetimi yetkisi yok. Yetkili kredi hesabını tanımlayıp Yenile ile tekrar deneyin.' : 'The credit management API account lacks the Pages.FirmaKrediYonetimi permission. Configure an authorized credit account, then select Refresh.';
  }
  if (message.includes('HTTP 404')) {
    return lang === 'tr' ? 'Kredi yönetimi verileri şu anda alınamadı. Lütfen backend servis yayınını kontrol edin.' : "Couldn't load credit management data. Check the backend service deployment.";
  }
  if (message.includes('HTTP 405')) {
    return lang === 'tr' ? 'Kredi yönetimi servisi bu işlem tipini kabul etmedi. Lütfen endpoint method tanımını kontrol edin.' : 'The credit management service rejected this request method. Check the endpoint method definition.';
  }
  if (message.includes('HTTP 500') || message.toLowerCase().includes('<!doctype html')) {
    return lang === 'tr' ? 'Kredi yönetimi servisi beklenen JSON yanıtı veremedi. Backend hatası giderildikten sonra Yenile ile tekrar deneyin.' : "The credit management service didn't return the expected JSON. Select Refresh once the backend error is fixed.";
  }
  if (message.toLowerCase().includes('fetch failed')) {
    return lang === 'tr' ? 'Kredi yönetimi verileri şu anda alınamadı. Bağlantı toparlanınca Yenile ile tekrar deneyebilirsiniz.' : "Couldn't load credit management data right now. Select Refresh once the connection recovers.";
  }
  if (message.includes('API kimlik bilgisi tanımlı değil')) {
    return lang === 'tr' ? 'CrewinJob API kimlik bilgileri tanımlı değil.' : "CrewinJob API credentials aren't configured.";
  }
  return message || (lang === 'tr' ? 'İşlem tamamlanamadı.' : "Couldn't complete the operation.");
}

function para(value: number, currency?: string, lang: Lang = 'tr') {
  const amount = new Intl.NumberFormat(localeTag(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
  return currency ? `${amount} ${currency}` : amount;
}

function tarih(value?: string | null, lang: Lang = 'tr') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(localeTag(lang), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function expired(value: string) {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}

function listFrom<T>(result: Paged<T> | T[] | undefined): T[] {
  if (Array.isArray(result)) return result;
  return result?.kayitlar ?? result?.items ?? [];
}

function normalizeRights(value: unknown): HakSatiri[] {
  if (Array.isArray(value)) return value as HakSatiri[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as HakSatiri[] : [];
  } catch {
    return [];
  }
}

function normalizePendingOrder(order: BekleyenSiparis): BekleyenSiparis {
  const raw = order as BekleyenSiparis & {
    id?: number;
    firmaAdi?: string;
    companyName?: string;
    creationTime?: string;
    createdAt?: string;
    talepEdilenHaklar?: unknown;
  };
  return {
    ...order,
    siparisId: order.siparisId ?? raw.id ?? 0,
    firmaUnvan: order.firmaUnvan ?? raw.firmaAdi ?? raw.companyName ?? '-',
    olusturmaTarihi: order.olusturmaTarihi ?? raw.creationTime ?? raw.createdAt ?? '',
    talepEdilenHaklar: normalizeRights(raw.talepEdilenHaklar),
  };
}

async function readError(res: Response) {
  const data = await res.json().catch(() => null) as {
    error?: string | { message?: string; details?: string };
    message?: string;
  } | null;
  if (typeof data?.error === 'string') return data.error;
  if (data?.error?.message) return data.error.message;
  return data?.message || `HTTP ${res.status}`;
}

async function apiGet<T>(endpoint: string, params: Record<string, string | number | undefined | null> = {}): Promise<T> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const res = await fetch(`/api/firma-kredi/${endpoint}${qs.size ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { result: T }).result;
}

async function apiPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/firma-kredi/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(await readError(res)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return ((await res.json()) as { result: T }).result;
}

async function uploadReceipt(file: File): Promise<number | null> {
  const form = new FormData();
  form.append('dosya', file);
  const res = await fetch('/api/firma-kredi/DekontYukle', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { result: { dosyaId?: number; id?: number } | number };
  return typeof data.result === 'number' ? data.result : data.result?.dosyaId ?? data.result?.id ?? null;
}

function FieldError({ text }: { text?: string }) {
  return text ? <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400"><Msg text={text} /></p> : null;
}

function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className="border-t border-slate-100 dark:border-slate-700">
          {Array.from({ length: columns }).map((__, col) => (
            <td key={col} className="px-3 py-3">
              <div className="h-3 w-full max-w-[140px] animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RightsChips({ items }: { items?: HakSatiri[] }) {
  const { lang } = useLang();
  if (!items?.length) return <span className="text-slate-400">-</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, idx) => (
        <span key={`${item.hakTipi}-${idx}`} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {item.hakTipi === 1 ? `${item.miktar} CV` : item.hakTipi === 2 ? `${item.miktar} ${tt(lang, 'İlan', item.miktar === 1 ? 'job posting' : 'job postings')}` : `${item.miktar} ${tt(lang, 'Gün Bullseye', item.miktar === 1 ? 'Bullseye day' : 'Bullseye days')}`}
        </span>
      ))}
    </div>
  );
}

function BalanceCard({ title, value, suffix, negative }: { title: string; value: string | number; suffix?: string; negative?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${negative ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300' : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{negative ? '⚠ ' : ''}{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-normal">{value}</div>
      {suffix && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{suffix}</div>}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const { lang } = useLang();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-slate-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">{tt(lang, 'Kapat', 'Close')}</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function ReceiptInput({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const { lang } = useLang();
  const [error, setError] = useState('');
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Dekont dosyası', 'Receipt file')}</label>
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        onChange={e => {
          const next = e.target.files?.[0] ?? null;
          if (next && next.size > 10 * 1024 * 1024) {
            setError(lang === 'tr' ? 'Dekont dosyası en fazla 10MB olabilir.' : 'The receipt file can be at most 10MB.');
            onChange(null);
            return;
          }
          // Sunucu da tipi ve dosya imzasını doğrular; burada erken uyarı
          if (next && !RECEIPT_TYPES.includes(next.type)) {
            setError(lang === 'tr' ? 'Dekont sadece PDF, JPG veya PNG olabilir.' : 'The receipt must be a PDF, JPG or PNG file.');
            onChange(null);
            return;
          }
          setError('');
          onChange(next);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      />
      <p className="mt-1 text-xs text-slate-400">{file ? file.name : tt(lang, 'PDF, JPG veya PNG; max 10MB', 'PDF, JPG or PNG; max 10MB')}</p>
      <FieldError text={error} />
    </div>
  );
}

function ReasonModal({ title, label, loading, onClose, onSubmit }: {
  title: string;
  label: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { lang } = useLang();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  return (
    <ModalShell title={title} onClose={onClose}>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label} *</label>
      <textarea
        value={reason}
        onChange={e => { setReason(e.target.value); setError(''); }}
        rows={4}
        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-ocean/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      <FieldError text={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{tt(lang, 'Vazgeç', 'Back')}</button>
        <button
          disabled={loading}
          onClick={async () => {
            if (!reason.trim()) { setError(lang === 'tr' ? 'İptal nedeni zorunlu.' : 'A cancellation reason is required.'); return; }
            setError('');
            try {
              await onSubmit(reason.trim());
            } catch (err) {
              // İptal başarısızsa modal açık kalır ve neden gösterilir
              setError(friendlyError(err, lang));
            }
          }}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? tt(lang, 'İşleniyor…', 'Processing…') : tt(lang, 'İptal et', 'Confirm cancellation')}
        </button>
      </div>
    </ModalShell>
  );
}

function ApproveOrderModal({ order, onDone, onClose }: { order: BekleyenSiparis; onDone: () => Promise<void>; onClose: () => void }) {
  const { lang } = useLang();
  const [form, setForm] = useState({
    bankaReferansNo: '',
    odemeTarihi: today(),
    odemeYontemi: 1 as OdemeYontemi,
    gonderenUnvan: '',
    faturaNo: '',
    aciklama: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const submit = async () => {
    if (!form.bankaReferansNo.trim()) { setFieldError(lang === 'tr' ? 'Banka referans no zorunlu.' : 'The bank reference number is required.'); return; }
    setLoading(true);
    setFieldError('');
    try {
      const dekontDosyaId = file ? await uploadReceipt(file) : null;
      await apiPost('HavaleSiparisiOnayla', { siparisId: order.siparisId, ...form, dekontDosyaId });
      await onDone();
      onClose();
    } catch (err) {
      // Backend bu iki senaryoyu da error.code=409 ile bildiriyor.
      if ((err as Error & { status?: number }).status === 409) setFieldError(lang === 'tr' ? 'Bu sipariş zaten onaylanmış ya da bu referans numarası daha önce kaydedilmiş.' : 'This order is already approved, or this reference number was already recorded.');
      else setFieldError(friendlyError(err, lang));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title={`${tt(lang, 'Sipariş onayla', 'Approve order')} - ${order.referansKodu}`} onClose={onClose}>
      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <div className="font-semibold text-slate-900 dark:text-slate-100">{order.firmaUnvan}</div>
        <div className="mt-1 text-slate-500">{order.paket} · {para(order.tutar, order.paraBirimi, lang)}</div>
        <div className="mt-2"><RightsChips items={order.talepEdilenHaklar} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Banka referans no', 'Bank reference no.')} *</label>
          <input value={form.bankaReferansNo} onChange={e => { setForm(f => ({ ...f, bankaReferansNo: e.target.value })); setFieldError(''); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <FieldError text={fieldError} />
        </div>
        <DateInput label={`${tt(lang, 'Ödeme tarihi', 'Payment date')} *`} value={form.odemeTarihi} onChange={v => setForm(f => ({ ...f, odemeTarihi: v }))} />
        <MethodSelect value={form.odemeYontemi} onChange={v => setForm(f => ({ ...f, odemeYontemi: v }))} />
        <TextInput label={tt(lang, 'Gönderen unvanı', 'Sender name')} value={form.gonderenUnvan} onChange={v => setForm(f => ({ ...f, gonderenUnvan: v }))} />
        <TextInput label={tt(lang, 'Fatura no', 'Invoice no.')} value={form.faturaNo} onChange={v => setForm(f => ({ ...f, faturaNo: v }))} />
        <div className="col-span-2"><ReceiptInput file={file} onChange={setFile} /></div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Açıklama', 'Notes')}</label>
          <textarea value={form.aciklama} onChange={e => setForm(f => ({ ...f, aciklama: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{tt(lang, 'Vazgeç', 'Cancel')}</button>
        <button onClick={submit} disabled={loading} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? tt(lang, 'Onaylanıyor…', 'Approving…') : tt(lang, 'Onayla', 'Approve')}</button>
      </div>
    </ModalShell>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
      <input type="date" max={today()} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
    </div>
  );
}

function MethodSelect({ value, onChange }: { value: OdemeYontemi; onChange: (value: OdemeYontemi) => void }) {
  const { lang } = useLang();
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Ödeme yöntemi', 'Payment method')} *</label>
      <select value={value} onChange={e => onChange(Number(e.target.value) as OdemeYontemi)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
        {([1, 2, 3, 99] as OdemeYontemi[]).map(v => <option key={v} value={v}>{yontemLabel(v, lang)}</option>)}
      </select>
    </div>
  );
}

function PaymentModal({ firma, onDone, onClose }: { firma: FirmaDurum; onDone: () => Promise<void>; onClose: () => void }) {
  const { lang } = useLang();
  const [form, setForm] = useState({
    tutar: '',
    paraBirimi: 'USD',
    odemeTarihi: today(),
    odemeYontemi: 1 as OdemeYontemi,
    bankaReferansNo: '',
    gonderenUnvan: '',
    faturaNo: '',
    aciklama: '',
  });
  const [rights, setRights] = useState<HakSatiri[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [bankError, setBankError] = useState('');
  const [formError, setFormError] = useState('');

  const addRight = () => setRights(r => [...r, { hakTipi: 1, miktar: 1, gecerlilikBitis: null }]);
  const updateRight = (idx: number, patch: Partial<HakSatiri>) => setRights(r => r.map((item, i) => i === idx ? { ...item, ...patch } : item));

  const submit = async () => {
    const amount = Number(form.tutar);
    if (!amount || amount <= 0) {
      const message = lang === 'tr' ? 'Tutar 0’dan büyük olmalı.' : 'The amount must be greater than 0.';
      setFormError(message); return;
    }
    if (!form.bankaReferansNo.trim()) {
      const message = lang === 'tr' ? 'Banka referans no zorunlu.' : 'The bank reference number is required.';
      setBankError(message); return;
    }
    setLoading(true);
    setBankError('');
    setFormError('');
    try {
      const dekontDosyaId = file ? await uploadReceipt(file) : null;
      await apiPost('OdemeKaydet', {
        firmaId: firma.firmaId,
        tutar: amount,
        paraBirimi: form.paraBirimi,
        odemeTarihi: form.odemeTarihi,
        odemeYontemi: form.odemeYontemi,
        bankaReferansNo: form.bankaReferansNo,
        gonderenUnvan: form.gonderenUnvan,
        faturaNo: form.faturaNo,
        dekontDosyaId,
        aciklama: form.aciklama,
        tanimlanacakHaklar: rights.filter(r => r.miktar > 0).map(r => ({ ...r, gecerlilikBitis: r.gecerlilikBitis || null })),
      });
      await onDone();
      onClose();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 409) setBankError(lang === 'tr' ? 'Bu referans numarası zaten kayıtlı.' : 'This reference number is already recorded.');
      else setFormError(friendlyError(err, lang));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title={`${tt(lang, 'Ödeme kaydet', 'Record payment')} - ${firma.unvan}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Tutar', 'Amount')} *</label>
          <input type="number" min="0" step="0.01" value={form.tutar} onChange={e => setForm(f => ({ ...f, tutar: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <FieldError text={formError} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Para birimi', 'Currency')} *</label>
          <select value={form.paraBirimi} onChange={e => setForm(f => ({ ...f, paraBirimi: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {PARA_BIRIMLERI.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <DateInput label={`${tt(lang, 'Ödeme tarihi', 'Payment date')} *`} value={form.odemeTarihi} onChange={v => setForm(f => ({ ...f, odemeTarihi: v }))} />
        <MethodSelect value={form.odemeYontemi} onChange={v => setForm(f => ({ ...f, odemeYontemi: v }))} />
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Banka referans no', 'Bank reference no.')} *</label>
          <input value={form.bankaReferansNo} onChange={e => { setForm(f => ({ ...f, bankaReferansNo: e.target.value })); setBankError(''); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <FieldError text={bankError} />
        </div>
        <TextInput label={tt(lang, 'Gönderen unvanı', 'Sender name')} value={form.gonderenUnvan} onChange={v => setForm(f => ({ ...f, gonderenUnvan: v }))} />
        <TextInput label={tt(lang, 'Fatura no', 'Invoice no.')} value={form.faturaNo} onChange={v => setForm(f => ({ ...f, faturaNo: v }))} />
        <div className="col-span-2"><ReceiptInput file={file} onChange={setFile} /></div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Açıklama', 'Notes')}</label>
          <textarea value={form.aciklama} onChange={e => setForm(f => ({ ...f, aciklama: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{tt(lang, 'Tanımlanacak haklar', 'Rights to grant')}</h4>
          <button onClick={addRight} className="rounded-lg border border-ocean/40 px-3 py-1.5 text-xs font-semibold text-ocean">{tt(lang, 'Hak ekle', 'Add right')}</button>
        </div>
        {rights.length === 0 && <p className="text-xs text-slate-400">{tt(lang, 'Liste boş bırakılabilir.', 'The list can be left empty.')}</p>}
        <div className="space-y-2">
          {rights.map((right, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_100px_150px_48px] gap-2">
              <select value={right.hakTipi} onChange={e => updateRight(idx, { hakTipi: Number(e.target.value) as HakTipi })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                {([1, 2, 3] as HakTipi[]).map(v => <option key={v} value={v}>{hakLabel(v, lang)}</option>)}
              </select>
              <input type="number" min="1" value={right.miktar || ''} onChange={e => updateRight(idx, { miktar: Number(e.target.value) || 0 })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <input type="date" value={right.gecerlilikBitis ?? ''} onChange={e => updateRight(idx, { gecerlilikBitis: e.target.value || null })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <button onClick={() => setRights(r => r.filter((_, i) => i !== idx))} className="rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">{tt(lang, 'Sil', 'Remove')}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{tt(lang, 'Vazgeç', 'Cancel')}</button>
        <button onClick={submit} disabled={loading} className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? tt(lang, 'Kaydediliyor…', 'Saving…') : tt(lang, 'Ödemeyi kaydet', 'Save payment')}</button>
      </div>
    </ModalShell>
  );
}

function RightModal({ firma, onDone, onClose }: { firma: FirmaDurum; onDone: () => Promise<void>; onClose: () => void }) {
  const { lang } = useLang();
  const [hakTipi, setHakTipi] = useState<HakTipi>(1);
  const [miktar, setMiktar] = useState('');
  const [gecerlilikBitis, setGecerlilikBitis] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!Number(miktar) || Number(miktar) <= 0) { setError(lang === 'tr' ? 'Miktar 0’dan büyük olmalı.' : 'The quantity must be greater than 0.'); return; }
    if (!aciklama.trim()) { setError(lang === 'tr' ? 'Açıklama zorunlu.' : 'Notes are required.'); return; }
    setLoading(true);
    setError('');
    try {
      await apiPost('HakTanimla', {
        firmaId: firma.firmaId,
        hakTipi,
        miktar: Number(miktar),
        kaynakTipi: 3,
        gecerlilikBitis: gecerlilikBitis || null,
        aciklama,
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(friendlyError(err, lang));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title={`${tt(lang, 'Hak tanımla', 'Grant rights')} - ${firma.unvan}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Hak tipi', 'Right type')} *</label>
          <select value={hakTipi} onChange={e => setHakTipi(Number(e.target.value) as HakTipi)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {([1, 2, 3] as HakTipi[]).map(v => <option key={v} value={v}>{hakLabel(v, lang)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Miktar', 'Quantity')} *</label>
          <input type="number" min="1" value={miktar} onChange={e => setMiktar(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Son kullanma tarihi', 'Expiry date')}</label>
          <input type="date" value={gecerlilikBitis} onChange={e => setGecerlilikBitis(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{tt(lang, 'Açıklama', 'Notes')} *</label>
          <textarea value={aciklama} onChange={e => setAciklama(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <FieldError text={error} />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{tt(lang, 'Vazgeç', 'Cancel')}</button>
        <button onClick={submit} disabled={loading} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? tt(lang, 'Kaydediliyor…', 'Saving…') : tt(lang, 'Hak tanımla', 'Grant rights')}</button>
      </div>
    </ModalShell>
  );
}

export default function FirmaKrediTab() {
  const { lang } = useLang();
  const tr = lang === 'tr';
  const [page, setPage] = useState<Page>('bekleyen');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [pending, setPending] = useState<BekleyenSiparis[]>([]);
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingLoading, setPendingLoading] = useState(false);
  const [approveOrder, setApproveOrder] = useState<BekleyenSiparis | null>(null);
  const [cancelOrder, setCancelOrder] = useState<BekleyenSiparis | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [firmaQuery, setFirmaQuery] = useState('');
  const [firmaResults, setFirmaResults] = useState<FirmaSearchItem[]>([]);
  const [firmaLoading, setFirmaLoading] = useState(false);
  const [firma, setFirma] = useState<FirmaDurum | null>(null);
  const [firmaDataLoading, setFirmaDataLoading] = useState(false);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [hareketHakTipi, setHareketHakTipi] = useState('');
  const [hareketBaslangic, setHareketBaslangic] = useState('');
  const [hareketBitis, setHareketBitis] = useState('');
  const [paymentModal, setPaymentModal] = useState(false);
  const [rightModal, setRightModal] = useState(false);
  const [cancelMovement, setCancelMovement] = useState<Hareket | null>(null);

  const [payments, setPayments] = useState<Odeme[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentTotals, setPaymentTotals] = useState<{ paraBirimi: string; tutar: number; adet?: number }[]>([]);
  const [summary, setSummary] = useState<Ozet | null>(null);
  const [paymentFilters, setPaymentFilters] = useState({
    firmaArama: '',
    paraBirimi: '',
    odemeYontemi: '',
    baslangicTarihi: '',
    bitisTarihi: '',
  });

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  };

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await apiGet<Paged<BekleyenSiparis>>('GetBekleyenSiparisler', { firmaArama: pendingSearch, sayfa: 1, boyut: 20 });
      setPending(listFrom(data).map(normalizePendingOrder));
    } catch (err) {
      setNotice(rawError(err));
      setPending([]);
    } finally {
      setPendingLoading(false);
    }
  }, [pendingSearch]);

  const loadFirmData = useCallback(async (firmaId: number) => {
    setFirmaDataLoading(true);
    setError('');
    setNotice('');
    try {
      const [durum, hareketData] = await Promise.all([
        apiGet<FirmaDurum>('GetFirmaDurum', { firmaId }),
        apiGet<Paged<Hareket>>('GetHareketGecmisi', {
          firmaId,
          hakTipi: hareketHakTipi,
          baslangicTarihi: hareketBaslangic,
          bitisTarihi: hareketBitis,
          sayfa: 1,
          boyut: 20,
        }),
      ]);
      setFirma(durum);
      setHareketler(listFrom(hareketData));
    } catch (err) {
      setNotice(rawError(err));
      setFirma(null);
      setHareketler([]);
    } finally {
      setFirmaDataLoading(false);
    }
  }, [hareketBaslangic, hareketBitis, hareketHakTipi]);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setError('');
    setNotice('');
    try {
      const [paymentData, summaryData] = await Promise.all([
        apiGet<Paged<Odeme>>('GetOdemeListesi', { ...paymentFilters, sayfa: 1, boyut: 50 }),
        apiGet<Ozet>('GetOzet', { baslangicTarihi: paymentFilters.baslangicTarihi, bitisTarihi: paymentFilters.bitisTarihi }),
      ]);
      setPayments(listFrom(paymentData));
      setPaymentTotals(paymentData.toplamOdeme ?? []);
      setSummary(summaryData);
    } catch (err) {
      setNotice(rawError(err));
      setPayments([]);
      setPaymentTotals([]);
      setSummary(null);
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentFilters]);

  useEffect(() => { void loadPending(); }, [loadPending]);
  useEffect(() => { if (page === 'odemeler') void loadPayments(); }, [page, loadPayments]);
  useEffect(() => { if (firma?.firmaId) void loadFirmData(firma.firmaId); }, [hareketHakTipi, hareketBaslangic, hareketBitis]);

  useEffect(() => {
    if (firmaQuery.trim().length < 2) { setFirmaResults([]); return; }
    const timer = window.setTimeout(async () => {
      setFirmaLoading(true);
      try {
        const data = await apiGet<Paged<FirmaSearchItem>>('GetFirmaAra', { arama: firmaQuery.trim(), sayfa: 1, boyut: 10 });
        setFirmaResults(listFrom(data));
      } catch (err) {
        setNotice(rawError(err));
        setFirmaResults([]);
      } finally {
        setFirmaLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [firmaQuery]);

  const totalPaymentText = useMemo(() => {
    const totals = paymentTotals.length ? paymentTotals : summary?.toplamOdeme ?? [];
    return totals.length ? totals.map(t => `${t.paraBirimi}: ${para(t.tutar, undefined, lang)}`).join(' | ') : '-';
  }, [paymentTotals, summary, lang]);

  const expiringRights = firma?.yakindaSonErecekHaklar ?? firma?.yakindaSonaErecek ?? [];

  const approveDone = async () => {
    await loadPending();
    if (firma?.firmaId) await loadFirmData(firma.firmaId);
    flash(lang === 'tr' ? 'Sipariş onaylandı ve haklar tanımlandı.' : 'Order approved and rights granted.');
  };

  // Hatalar yutulmaz: ReasonModal yakalayıp modal içinde gösterir (modal açık kalır)
  const cancelOrderSubmit = async (reason: string) => {
    if (!cancelOrder) return;
    setActionLoading(true);
    try {
      await apiPost('HavaleSiparisiIptal', { siparisId: cancelOrder.siparisId, iptalNedeni: reason });
      setCancelOrder(null);
      flash(lang === 'tr' ? 'Sipariş iptal edildi.' : 'Order cancelled.');
      await loadPending();
    } finally {
      setActionLoading(false);
    }
  };

  const cancelMovementSubmit = async (reason: string) => {
    if (!cancelMovement || !firma) return;
    const hareketId = cancelMovement.hareketId ?? cancelMovement.id;
    if (hareketId === undefined || hareketId === null) throw new Error(lang === 'tr' ? 'Hareket kimliği bulunamadı.' : "Couldn't find the movement ID.");
    setActionLoading(true);
    try {
      await apiPost('HareketIptal', { hareketId, iptalNedeni: reason });
      setCancelMovement(null);
      flash(lang === 'tr' ? 'Hareket ters kayıtla iptal edildi.' : 'Movement cancelled with a reversing entry.');
      await loadFirmData(firma.firmaId);
    } finally {
      setActionLoading(false);
    }
  };

  const selectFirma = async (item: FirmaSearchItem) => {
    setFirmaQuery('');
    setFirmaResults([]);
    await loadFirmData(item.firmaId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{tr ? 'Kredi yönetimi' : 'Credit management'}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr ? 'Havale/EFT ödemeleri, firma hakları ve finans hareketleri' : 'Bank transfer payments, company rights and financial movements'}</p>
        </div>
        {toast && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"><Msg text={toast} /></div>}
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        {([
          ['bekleyen', tr ? 'Bekleyen siparişler' : 'Pending orders'],
          ['firma', tr ? 'Firma detayı' : 'Company details'],
          ['odemeler', tr ? 'Ödemeler' : 'Payments'],
        ] as [Page, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setPage(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${page === id ? 'border-ocean text-ocean' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"><Msg text={friendlyError(notice, lang)} /></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"><Msg text={error} /></div>}

      {page === 'bekleyen' && (
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
            <h3 className="font-bold text-slate-900 dark:text-slate-100">{tr ? 'Bekleyen siparişler' : 'Pending orders'}</h3>
            <div className="flex w-full sm:w-auto flex-wrap gap-2">
              <input value={pendingSearch} onChange={e => setPendingSearch(e.target.value)} placeholder={tr ? 'Firma adına göre ara' : 'Search by company name'} className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <button onClick={loadPending} className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">{tr ? 'Yenile' : 'Refresh'}</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>{(tr
                  ? ['Firma adı', 'Referans kodu', 'Paket', 'Talep edilen haklar', 'Tutar', 'Para birimi', 'Oluşturma tarihi', 'Son geçerlilik', 'İşlemler']
                  : ['Company', 'Reference code', 'Package', 'Requested rights', 'Amount', 'Currency', 'Created', 'Valid until', 'Actions']).map(h => <th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {pendingLoading ? <SkeletonRows columns={9} /> : pending.map(order => {
                  const rowExpired = expired(order.sonGecerlilikTarihi);
                  return (
                    <tr key={order.siparisId} className={`border-t border-slate-100 dark:border-slate-700 ${rowExpired ? 'bg-red-50/70 dark:bg-red-900/10' : ''}`}>
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">{order.firmaUnvan}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{order.referansKodu}</td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{order.paket}</td>
                      <td className="px-3 py-3"><RightsChips items={order.talepEdilenHaklar} /></td>
                      <td className="px-3 py-3 font-semibold">{para(order.tutar, undefined, lang)}</td>
                      <td className="px-3 py-3">{order.paraBirimi}</td>
                      <td className="px-3 py-3 text-slate-500">{tarih(order.olusturmaTarihi, lang)}</td>
                      <td className="px-3 py-3 text-slate-500">{rowExpired ? '⚠ ' : ''}{tarih(order.sonGecerlilikTarihi, lang)}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => setApproveOrder(order)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">{tr ? 'Onayla' : 'Approve'}</button>
                          <button onClick={() => setCancelOrder(order)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 dark:border-red-800">{tr ? 'İptal et' : 'Cancel'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!pendingLoading && pending.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">{tr ? 'Bekleyen sipariş yok.' : 'No pending orders.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {page === 'firma' && (
        <section className="space-y-4">
          <div className="relative rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">{tr ? 'Firma ara' : 'Search companies'}</label>
            <input value={firmaQuery} onChange={e => setFirmaQuery(e.target.value)} placeholder={tr ? 'En az 2 karakter yazın' : 'Type at least 2 characters'} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            {firmaQuery.length >= 2 && (
              <div className="absolute left-4 right-4 top-[82px] z-20 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {firmaLoading ? <div className="p-4 text-sm text-slate-400">{tr ? 'Aranıyor…' : 'Searching…'}</div> : firmaResults.map(item => (
                  <button key={item.firmaId} onClick={() => void selectFirma(item)} className="block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{item.unvan}</div>
                    <div className="text-xs text-slate-500">{item.email || '-'} · {item.ulke || '-'}</div>
                  </button>
                ))}
                {!firmaLoading && firmaResults.length === 0 && <div className="p-4 text-sm text-slate-400">{tr ? 'Sonuç yok.' : 'No results.'}</div>}
              </div>
            )}
          </div>

          {firma && (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{firma.unvan}</h3>
                  <p className="text-sm text-slate-500">{firma.email || '-'} · {firma.ulke || '-'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPaymentModal(true)} className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">{tr ? 'Ödeme kaydet' : 'Record payment'}</button>
                  <button onClick={() => setRightModal(true)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">{tr ? 'Hak tanımla' : 'Grant rights'}</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <BalanceCard title={hakLabel(1, lang)} value={firma.bakiyeler.cvKredisi} negative={firma.bakiyeler.cvKredisi < 0} />
                <BalanceCard title={hakLabel(2, lang)} value={firma.bakiyeler.ilanHakki} negative={firma.bakiyeler.ilanHakki < 0} />
                <BalanceCard title="Bullseye" value={firma.bakiyeler.bullseyeAktifMi ? (tr ? 'Aktif' : 'Active') : (tr ? 'Pasif' : 'Inactive')} suffix={firma.bakiyeler.bullseyeBitisTarihi ? `${tr ? 'Bitiş' : 'Ends'}: ${tarih(firma.bakiyeler.bullseyeBitisTarihi, lang)}` : undefined} />
              </div>

              {expiringRights.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  {expiringRights.map((r, i) => <span key={i}>{tr
                    ? `${r.miktar} ${hakLabel(r.hakTipi, lang)} hakkının son kullanma tarihi ${tarih(r.gecerlilikBitis, lang)}. `
                    : `${r.miktar} ${hakLabel(r.hakTipi, lang)} expire on ${tarih(r.gecerlilikBitis, lang)}. `}</span>)}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">{tr ? 'Para birimi bazında toplam ödemeler' : 'Total payments by currency'}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{firma.toplamOdenenTutar?.length ? firma.toplamOdenenTutar.map(t => `${t.paraBirimi} ${para(t.tutar, undefined, lang)}`).join(' / ') : '-'}</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100">{tr ? 'Hareket geçmişi' : 'Movement history'}</h4>
                  <div className="flex gap-2">
                    <select value={hareketHakTipi} onChange={e => setHareketHakTipi(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                      <option value="">{tr ? 'Tüm haklar' : 'All rights'}</option>
                      {([1, 2, 3] as HakTipi[]).map(v => <option key={v} value={v}>{hakLabel(v, lang)}</option>)}
                    </select>
                    <input type="date" value={hareketBaslangic} onChange={e => setHareketBaslangic(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                    <input type="date" value={hareketBitis} onChange={e => setHareketBitis(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <tr>{(tr
                        ? ['Hak tipi', 'Miktar', 'Kaynak', 'Kaynak ID', 'Geçerlilik sonu', 'Kim ekledi', 'Tarih', 'Durum', 'İşlem']
                        : ['Right type', 'Quantity', 'Source', 'Source ID', 'Valid until', 'Added by', 'Date', 'Status', 'Action']).map(h => <th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {firmaDataLoading ? <SkeletonRows columns={9} /> : hareketler.map(h => {
                        const cancelled = !!h.iptalEdildiMi;
                        const id = h.hareketId ?? h.id;
                        return (
                          <tr key={id} className={`border-t border-slate-100 dark:border-slate-700 ${cancelled ? 'text-slate-400 line-through' : ''}`}>
                            <td className="px-3 py-3">{hakLabel(h.hakTipi, lang)}</td>
                            <td className={`px-3 py-3 font-bold ${h.miktar >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{h.miktar > 0 ? '+' : ''}{h.miktar}</td>
                            <td className="px-3 py-3">{(tr ? h.kaynakTipAdi : undefined) || kaynakLabel(h.kaynakTipi, lang)}</td>
                            <td className="px-3 py-3 text-slate-500">{h.kaynakId ?? '-'}</td>
                            <td className="px-3 py-3 text-slate-500">{tarih(h.gecerlilikBitis, lang)}</td>
                            <td className="px-3 py-3 text-slate-500">{h.olusturanKullaniciAdi || '-'}</td>
                            <td className="px-3 py-3 text-slate-500">{tarih(h.olusturmaTarihi, lang)}</td>
                            <td className="px-3 py-3">{cancelled ? <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">{tr ? 'İptal' : 'Cancelled'}</span> : <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-700">{tr ? 'Aktif' : 'Active'}</span>}</td>
                            <td className="px-3 py-3">{!cancelled && h.miktar > 0 && <button onClick={() => setCancelMovement(h)} className="text-xs font-semibold text-red-600">{tr ? 'İptal et' : 'Cancel'}</button>}</td>
                          </tr>
                        );
                      })}
                      {!firmaDataLoading && hareketler.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">{tr ? 'Hareket bulunamadı.' : 'No movements found.'}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {page === 'odemeler' && (
        <section className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <BalanceCard title={tr ? 'Toplam ödeme adedi' : 'Total payments'} value={summary?.toplamOdeme?.reduce((s, x) => s + (x.adet || 0), 0) ?? payments.length} />
            <BalanceCard title={tr ? 'Ödeme yapan firma' : 'Paying companies'} value={summary?.odemeYapanFirmaSayisi ?? '-'} />
            <BalanceCard title={tr ? 'Tanımlanan CV kredisi' : 'CV credits granted'} value={summary?.tanimlananHaklar?.cvKredisi ?? '-'} />
            <BalanceCard title={tr ? 'Tanımlanan ilan hakkı' : 'Job posting rights granted'} value={summary?.tanimlananHaklar?.ilanHakki ?? '-'} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="grid grid-cols-[1.5fr_120px_140px_150px_150px_auto] gap-2">
              <input value={paymentFilters.firmaArama} onChange={e => setPaymentFilters(f => ({ ...f, firmaArama: e.target.value }))} placeholder={tr ? 'Firma adı' : 'Company name'} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <select value={paymentFilters.paraBirimi} onChange={e => setPaymentFilters(f => ({ ...f, paraBirimi: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option value="">{tr ? 'Para birimi' : 'Currency'}</option>
                {PARA_BIRIMLERI.map(p => <option key={p}>{p}</option>)}
              </select>
              <select value={paymentFilters.odemeYontemi} onChange={e => setPaymentFilters(f => ({ ...f, odemeYontemi: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option value="">{tr ? 'Yöntem' : 'Method'}</option>
                {([1, 2, 3, 99] as OdemeYontemi[]).map(v => <option key={v} value={v}>{yontemLabel(v, lang)}</option>)}
              </select>
              <input type="date" value={paymentFilters.baslangicTarihi} onChange={e => setPaymentFilters(f => ({ ...f, baslangicTarihi: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <input type="date" value={paymentFilters.bitisTarihi} onChange={e => setPaymentFilters(f => ({ ...f, bitisTarihi: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <button onClick={loadPayments} className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">{tr ? 'Filtrele' : 'Filter'}</button>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">{totalPaymentText}</div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>{(tr
                  ? ['Firma adı', 'Tutar', 'Para birimi', 'Ödeme tarihi', 'Yöntem', 'Banka referans no', 'Gönderen', 'Fatura no', 'Dekont', 'Durum', 'Kim ekledi', 'Eklenme tarihi']
                  : ['Company', 'Amount', 'Currency', 'Payment date', 'Method', 'Bank reference no.', 'Sender', 'Invoice no.', 'Receipt', 'Status', 'Added by', 'Added on']).map(h => <th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {paymentsLoading ? <SkeletonRows columns={12} /> : payments.map(p => {
                  const cancelled = !!p.iptalEdildiMi;
                  return (
                    <tr key={p.odemeId ?? p.id} className={`border-t border-slate-100 dark:border-slate-700 ${cancelled ? 'bg-slate-50 text-slate-400 line-through dark:bg-slate-900' : ''}`}>
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">{p.firmaUnvan}</td>
                      <td className="px-3 py-3 font-bold">{para(p.tutar, undefined, lang)}</td>
                      <td className="px-3 py-3">{p.paraBirimi}</td>
                      <td className="px-3 py-3 text-slate-500">{tarih(p.odemeTarihi, lang)}</td>
                      <td className="px-3 py-3">{yontemLabel(p.odemeYontemi, lang)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{p.bankaReferansNo}</td>
                      <td className="px-3 py-3 text-slate-500">{p.gonderenUnvan || '-'}</td>
                      <td className="px-3 py-3 text-slate-500">{p.faturaNo || '-'}</td>
                      <td className="px-3 py-3">{p.dekontDosyaId ? '📎' : '-'}</td>
                      <td className="px-3 py-3">{cancelled ? (tr ? 'İptal' : 'Cancelled') : p.durum || (tr ? 'Aktif' : 'Active')}</td>
                      <td className="px-3 py-3 text-slate-500">{p.olusturanKullaniciAdi || '-'}</td>
                      <td className="px-3 py-3 text-slate-500">{tarih(p.olusturmaTarihi, lang)}</td>
                    </tr>
                  );
                })}
                {!paymentsLoading && payments.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">{tr ? 'Ödeme bulunamadı.' : 'No payments found.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {approveOrder && <ApproveOrderModal order={approveOrder} onDone={approveDone} onClose={() => setApproveOrder(null)} />}
      {cancelOrder && <ReasonModal title={tr ? 'Siparişi iptal et' : 'Cancel order'} label={tr ? 'İptal nedeni' : 'Cancellation reason'} onSubmit={cancelOrderSubmit} onClose={() => setCancelOrder(null)} loading={actionLoading} />}
      {firma && paymentModal && <PaymentModal firma={firma} onDone={() => loadFirmData(firma.firmaId)} onClose={() => setPaymentModal(false)} />}
      {firma && rightModal && <RightModal firma={firma} onDone={() => loadFirmData(firma.firmaId)} onClose={() => setRightModal(false)} />}
      {cancelMovement && <ReasonModal title={tr ? 'Hareketi iptal et' : 'Cancel movement'} label={tr ? 'İptal nedeni' : 'Cancellation reason'} onSubmit={cancelMovementSubmit} onClose={() => setCancelMovement(null)} loading={actionLoading} />}
    </div>
  );
}

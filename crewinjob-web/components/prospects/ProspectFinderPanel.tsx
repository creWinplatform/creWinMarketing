'use client';

import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import type { ProspectLead, ProspectLeadStatus, ProspectResearchRequest } from '@/lib/prospects';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { onTabKeys } from '@/components/platform/tab-keys';
import { hasUrlView, urlView } from '@/lib/url-view';

type Lang = 'tr' | 'en';
type Mode = 'research' | 'add' | 'pool';
type ResearchStage = 'idle' | 'starting' | 'queued' | 'running' | 'saving' | 'completed' | 'partial' | 'failed' | 'cancelled';

interface ResearchProgress {
  stage: ResearchStage;
  totalFound: number;
  /** Backend'in gerçekten yeni kaydettiği şirketler; bulunanların hepsi zaten listedeyse 0 olur. */
  totalSaved?: number;
  jobId?: string;
  querySummary?: string;
  detail?: string;
}

// Eski sürüm lead'leri (e-posta/isim içeren PII) localStorage'da tutuyordu — artık yalnızca temizlenir.
const LEGACY_LEADS_STORAGE_KEY = 'crewinjob.prospect-leads.v1';
// Yalnızca PII içermeyen UI tercihleri (sekme, filtre, araştırma kriterleri) saklanır; lead'ler backend GetAll'dan gelir.
const PREFS_STORAGE_KEY = 'crewinjob.prospect-ui.v1';
const STATUS_OPTIONS: ProspectLeadStatus[] = ['review', 'approved', 'contacted', 'registered', 'rejected'];
// Backend Upsert'in kabul ettiği şirket tipleri — araştırma varsayılanları ve form bu listeyle hizalı.
const COMPANY_TYPES = ['ship_owner', 'ship_manager', 'crewing_agency', 'other'] as const;
type CompanyType = typeof COMPANY_TYPES[number];
// Serbest metin / AI çıktısı eş anlamlıları → backend tipi (eskiden hepsi 'other'a düşüyordu)
const COMPANY_TYPE_ALIASES: Record<string, CompanyType> = {
  ship_owner: 'ship_owner', shipowner: 'ship_owner', owner: 'ship_owner', armatör: 'ship_owner',
  ship_manager: 'ship_manager', ship_management: 'ship_manager', ship_operator: 'ship_manager', operator: 'ship_manager',
  technical_manager: 'ship_manager', technical_management: 'ship_manager', fleet_manager: 'ship_manager',
  crewing_agency: 'crewing_agency', crew_management: 'crewing_agency', crew_manager: 'crewing_agency', crewing: 'crewing_agency',
  manning_agency: 'crewing_agency', manning: 'crewing_agency', crew_agency: 'crewing_agency', recruitment_agency: 'crewing_agency',
  other: 'other',
};

type ProspectApiResponse = Record<string, unknown>;

async function prospectRequest(endpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<ProspectApiResponse> {
  const [path, query] = endpoint.split('?');
  const res = await fetch(`/api/prospects/${path}${query ? `?${query}` : ''}`, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
  });
  const data = await res.json().catch(() => ({})) as ProspectApiResponse;
  if (!res.ok) throw new Error(String(data.error || `Prospect servisi HTTP ${res.status}`));
  return data;
}

function responseRoot(data: ProspectApiResponse): ProspectApiResponse {
  return data.result && typeof data.result === 'object' ? data.result as ProspectApiResponse : data;
}

function responseItems(data: ProspectApiResponse): Array<Record<string, unknown>> {
  // Bazı servisler (ör. VerifyEmails) sonucu düz bir dizi olarak döndürür.
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (Array.isArray((data as { result?: unknown }).result)) return (data as { result: Array<Record<string, unknown>> }).result;
  const root = responseRoot(data);
  const items = root.items || root.prospects || root.leads || root.results || root.companies || root.data || root.research;
  return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
}

function optionalString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function optionalStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map(item => String(item).trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return optionalStringList(parsed);
  } catch { /* Some backend versions return a comma-delimited string. */ }
  const items = value.split(/[,;|]/).map(item => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function researchErrorMessage(value: unknown, lang: Lang): string {
  const raw = String(value || '').trim();
  if (/HTTP\s*500|Prospect servisi HTTP 500/i.test(raw)) {
    return lang === 'tr'
      ? 'Backend araştırma servisi geçici bir sunucu hatası verdi. Durum birkaç kez yeniden kontrol edildi ancak yanıt alınamadı.'
      : 'The backend research service returned a temporary server error. Status was retried several times without a successful response.';
  }
  return raw || (lang === 'tr'
    ? 'Araştırmanın neden tamamlanamadığı backend tarafından bildirilmedi.'
    : "The backend didn't report why the research couldn't be completed.");
}

// Backend sözleşmesi (27 Ekim 2026): GET MarketingProspect/GetResearchStatus?jobId=
function researchStatusRequest(jobId: string | number): Promise<ProspectApiResponse> {
  return prospectRequest(`GetResearchStatus?jobId=${encodeURIComponent(String(jobId))}`, 'GET');
}

function backendLead(item: Record<string, unknown>): ProspectLead | null {
  const email = String(item.email || '').trim().toLowerCase();
  const companyName = String(item.companyName || item.name || '').trim();
  if (!companyName || !/^\S+@\S+\.\S+$/.test(email)) return null;
  const status = String(item.status || 'review') as ProspectLeadStatus;
  const source = String(item.source || 'manual') as ProspectLead['source'];
  const consentStatus = String(item.consentStatus || 'unknown') as ProspectLead['consentStatus'];
  const now = new Date().toISOString();
  return {
    id: String(item.id || item.prospectId || `prospect_${email}`), companyName, email,
    country: item.country ? String(item.country) : undefined,
    companyType: item.companyType ? String(item.companyType) : undefined,
    website: item.website ? String(item.website) : undefined,
    sourceUrl: item.sourceUrl ? String(item.sourceUrl) : undefined,
    source: ['ai_research', 'csv', 'json_import', 'meeting', 'manual'].includes(source) ? source : 'manual',
    status: ['review', 'approved', 'contacted', 'registered', 'rejected'].includes(status) ? status : 'review',
    consentStatus: ['unknown', 'confirmed', 'restricted'].includes(consentStatus) ? consentStatus : 'unknown',
    fitScore: Number(item.fitScore || 0) || undefined, intentScore: Number(item.intentScore || 0) || undefined,
    selectionReason: optionalString(item.selectionReason || item.fitReason || item.scoreReason || item.rationale),
    intentReason: optionalString(item.intentReason || item.signalReason),
    researchSignals: optionalStringList(item.researchSignals || item.matchedSignals || item.signals),
    sourceTitle: optionalString(item.sourceTitle || item.evidenceTitle),
    contactName: item.contactName ? String(item.contactName) : undefined, contactRole: item.contactRole ? String(item.contactRole) : undefined,
    notes: item.notes ? String(item.notes) : undefined, lastCheckedAt: item.lastCheckedAt ? String(item.lastCheckedAt) : undefined,
    companyId: item.companyId ? String(item.companyId) : undefined, isRegisteredCompany: Boolean(item.isRegisteredCompany || item.matched),
    isSuppressed: Boolean(item.isSuppressed), suppressionReason: item.suppressionReason ? String(item.suppressionReason) : undefined,
    ...emailCheck(item),
    emailVerificationReason: item.emailVerificationReason ? String(item.emailVerificationReason) : undefined, emailCheckedAt: item.emailCheckedAt ? String(item.emailCheckedAt) : undefined,
    createdAt: String(item.createdAt || item.creationTime || now), updatedAt: String(item.updatedAt || item.lastCheckedAt || now),
  };
}

// Backend e-posta doğrulaması (27 Ekim 2026 sözleşmesi). VerifyEmails → EmailVerificationResultDto: isDomainValid gerçek MX
// sonucudur (rol adreslerinde de). status: valid (kişisel adres) · role_based (rol adresi, alan adı e-posta alıyor) ·
// unverifiable (alan adı/MX yok veya DNS sonuçlanmadı) · invalid (biçim) · disposable. Lead kaydında aynı değer
// deliverabilityStatus'tadır (valid → verified); orada "unknown" alan adı e-posta alan kişisel adres demektir.
const UNDELIVERABLE = new Set(['invalid', 'disposable', 'undeliverable', 'bounced']);
function emailCheck(item: Record<string, unknown>): Pick<ProspectLead, 'emailValid' | 'emailDeliverable'> {
  const record = 'companyName' in item, status = String((record ? item.deliverabilityStatus : item.status) || '').toLowerCase();
  if (item.isSyntaxValid === false || item.isDisposable === true || UNDELIVERABLE.has(status)) return { emailValid: false, emailDeliverable: false };
  if (item.isDomainValid === false || status === 'unverifiable') return { emailValid: true, emailDeliverable: false };
  // VerifyEmails 'valid' sonucu lead kaydında 'verified' olarak saklanıyor.
  if (item.isDomainValid === true || status === 'valid' || status === 'verified' || status === 'role_based') return { emailValid: true, emailDeliverable: true };
  return { emailValid: item.emailValid === undefined ? undefined : Boolean(item.emailValid), emailDeliverable: item.emailDeliverable === undefined ? undefined : Boolean(item.emailDeliverable) };
}
// Backend, Gemini'nin bulduğu alan adı arama kaynaklarında geçmiyorsa skoru düşürüp gerekçeye bu notu ekliyor.
const UNVERIFIED_DOMAIN_NOTE = 'Alan adı arama kaynaklarında doğrulanmadı';
const domainUnverified = (item: ProspectLead) => Boolean(item.selectionReason?.includes(UNVERIFIED_DOMAIN_NOTE));

function backendUpsertPayload(item: ProspectLead): Record<string, unknown> {
  return {
    ...(item.id && !item.id.startsWith('prospect_') ? { id: item.id } : {}),
    companyName: item.companyName,
    email: item.email,
    country: item.country,
    companyType: normalizeCompanyType(item.companyType),
    website: item.website,
    contactName: item.contactName,
    contactRole: item.contactRole,
    source: item.source === 'meeting' ? 'manual' : item.source,
    notes: item.notes,
  };
}

function splitList(value: string): string[] {
  return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
}

function csvCells(line: string, separator: string): string[] {
  return line.split(separator).map(cell => cell.trim().replace(/^"|"$/g, ''));
}

function parseCsv(value: string): ProspectLead[] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const separator = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const normalize = (item: string) => item.toLocaleLowerCase('tr-TR').replace(/[\s_-]+/g, '');
  const headers = csvCells(lines[0], separator).map(normalize);
  const hasHeader = headers.some(item => ['email', 'emailaddress', 'eposta', 'companyname', 'firmadi'].includes(item));
  const data = hasHeader ? lines.slice(1) : lines;
  const index = (names: string[], fallback: number) => {
    const found = headers.findIndex(item => names.includes(item));
    return found >= 0 ? found : fallback;
  };
  const emailIndex = hasHeader ? index(['email', 'emailaddress', 'eposta', 'mail'], 1) : 1;
  const nameIndex = hasHeader ? index(['companyname', 'firmadi', 'company', 'firma'], 0) : 0;
  const countryIndex = hasHeader ? index(['country', 'ulke', 'countrycode'], 2) : 2;
  const typeIndex = hasHeader ? index(['companytype', 'firmatipi', 'type', 'tip'], 3) : 3;
  const websiteIndex = hasHeader ? index(['website', 'websitesi', 'url', 'site'], 4) : 4;
  const now = new Date().toISOString();
  const rows: ProspectLead[] = [];
  for (const line of data) {
    const cells = csvCells(line, separator);
    const email = (cells[emailIndex] || '').toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) continue;
    rows.push({
      id: `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      companyName: cells[nameIndex] || email.split('@')[1],
      email,
      country: cells[countryIndex] || undefined,
      companyType: cells[typeIndex] || undefined,
      website: cells[websiteIndex] || undefined,
      source: 'csv',
      status: 'review',
      consentStatus: 'unknown',
      createdAt: now,
      updatedAt: now,
    });
  }
  return Array.from(new Map(rows.map(row => [row.email, row])).values());
}

function newLead(input: Omit<ProspectLead, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'consentStatus'>): ProspectLead {
  const now = new Date().toISOString();
  return { ...input, id: `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'review', consentStatus: 'unknown', createdAt: now, updatedAt: now };
}

function label(value: string, lang: Lang): string {
  const labels: Record<string, [string, string]> = {
    new: ['Yeni', 'New'], review: ['İncelenecek', 'Review'], approved: ['Onaylandı', 'Approved'], contacted: ['İletişime geçildi', 'Contacted'],
    registered: ['Kayıt oldu', 'Registered'], job_posted: ['İlan verdi', 'Job posted'], cv_unlocked: ['CV unlock yaptı', 'CV unlocked'], rejected: ['Reddedildi', 'Rejected'],
    unknown: ['İzin doğrulanmalı', 'Consent needs review'], confirmed: ['İzin doğrulandı', 'Consent confirmed'], restricted: ['Gönderim engelli', 'Outreach restricted'],
    ai_research: ['AI araştırması', 'AI research'], csv: ['CSV', 'CSV'], json_import: ['JSON içe aktarma', 'JSON import'], meeting: ['Fiziksel görüşme', 'Meeting'], manual: ['Manuel', 'Manual'],
  };
  return labels[value]?.[lang === 'tr' ? 0 : 1] || value;
}

function badge(status: ProspectLeadStatus): string {
  if (status === 'approved' || status === 'registered' || status === 'job_posted' || status === 'cv_unlocked') return 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300';
  if (status === 'rejected') return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
  if (status === 'contacted') return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
}

/** Serbest metni ("Ship operator", "crew-management", "ship_owner"…) backend tipine çevirir. */
function normalizeCompanyType(value?: string): CompanyType {
  const key = String(value || '').trim().toLocaleLowerCase('tr-TR').replace(/[\s-]+/g, '_');
  if (!key) return 'other';
  if (COMPANY_TYPE_ALIASES[key]) return COMPANY_TYPE_ALIASES[key];
  // Çok kelimeli serbest metin: anahtar kelimeye göre en yakın tip
  if (/crew|manning|recruit/.test(key)) return 'crewing_agency';
  if (/manag|operat/.test(key)) return 'ship_manager';
  if (/owner|armat/.test(key)) return 'ship_owner';
  return 'other';
}

function companyTypeKey(value?: string): CompanyType {
  return normalizeCompanyType(value);
}

function companyTypeLabel(value: string | undefined, lang: Lang): string {
  const labels: Record<CompanyType, [string, string]> = {
    ship_owner: ['Armatör', 'Ship owner'],
    ship_manager: ['Gemi işletmecisi / yönetim şirketi', 'Ship operator / manager'],
    crewing_agency: ['Gemi adamı acentesi / crew management', 'Crewing agency / crew management'],
    other: ['Diğer maritime işletme', 'Other maritime business'],
  };
  return labels[companyTypeKey(value)][lang === 'tr' ? 0 : 1];
}

/** Araştırma isteği için okunabilir tip metni (backend tipleriyle aynı küme). */
function companyTypeSearchText(value: CompanyType): string {
  return value === 'other' ? 'maritime business' : value.replace(/_/g, ' ');
}

function safeExternalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

function targetRoles(item: ProspectLead, lang: Lang): string[] {
  if (item.contactName || item.contactRole) {
    return [`${item.contactName || (lang === 'tr' ? 'İsim doğrulanmalı' : 'Name needs verification')}${item.contactRole ? ` · ${item.contactRole}` : ''}`];
  }
  const key = companyTypeKey(item.companyType);
  if (key === 'ship_owner' || key === 'ship_manager') {
    return lang === 'tr'
      ? ['Crewing Manager / Marine Personnel Manager', 'Fleet Manager', 'HR veya Operations Director']
      : ['Crewing Manager / Marine Personnel Manager', 'Fleet Manager', 'HR or Operations Director'];
  }
  if (key === 'crewing_agency') {
    return lang === 'tr'
      ? ['Crewing veya Recruitment Manager', 'Managing Director', 'Business Development Manager']
      : ['Crewing or Recruitment Manager', 'Managing Director', 'Business Development Manager'];
  }
  return lang === 'tr'
    ? ['Operations veya HR yöneticisi', 'Business Development Manager', 'Şirket sahibi / Managing Director']
    : ['Operations or HR manager', 'Business Development Manager', 'Company owner / Managing Director'];
}

function outreachPitch(item: ProspectLead, lang: Lang): string {
  const key = companyTypeKey(item.companyType);
  if (key === 'crewing_agency') {
    return lang === 'tr'
      ? 'Ücretsiz ilan yayınlama ile aday akışını başlatın; Bullseye teknik filtreleriyle kısa listeyi hızlandırın ve yalnızca ilgilendiğiniz CV’leri görüntüleyin.'
      : 'Start candidate flow with free job posting, shorten screening with Bullseye technical filters, and unlock only the CVs you want to review.';
  }
  if (key === 'ship_owner' || key === 'ship_manager') {
    return lang === 'tr'
      ? 'Ücretsiz ilanla açık pozisyonları yayınlayın; başvuranları veya Bullseye eşleşmelerini filtreleyin ve yalnızca uygun CV’leri açmak için ödeme yapın.'
      : 'Publish open roles for free, filter applicants or Bullseye matches, and pay only to unlock the relevant CVs.';
  }
  return lang === 'tr'
    ? 'Crewinjob’u ücretsiz ilan ve hedefli aday bulma ile düşük riskli bir pilot olarak sunun; değer oluştuğunda CV unlock modeli devreye girsin.'
    : 'Position Crewinjob as a low-risk pilot with free job posting and targeted candidate discovery, followed by pay-per-CV unlock when value is proven.';
}

function ProspectDecisionPanel({ item, lang }: { item: ProspectLead; lang: Lang }) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const website = safeExternalUrl(item.website);
  const sourceUrl = safeExternalUrl(item.sourceUrl);
  const roles = targetRoles(item, lang);
  const reasons: string[] = [];
  if (item.selectionReason) reasons.push(item.selectionReason);
  if (item.fitScore !== undefined) reasons.push(t(`Crewinjob hedef müşteri uyumu ${item.fitScore}/100 olarak puanlandı.`, `Crewinjob customer fit was scored ${item.fitScore}/100.`));
  if (item.intentScore !== undefined) reasons.push(item.intentReason || t(`Güncel satın alma/işe alım niyeti ${item.intentScore}/100 olarak değerlendirildi.`, `Current buying or hiring intent was scored ${item.intentScore}/100.`));
  if (item.researchSignals?.length) reasons.push(t(`Eşleşen sinyaller: ${item.researchSignals.slice(0, 4).join(', ')}.`, `Matched signals: ${item.researchSignals.slice(0, 4).join(', ')}.`));
  if (!reasons.length) reasons.push(t(`${companyTypeLabel(item.companyType, lang)} ve ${item.country || 'hedef pazar'} kriterleriyle araştırma sonucuna girdi. Seçim gerekçesi backend’den henüz gelmediği için kaynak doğrulanmalı.`, `It matched the ${companyTypeLabel(item.companyType, lang)} and ${item.country || 'target market'} research criteria. The source should be reviewed because the backend did not provide a selection rationale.`));

  const checks = [
    { ok: Boolean(sourceUrl), text: t('Kamuya açık kaynak', 'Public source') },
    { ok: Boolean(website), text: t('Şirket web sitesi', 'Company website') },
    { ok: item.emailDomain === 'mx', text: item.emailDomain === 'mx' ? t('Alan adı e-posta alıyor', 'Domain receives email') : item.emailDomain === 'no_mx' || item.emailDomain === 'not_found' ? t('Alan adı e-posta almıyor', 'Domain receives no email') : t('Alan adı kontrol edilemedi', 'Domain not checked') },
    { ok: item.emailDeliverable === true, text: item.emailValid === false ? t('E-posta geçersiz', 'Email invalid') : item.emailDeliverable === false ? t('E-posta alamıyor', 'Cannot receive email') : item.emailDeliverable === true ? t('E-posta doğrulandı', 'Email verified') : t('E-posta doğrulanmadı', 'Email not verified') },
    { ok: !domainUnverified(item), text: domainUnverified(item) ? t('Alan adı kaynaklarda doğrulanmadı', 'Domain not confirmed in sources') : t('Alan adı kaynaklarda geçiyor', 'Domain found in sources') },
    { ok: !item.isSuppressed && item.consentStatus !== 'restricted', text: t('Gönderim engeli yok', 'Not suppressed') },
    { ok: Boolean(item.contactName || item.contactRole), text: t('Muhatap doğrulandı', 'Contact verified') },
  ];
  const readyCount = checks.filter(check => check.ok).length, readyRatio = readyCount / checks.length;
  const canDraft = !item.isSuppressed && item.consentStatus !== 'restricted' && item.emailValid !== false && item.emailDeliverable !== false && item.emailDomain !== 'no_mx' && item.emailDomain !== 'not_found';
  const verificationNote = item.emailVerificationReason;
  const subject = `Crewinjob partnership for ${item.companyName}`;
  const greeting = item.contactName ? `Hello ${item.contactName},` : 'Hello Crewing Team,';
  const body = `${greeting}\n\nCrewinjob helps maritime companies publish jobs for free, filter relevant seafarers, and pay only when they choose to unlock a CV. I would be glad to show you a short pilot tailored to ${item.companyName}.\n\nWould a 15-minute introduction next week be convenient?\n\nBest regards`;
  const mailto = `mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return <div className="bg-slate-50/80 p-4 dark:bg-slate-900/50 md:p-5">
    <div className="grid gap-4 xl:grid-cols-3">
      <section className="border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-ocean">{t('Neden bu firma?', 'Why this company?')}</p>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{reasons.map((reason, index) => <li key={index} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ocean" /><span>{reason}</span></li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-2">{item.sourceTitle && <span className="bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{item.sourceTitle}</span>}{item.lastCheckedAt && <span className="bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t('Kontrol', 'Checked')}: {new Date(item.lastCheckedAt).toLocaleDateString(localeTag(lang))}</span>}</div>
      </section>

      <section className="border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-ocean">{t('Kiminle iletişime geçilmeli?', 'Who should be contacted?')}</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{item.contactName || item.contactRole ? t('Araştırmada bulunan muhatap', 'Contact found in research') : t('Şirket tipine göre önerilen karar vericiler', 'Suggested decision-makers for this company type')}</p>
        <ol className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">{roles.map((role, index) => <li key={role} className="flex gap-2"><span className="font-semibold text-slate-600">{index + 1}.</span><span>{role}</span></li>)}</ol>
        {!item.contactName && !item.contactRole && <p className="mt-3 border-l-2 border-amber-400 pl-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{t('İsim ve rol kamuya açık şirket sayfasından doğrulanmadan kişisel mesaj gönderilmemeli.', 'Do not send a personal message until the name and role are verified on a public company source.')}</p>}
      </section>

      <section className="border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-ocean">{t('Nasıl iletişime geçilmeli?', 'How should outreach work?')}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{outreachPitch(item, lang)}</p>
        <ol className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <li>1. {t('Kaynağı ve şirket web sitesini doğrula.', 'Verify the source and company website.')}</li>
          <li>2. {t('Karar verici rolünü ve kurumsal e-postayı doğrula.', 'Verify the decision-maker and business email.')}</li>
          <li>3. {t('Kısa, kişiselleştirilmiş e-posta ile ücretsiz ilan/pilot öner.', 'Send a short personalized email offering a free listing or pilot.')}</li>
          <li>4. {t('Yanıt yoksa 3-4 iş günü sonra tek takip mesajı gönder.', 'If there is no reply, send one follow-up after 3-4 business days.')}</li>
        </ol>
      </section>
    </div>

    <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-700 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('İletişime hazır olma', 'Outreach readiness')}</p><span className="text-xs text-slate-500">{readyCount}/{checks.length}</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full ${readyRatio >= 0.8 ? 'bg-green-500' : readyRatio >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.round(readyRatio * 100)}%` }} /></div>
        <div className="mt-2 flex flex-wrap gap-1.5">{checks.map(check => <span key={check.text} className={`px-2 py-1 text-[11px] ${check.ok ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>{check.ok ? t('Hazır', 'Ready') : t('Eksik', 'Missing')}: {check.text}</span>)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">{t('Kaynağı incele', 'Review source')}</a>}
        {website && <a href={website} target="_blank" rel="noreferrer" className="border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">{t('Web sitesini aç', 'Open website')}</a>}
        <a href={canDraft ? mailto : undefined} aria-disabled={!canDraft} className={`px-3 py-2 text-xs font-semibold ${canDraft ? 'bg-ocean text-white' : 'pointer-events-none bg-slate-200 text-slate-600 dark:bg-slate-700'}`}>{t('E-posta taslağını aç', 'Open email draft')}</a>
      </div>
    </div>
    {verificationNote && <p className="mt-3 text-[11px] text-slate-600 dark:text-slate-300">{t('E-posta doğrulaması', 'Email verification')}: <Msg text={verificationNote} /></p>}
    <p className="mt-3 text-[11px] text-slate-600">{t('Skorlar ve öneriler karar desteğidir; kaynak, muhatap ve iletişim izni insan tarafından doğrulanmalıdır.', 'Scores and recommendations support decisions; a person must verify the source, contact and outreach basis.')}</p>
  </div>;
}

function ResearchProgressPanel({ progress, lang }: { progress: ResearchProgress; lang: Lang }) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const stages = [
    { id: 'starting', label: t('İstek hazırlanıyor', 'Preparing request') },
    { id: 'queued', label: t('Kuyruğa alındı', 'Queued') },
    { id: 'running', label: t('AI araştırıyor', 'AI is researching') },
    { id: 'saving', label: t('Lead’ler kaydediliyor', 'Saving leads') },
    { id: 'completed', label: t('Tamamlandı', 'Completed') },
  ];
  const stageIndex: Record<ResearchStage, number> = { idle: -1, starting: 0, queued: 1, running: 2, saving: 3, completed: 4, partial: 4, failed: 2, cancelled: 2 };
  const current = stageIndex[progress.stage];
  const unsuccessful = progress.stage === 'failed' || progress.stage === 'cancelled';
  const partial = progress.stage === 'partial';
  const statusText = progress.stage === 'failed' ? t('Araştırma başarısız oldu', 'Research failed')
    : progress.stage === 'cancelled' ? t('Araştırma iptal edildi', 'Research cancelled')
      : partial ? t('Araştırma kısmen tamamlandı', 'Research partially completed')
        : stages[Math.max(0, current)]?.label;

  return <div aria-live="polite" className={`mx-5 mt-4 border p-4 ${unsuccessful ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/20' : partial ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20' : 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900 dark:bg-cyan-950/20'}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{statusText}</p>
        {progress.querySummary && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{progress.querySummary}</p>}
        {progress.detail && <p className={`mt-1 text-xs ${unsuccessful ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}><Msg text={progress.detail} /></p>}
        {progress.jobId && <p className="mt-1 text-[11px] text-slate-600">{t('İşlem kimliği', 'Job ID')}: {progress.jobId}</p>}
      </div>
      <div className="shrink-0 text-right"><span className="block text-lg font-semibold text-slate-800 dark:text-slate-100">{progress.totalFound}</span><span className="text-[11px] text-slate-500 dark:text-slate-400">{t('şirket bulundu', 'companies found')}</span>
        {progress.totalSaved != null && <span className="mt-1 block text-[11px] text-slate-600 dark:text-slate-300">{t(`${progress.totalSaved} yeni kaydedildi`, `${progress.totalSaved} new saved`)}</span>}</div>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
      {stages.map((stage, index) => {
        const reached = index <= current;
        const active = index === current;
        return <div key={stage.id} className="flex min-w-0 items-center gap-2 sm:block">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${reached ? unsuccessful && active ? 'border-red-600 bg-red-600 text-white' : 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-300 text-slate-600 dark:border-slate-600'}`}>{reached && !active ? '✓' : index + 1}</span>
          <span className={`mt-0 block min-w-0 text-xs sm:mt-2 ${active ? 'font-semibold text-slate-800 dark:text-slate-100' : reached ? 'text-slate-600 dark:text-slate-300' : 'text-slate-600'}`}>{stage.label}</span>
        </div>;
      })}
    </div>
  </div>;
}

export default function ProspectFinderPanel({ lang, onUseInCampaign }: { lang: Lang; onUseInCampaign: (emails: string[]) => void }) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const fid = useId();
  const [mode, setMode] = useState<Mode>(() => urlView<Mode>(['research', 'add', 'pool'], 'research', 'section'));
  const [leads, setLeads] = useState<ProspectLead[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [research, setResearch] = useState<ProspectResearchRequest>({ companyTypes: (['ship_owner', 'ship_manager', 'crewing_agency'] as CompanyType[]).map(companyTypeSearchText), countries: ['TR', 'GR', 'NL', 'SG'], signals: ['active maritime hiring'], maxResults: 25, language: lang });
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [website, setWebsite] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [providerStatus, setProviderStatus] = useState('');
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [operationMessage, setOperationMessage] = useState('');
  const [researchProgress, setResearchProgress] = useState<ResearchProgress>({ stage: 'idle', totalFound: 0 });

  useEffect(() => {
    try {
      // Eski sürümün sakladığı lead PII'sini temizle; yalnızca UI tercihlerini geri yükle
      localStorage.removeItem(LEGACY_LEADS_STORAGE_KEY);
      const prefs = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || '{}') as Record<string, unknown>;
      // A link that names the section (?section=pool) wins over the remembered one.
      if (!hasUrlView('section') && (prefs.mode === 'research' || prefs.mode === 'add' || prefs.mode === 'pool')) setMode(prefs.mode);
      if (typeof prefs.statusFilter === 'string' && (prefs.statusFilter === 'all' || (STATUS_OPTIONS as string[]).includes(prefs.statusFilter))) setStatusFilter(prefs.statusFilter);
      const saved = prefs.research as Partial<ProspectResearchRequest> | undefined;
      if (saved && typeof saved === 'object') {
        const strList = (value: unknown) => Array.isArray(value) && value.length ? value.map(String).filter(Boolean).slice(0, 20) : undefined;
        setResearch(current => ({
          ...current,
          companyTypes: strList(saved.companyTypes) || current.companyTypes,
          countries: strList(saved.countries) || current.countries,
          signals: strList(saved.signals) || current.signals,
          maxResults: Number.isFinite(Number(saved.maxResults)) ? Math.min(100, Math.max(5, Number(saved.maxResults))) : current.maxResults,
        }));
      }
    } catch { /* local browser storage may be unavailable */ }
    setHydrated(true);
    void Promise.all([
      prospectRequest('GetCapabilities', 'GET'),
      prospectRequest('GetProviderStatus', 'GET'),
      prospectRequest('GetResearchSources', 'GET'),
      prospectRequest('GetAll?page=1&pageSize=100', 'GET'),
    ]).then(([capabilities, provider, sources, remote]) => {
      const capabilityRoot = responseRoot(capabilities);
      setBackendReady(capabilityRoot.researchEnabled !== false && capabilityRoot.campaignDispatchEnabled !== false);
      setFeatureDisabled(capabilityRoot.researchEnabled === false);
      const providerRoot = responseRoot(provider);
      setProviderStatus(providerRoot.provider ? String(providerRoot.provider) : t('Sağlayıcı hazır', 'Provider ready'));
      setSourceCount(responseItems(sources).length || Number(responseRoot(sources).totalCount || 0) || 0);
      const remoteLeads = responseItems(remote).map(backendLead).filter((item): item is ProspectLead => Boolean(item));
      if (remoteLeads.length) setLeads(current => { const merged = new Map(current.map(item => [item.email.toLowerCase(), item])); remoteLeads.forEach(item => merged.set(item.email.toLowerCase(), item)); return Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); });
      void checkDomains(remoteLeads);
    }).catch(() => setBackendReady(false));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({
        mode, statusFilter,
        research: { companyTypes: research.companyTypes, countries: research.countries, signals: research.signals, maxResults: research.maxResults },
      }));
    } catch { /* local browser storage may be unavailable */ }
  }, [hydrated, mode, statusFilter, research]);

  const approvedLeads = useMemo(() => leads.filter(item => item.status === 'approved'), [leads]);
  const filteredLeads = useMemo(() => leads.filter(item => {
    const query = search.trim().toLocaleLowerCase('tr-TR');
    const matchesSearch = !query || [item.companyName, item.email, item.country, item.companyType].some(value => value?.toLocaleLowerCase('tr-TR').includes(query));
    return matchesSearch && (statusFilter === 'all' || item.status === statusFilter);
  }), [leads, search, statusFilter]);

  const mergeLeads = (incoming: ProspectLead[]) => {
    setLeads(current => {
      const byEmail = new Map(current.map(item => [item.email.toLowerCase(), item]));
      incoming.forEach(item => { if (!byEmail.has(item.email.toLowerCase())) byEmail.set(item.email.toLowerCase(), item); });
      return Array.from(byEmail.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  };

  // Alan adının e-posta sunucusu (MX) var mı? Sonuç yalnız bu ekranda tutulur; hiçbir adrese bir şey gönderilmez.
  const checkDomains = async (items: ProspectLead[]) => {
    const emails = Array.from(new Set(items.map(item => item.email.toLowerCase()))).slice(0, 200);
    if (!emails.length) return;
    try {
      const response = await fetch('/api/prospects/domain-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails }), cache: 'no-store' });
      if (!response.ok) return;
      const { results } = await response.json() as { results: Record<string, { status: ProspectLead['emailDomain'] }> };
      setLeads(current => current.map(item => results[item.email.toLowerCase()] ? { ...item, emailDomain: results[item.email.toLowerCase()].status } : item));
    } catch { /* kontrol yapılamazsa durum "kontrol edilemedi" kalır */ }
  };

  const reloadRemoteLeads = async (): Promise<number> => {
    const remote = await prospectRequest('GetAll?page=1&pageSize=100', 'GET');
    const remoteLeads = responseItems(remote).map(backendLead).filter((item): item is ProspectLead => Boolean(item));
    if (remoteLeads.length) setLeads(current => { const merged = new Map(current.map(item => [item.email.toLowerCase(), item])); remoteLeads.forEach(item => merged.set(item.email.toLowerCase(), item)); return Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); });
    void checkDomains(remoteLeads);
    return remoteLeads.length;
  };

  const pollResearchJob = async (jobId: string | number): Promise<Record<string, unknown> | null> => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    let consecutiveFailures = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt > 0) await sleep(3000);
      let job: Record<string, unknown>;
      try {
        job = responseRoot(await researchStatusRequest(jobId));
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const message = researchErrorMessage(error instanceof Error ? error.message : error, lang);
        setResearchProgress(current => ({
          ...current,
          stage: 'running',
          detail: t(`Durum bilgisi alınamadı, yeniden deneniyor (${consecutiveFailures}/4).`, `Couldn't get the status; retrying (${consecutiveFailures}/4).`),
        }));
        if (consecutiveFailures >= 4) throw new Error(message);
        continue;
      }
      const status = String(job.status || '').toLowerCase();
      setResearchProgress(current => ({
        ...current,
        stage: (['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'].includes(status) ? status : 'running') as ResearchStage,
        totalFound: Number(job.totalFound || 0),
        totalSaved: job.totalSaved == null ? current.totalSaved : Number(job.totalSaved || 0),
        querySummary: job.querySummary ? String(job.querySummary) : current.querySummary,
        detail: undefined,
      }));
      if (status !== 'queued' && status !== 'running') return job;
      setOperationMessage(t(`AI araştırması ${status === 'queued' ? 'kuyrukta' : 'sürüyor'}… (${job.totalFound ?? 0} bulundu)`, `AI research ${status === 'queued' ? 'is queued' : 'is running'}… (${job.totalFound ?? 0} found)`));
    }
    return null; // zaman aşımı
  };

  const runResearch = async () => {
    setBusy(true); setError(''); setFeatureDisabled(false); setOperationMessage('');
    setResearchProgress({ stage: 'starting', totalFound: 0 });
    try {
      const signals = splitList(research.signals.join('\n'));
      const companyTypes = splitList(research.companyTypes.join('\n'));
      const countries = splitList(research.countries.join('\n'));
      const data = await prospectRequest('StartResearch', 'POST', {
        keywords: signals.join(', '),
        companyTypes,
        countries,
        signals,
        maxResults: research.maxResults,
        language: research.language,
      });
      const startRoot = responseRoot(data);
      const jobId = (startRoot.jobId ?? startRoot.id) as string | number | undefined;
      const initialStatus = String(startRoot.status || 'queued').toLowerCase();
      setResearchProgress({
        stage: (initialStatus === 'running' ? 'running' : 'queued'),
        totalFound: Number(startRoot.totalFound || 0),
        jobId: jobId == null ? undefined : String(jobId),
        querySummary: startRoot.querySummary ? String(startRoot.querySummary) : undefined,
      });
      let items = responseItems(data);

      // StartResearch asenkron job döndürüyor (jobId + status) — tamamlanana kadar poll et
      if (!items.length && jobId != null && jobId !== '') {
        setOperationMessage(t('AI araştırması kuyruğa alındı, sonuçlar bekleniyor…', 'AI research is queued, waiting for results…'));
        const job = await pollResearchJob(jobId);
        if (!job) {
          setResearchProgress(current => ({
            ...current,
            stage: 'running',
            detail: t('Araştırma backend’de devam ediyor. Lead havuzunu biraz sonra yenileyebilirsiniz.', 'Research is still running in the backend. You can refresh the lead pool shortly.'),
          }));
          setMode('pool');
          return;
        }
        const jobStatus = String(job.status || '').toLowerCase();
        const reason = optionalString(job.errorMessage);
        if (!['completed', 'partial'].includes(jobStatus)) {
          const detail = researchErrorMessage(job.errorMessage || job.errorDetails || job.message, lang);
          const stage = jobStatus === 'cancelled' ? 'cancelled' : 'failed';
          setResearchProgress(current => ({ ...current, stage, detail }));
          return;
        }
        const totalFound = Number(job.totalFound || 0), totalSaved = Number(job.totalSaved || 0);
        const summary = job.querySummary ? String(job.querySummary) : undefined;
        if (totalSaved > 0) {
          setResearchProgress(current => ({ ...current, stage: 'saving', totalFound, totalSaved, querySummary: summary || current.querySummary }));
          const count = await reloadRemoteLeads();
          setOperationMessage(t(`Araştırma ${jobStatus === 'partial' ? 'kısmen ' : ''}tamamlandı. ${totalFound} şirket bulundu, ${totalSaved} yeni şirket kaydedildi; havuzda ${count} lead var.${summary ? ` · ${summary}` : ''}`, `Research ${jobStatus === 'partial' ? 'partially ' : ''}completed. ${totalFound} compan${totalFound === 1 ? 'y' : 'ies'} found, ${totalSaved} new saved; ${count} lead(s) in the pool.${summary ? ` · ${summary}` : ''}`));
          setResearchProgress(current => ({ ...current, stage: jobStatus as 'completed' | 'partial', totalFound, totalSaved, detail: reason }));
          setMode('pool');
          return;
        }
        // Nothing new: either everything found is already listed (not an error) or nothing was found; the backend's
        // errorMessage says why.
        const detail = totalFound > 0
          ? t(`Bulunan ${totalFound} şirketin hepsi zaten listenizde kayıtlı; yeni kayıt eklenmedi.`, `All ${totalFound} companies found are already in your list; nothing new was added.`)
          : reason || t('Bu kriterlerle yeni şirket bulunamadı.', 'No new companies were found for these criteria.');
        setResearchProgress(current => ({ ...current, stage: jobStatus as 'completed' | 'partial', totalFound, totalSaved: 0, querySummary: summary || current.querySummary, detail }));
        return;
      }

      if (!items.length) {
        const raw = JSON.stringify(data).slice(0, 300);
        setError(t(`Araştırma tamamlandı ancak sonuç bulunamadı. Backend yanıtı: ${raw}`, `Research completed but no results found. Backend response: ${raw}`));
        return;
      }

      const now = new Date().toISOString();
      const incoming = items.map(item => ({
        id: String(item.id || `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`), companyName: String(item.companyName || item.name || ''), email: String(item.email || '').toLowerCase(), country: item.country ? String(item.country) : undefined, companyType: item.companyType ? String(item.companyType) : undefined, website: item.website ? String(item.website) : undefined, sourceUrl: item.sourceUrl ? String(item.sourceUrl) : undefined, source: 'ai_research' as const, status: 'review' as const, consentStatus: 'unknown' as const, fitScore: Number(item.fitScore || 0) || undefined, intentScore: Number(item.intentScore || 0) || undefined, selectionReason: optionalString(item.selectionReason || item.fitReason || item.scoreReason || item.rationale), intentReason: optionalString(item.intentReason || item.signalReason), researchSignals: optionalStringList(item.researchSignals || item.matchedSignals || item.signals), sourceTitle: optionalString(item.sourceTitle || item.evidenceTitle), contactName: item.contactName ? String(item.contactName) : undefined, contactRole: item.contactRole ? String(item.contactRole) : undefined, notes: item.notes ? String(item.notes) : undefined, lastCheckedAt: now, createdAt: now, updatedAt: now,
      })).filter(item => item.companyName && /^\S+@\S+\.\S+$/.test(item.email));
      mergeLeads(incoming);
      setResearchProgress(current => ({ ...current, stage: 'saving', totalFound: incoming.length }));
      const persisted = await Promise.allSettled(incoming.map(item => prospectRequest('Upsert', 'POST', backendUpsertPayload(item))));
      if (persisted.some(item => item.status === 'rejected')) setError(t('Araştırma sonuçları alındı ancak bazı lead kayıtları backend’e yazılamadı.', "Research results were received, but some leads couldn't be saved to the backend."));
      setResearchProgress(current => ({ ...current, stage: 'completed', totalFound: incoming.length }));
      setMode('pool');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/devre dışı|feature_disabled|ResearchEnabled/i.test(msg)) { setFeatureDisabled(true); }
      const detail = researchErrorMessage(msg || t('AI araştırması başlatılamadı.', "Couldn't start AI research."), lang);
      setResearchProgress(current => ({ ...current, stage: 'failed', detail }));
    }
    finally { setBusy(false); }
  };

  const addManualLead = async () => {
    setBusy(true);
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (!companyName.trim() || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error(t('Firma adı ve geçerli bir e-posta zorunludur.', 'Company name and a valid email are required.'));
      if (leads.some(item => item.email.toLowerCase() === normalizedEmail)) throw new Error(t('Bu e-posta zaten lead havuzunda.', 'This email already exists in the lead pool.'));
      const lead = newLead({ companyName: companyName.trim(), email: normalizedEmail, country: country.trim() || undefined, companyType: companyType.trim() || undefined, website: website.trim() || undefined, source: 'manual', contactName: contactName.trim() || undefined, contactRole: contactRole.trim() || undefined, notes: notes.trim() || undefined });
      const saved = responseRoot(await prospectRequest('Upsert', 'POST', backendUpsertPayload(lead)));
      const savedLead = { ...lead, id: String(saved.id || saved.prospectId || lead.id) };
      try {
        const match = responseRoot(await prospectRequest('MatchCompany', 'POST', { prospectId: savedLead.id, companyName: savedLead.companyName, email: savedLead.email, website: savedLead.website }));
        if (match.matched || match.companyId) { savedLead.companyId = String(match.companyId || ''); savedLead.isRegisteredCompany = Boolean(match.matched || match.companyId); }
      } catch { /* Matching is enrichment; the lead itself is already persisted. */ }
      if (notes.trim()) {
        await prospectRequest('AddActivity', 'POST', { prospectId: savedLead.id, email: savedLead.email, activityType: 'meeting', note: notes.trim() });
      }
      mergeLeads([savedLead]);
      setCompanyName(''); setEmail(''); setCountry(''); setCompanyType(''); setWebsite(''); setContactName(''); setContactRole(''); setNotes(''); setMode('pool');
    } catch (err) { setError(err instanceof Error ? err.message : t('Lead kaydedilemedi.', "Couldn't save the lead.")); }
    finally { setBusy(false); }
  };

  const importCsv = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const imported = parseCsv(await file.text());
      if (!imported.length) throw new Error(t('CSV içinde geçerli lead bulunamadı.', 'No valid leads found in CSV.'));
      try {
        await prospectRequest('ImportJson', 'POST', { items: imported.map(backendUpsertPayload), updateExisting: false });
      } catch {
        await Promise.all(imported.map(item => prospectRequest('Upsert', 'POST', backendUpsertPayload(item))));
      }
      mergeLeads(imported); setMode('pool');
    } catch (err) { setError(err instanceof Error ? err.message : t('Lead içe aktarılamadı.', "Couldn't import the leads.")); }
    finally { setBusy(false); }
  };

  const updateStatus = async (id: string, status: ProspectLeadStatus) => {
    const item = leads.find(lead => lead.id === id);
    if (!item) return;
    if ((status === 'approved' || status === 'contacted') && (item.emailDomain === 'no_mx' || item.emailDomain === 'not_found' || item.emailValid === false || (item.emailDeliverable === false && item.emailDomain !== 'mx'))) {
      setError(t(`${item.companyName}: ${item.email} adresinin alan adı e-posta almıyor; gönderilen e-posta geri döner. Doğru adresi bulup lead'i güncelleyin.`, `${item.companyName}: the domain of ${item.email} receives no email; a message would bounce. Find the right address and update the lead.`));
      return;
    }
    setBusy(true); setError('');
    try {
      await prospectRequest('UpdateStatus', 'POST', { id, status });
      setLeads(current => current.map(lead => lead.id === id ? { ...lead, status, updatedAt: new Date().toISOString() } : lead));
    } catch (err) { setError(err instanceof Error ? err.message : t('Lead durumu güncellenemedi.', "Couldn't update the lead status.")); }
    finally { setBusy(false); }
  };

  const verifyEmails = async (items: ProspectLead[]) => {
    if (!items.length) return;
    setBusy(true); setError('');
    try {
      // Swagger: VerifyEmailsInput { emails, prospectIds: int64[], updateProspects } — sonuç lead kaydına da yazılır. İstek başına en fazla 50.
      const verified: Array<Record<string, unknown>> = [];
      for (let start = 0; start < items.length; start += 50) {
        const batch = items.slice(start, start + 50);
        verified.push(...responseItems(await prospectRequest('VerifyEmails', 'POST', { prospectIds: batch.map(item => Number(item.id)).filter(Number.isSafeInteger), emails: batch.map(item => item.email), updateProspects: true })));
      }
      if (verified.length) setLeads(current => current.map(item => { const match = verified.find(row => String(row.id || row.prospectId || '').toLowerCase() === item.id.toLowerCase() || String(row.email || '').toLowerCase() === item.email.toLowerCase()); return match ? { ...item, ...emailCheck(match), emailVerificationReason: match.reason ? String(match.reason) : item.emailVerificationReason, emailCheckedAt: match.checkedAt ? String(match.checkedAt) : new Date().toISOString() } : item; }));
      const failing = verified.filter(row => row.isDomainValid === false || row.isSyntaxValid === false || row.isDisposable === true).length;
      setOperationMessage(t(`${verified.length} e-posta doğrulandı; ${failing} adres e-posta alamıyor.`, `${verified.length} email(s) verified; ${failing} cannot receive email.`));
    } catch (err) { setError(err instanceof Error ? err.message : t('E-posta doğrulaması başlatılamadı.', "Couldn't start email verification.")); }
    finally { setBusy(false); }
  };

  const checkSuppression = async (items: ProspectLead[]) => {
    if (!items.length) return;
    setBusy(true); setError('');
    try {
      const results = await Promise.all(items.map(async item => ({ item, result: await prospectRequest(`GetSuppressionStatus?email=${encodeURIComponent(item.email)}`, 'GET') })));
      setLeads(current => current.map(item => { const match = results.find(result => result.item.id === item.id); if (!match) return item; const root = responseRoot(match.result); return { ...item, isSuppressed: Boolean(root.isSuppressed), suppressionReason: root.reason ? String(root.reason) : undefined }; }));
      setOperationMessage(t('Suppression durumları güncellendi.', 'Suppression statuses updated.'));
    } catch (err) { setError(err instanceof Error ? err.message : t('Suppression kontrolü başarısız.', "Couldn't check suppression status.")); }
    finally { setBusy(false); }
  };

  const suppressLead = async (item: ProspectLead) => {
    if (!window.confirm(t(`${item.companyName} suppression listesine eklensin mi?`, `Add ${item.companyName} to the suppression list?`))) return;
    setBusy(true); setError('');
    try {
      await prospectRequest('Suppress', 'POST', { email: item.email, reason: 'unsubscribed' });
      setLeads(current => current.map(lead => lead.id === item.id ? { ...lead, isSuppressed: true, suppressionReason: 'unsubscribed', updatedAt: new Date().toISOString() } : lead));
      setOperationMessage(t('Lead suppression listesine eklendi.', 'Lead added to the suppression list.'));
    } catch (err) { setError(err instanceof Error ? err.message : t('Lead suppression listesine eklenemedi.', "Couldn't add the lead to the suppression list.")); }
    finally { setBusy(false); }
  };

  const prepareCampaign = async () => {
    const items = approvedLeads.filter(item => selectedIds.length === 0 || selectedIds.includes(item.id));
    if (!items.length) return;
    setBusy(true); setError('');
    try {
      await prospectRequest('Preflight', 'POST', { prospectIds: items.map(item => item.id), emails: items.map(item => item.email), channel: 'email' });
      onUseInCampaign(items.map(item => item.email));
    } catch (err) { setError(err instanceof Error ? err.message : t('Kampanya ön kontrolü başarısız.', "Campaign preflight didn't pass.")); }
    finally { setBusy(false); }
  };
  const toggleSelected = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const selectedApprovedEmails = approvedLeads.filter(item => selectedIds.length === 0 || selectedIds.includes(item.id)).map(item => item.email);

  return <section className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg overflow-hidden">
    <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
      <div className="flex items-start justify-between gap-4 flex-wrap"><div><p className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('AI Prospect Finder', 'AI Prospect Finder')}</p><p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('Yeni maritime business şirketlerini bul, doğrula ve onaydan sonra kampanyaya aktar.', 'Find, verify and approve new maritime businesses before adding them to a campaign.')}</p></div><div className="flex items-center gap-2"><span className={`text-xs px-2.5 py-1 ${backendReady === true ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' : backendReady === false ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>{backendReady === true ? t('Backend bağlı', 'Backend connected') : backendReady === false ? t('Backend erişimi kontrol edilmeli', 'Backend connection needs checking') : t('Backend kontrol ediliyor', 'Checking backend')}</span><span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{t('İnsan onaylı gönderim', 'Human-approved outreach')}</span></div></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">{[[t('Toplam lead', 'Total leads'), leads.length], [t('İnceleme bekliyor', 'Needs review'), leads.filter(item => item.status === 'review').length], [t('Kampanyaya hazır', 'Campaign ready'), approvedLeads.length], [t('Dönüşüm', 'Converted'), leads.filter(item => ['registered', 'job_posted', 'cv_unlocked'].includes(item.status)).length]].map(([name, value]) => <div key={String(name)} className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"><span className="block text-[11px] uppercase tracking-wide text-slate-600">{name}</span><b className="block text-xl text-slate-800 dark:text-slate-100 mt-1">{value}</b></div>)}</div>
    </div>
    <div role="tablist" aria-label={t('Prospect Finder bölümleri', 'Prospect Finder sections')} onKeyDown={onTabKeys} className="flex gap-1 px-5 pt-4 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">{([['research', t('AI ile araştır', 'Research with AI')], ['add', t('Görüşme / lead ekle', 'Add meeting / lead')], ['pool', t('Lead havuzu', 'Lead pool')]] as const).map(([value, text]) => <button key={value} type="button" role="tab" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} onClick={() => setMode(value)} className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 ${mode === value ? 'border-ocean text-ocean' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>{text}</button>)}</div>
    {featureDisabled && <div role="status" className="mx-5 mt-4 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2 text-sm"><span aria-hidden="true">⚠️</span> {t('AI araştırma özelliği şu an devre dışı. Lütfen sistem yöneticinizle iletişime geçin.', 'AI research is currently disabled. Please contact your system administrator.')}</div>}
    {error && researchProgress.stage !== 'failed' && <div role="alert" className="mx-5 mt-4 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm"><Msg text={error} /></div>}
    {researchProgress.stage !== 'idle' && <ResearchProgressPanel progress={researchProgress} lang={lang} />}
    <div className="p-5">
      {mode === 'research' && <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-6"><div className="space-y-4"><div><label htmlFor={`${fid}-company-types`} className="text-xs text-slate-500 block mb-1">{t('Hedef şirket tipleri', 'Target company types')}</label><textarea id={`${fid}-company-types`} value={research.companyTypes.join('\n')} onChange={event => setResearch(current => ({ ...current, companyTypes: splitList(event.target.value) }))} rows={3} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></div><div className="grid md:grid-cols-2 gap-3"><div><label htmlFor={`${fid}-countries`} className="text-xs text-slate-500 block mb-1">{t('Ülkeler', 'Countries')}</label><input id={`${fid}-countries`} value={research.countries.join(', ')} onChange={event => setResearch(current => ({ ...current, countries: splitList(event.target.value).map(item => item.toUpperCase()) }))} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder="TR, GR, NL, SG" /></div><div><label htmlFor={`${fid}-max-results`} className="text-xs text-slate-500 block mb-1">{t('Maksimum sonuç', 'Maximum results')}</label><input id={`${fid}-max-results`} type="number" min={5} max={100} value={research.maxResults} onChange={event => setResearch(current => ({ ...current, maxResults: Math.min(100, Math.max(5, Number(event.target.value) || 5)) }))} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></div></div><div><label htmlFor={`${fid}-signals`} className="text-xs text-slate-500 block mb-1">{t('Arama sinyalleri', 'Search signals')}</label><textarea id={`${fid}-signals`} value={research.signals.join('\n')} onChange={event => setResearch(current => ({ ...current, signals: splitList(event.target.value) }))} rows={3} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder={t('Aktif işe alım, fleet management, crew vacancies', 'Active hiring, fleet management, crew vacancies')} /></div><button type="button" onClick={runResearch} disabled={busy} className="bg-ocean text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">{busy ? t('Araştırılıyor…', 'Researching…') : t('AI araştırmasını başlat', 'Start AI research')}</button></div><div className="border-l-4 border-amber-400 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-4 text-sm text-slate-700 dark:text-slate-200"><p className="font-semibold">{t('Sonuçlar nasıl kullanılacak?', 'How results are used')}</p><p className="text-xs leading-relaxed mt-2">{t('AI yalnızca kamuya açık kaynaklardan firma sinyali toplar. Her kayıtta kaynak URL’si, son kontrol zamanı ve puan gerekçesi tutulur.', 'AI uses public sources for company signals. Each record keeps a source URL, last checked time and score rationale.')}</p><p className="text-xs leading-relaxed mt-3 text-amber-800 dark:text-amber-300">{t('LinkedIn otomatik scraping ve izinsiz kişisel e-posta tahmini kullanılmaz. Son gönderim öncesi firma ve iletişim izni incelenmelidir.', 'No LinkedIn scraping or guessed personal emails are used. Review the company and outreach basis before sending.')}</p></div></div>}
      {mode === 'add' && <div className="max-w-4xl space-y-4"><div className="grid md:grid-cols-2 gap-3"><div><label htmlFor={`${fid}-company-name`} className="text-xs text-slate-500 block mb-1">{t('Firma adı', 'Company name')} *</label><input id={`${fid}-company-name`} value={companyName} onChange={event => setCompanyName(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></div><div><label htmlFor={`${fid}-email`} className="text-xs text-slate-500 block mb-1">{t('Genel iletişim e-postası', 'Business email')} *</label><input id={`${fid}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder="info@company.com" /></div><div><label htmlFor={`${fid}-company-type`} className="text-xs text-slate-500 block mb-1">{t('Şirket tipi', 'Company type')}</label><select id={`${fid}-company-type`} value={companyType} onChange={event => setCompanyType(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm"><option value="">{t('Seçin', 'Select')}</option>{COMPANY_TYPES.map(type => <option key={type} value={type}>{companyTypeLabel(type, lang)}</option>)}</select></div><div><label htmlFor={`${fid}-country`} className="text-xs text-slate-500 block mb-1">{t('Ülke', 'Country')}</label><input id={`${fid}-country`} value={country} onChange={event => setCountry(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder="TR" /></div><div><label htmlFor={`${fid}-website`} className="text-xs text-slate-500 block mb-1">{t('Web sitesi', 'Website')}</label><input id={`${fid}-website`} type="url" value={website} onChange={event => setWebsite(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder="https://" /></div><div><label htmlFor={`${fid}-contact`} className="text-xs text-slate-500 block mb-1">{t('Görüşülen kişi / rol', 'Contact / role')}</label><input id={`${fid}-contact`} value={`${contactName}${contactName && contactRole ? ' — ' : ''}${contactRole}`} onChange={event => { const [namePart, rolePart] = event.target.value.split(' — '); setContactName(namePart || ''); setContactRole(rolePart || ''); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder={t('İsim — Commercial Manager', 'Name — Commercial Manager')} /></div></div><div><label htmlFor={`${fid}-notes`} className="text-xs text-slate-500 block mb-1">{t('Görüşme notu / sonraki adım', 'Meeting notes / next step')}</label><textarea id={`${fid}-notes`} value={notes} onChange={event => setNotes(event.target.value)} rows={4} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></div><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void addManualLead()} disabled={busy} className="bg-ocean text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">{busy ? t('Kaydediliyor…', 'Saving…') : t('Lead’i kaydet', 'Save lead')}</button><label className={`border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-4 py-2.5 rounded-lg text-sm focus-within:ring-2 focus-within:ring-ocean ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>{t('CSV içe aktar', 'Import CSV')}<input type="file" accept=".csv,.txt,text/csv,text/plain" disabled={busy} className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.target.value = ''; }} /></label><span className="text-xs text-slate-600">{t('CSV: companyName, email, country, companyType, website', 'CSV: companyName, email, country, companyType, website')}</span></div></div>}
      {mode === 'pool' && <div>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={search} onChange={event => setSearch(event.target.value)} aria-label={t('Firma, ülke veya e-posta ara', 'Search company, country or email')} className="w-full border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:w-72" placeholder={t('Firma, ülke veya e-posta ara', 'Search company, country or email')} />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label={t('Durum filtresi', 'Status filter')} className="w-full border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:w-auto"><option value="all">{t('Tüm durumlar', 'All statuses')}</option>{STATUS_OPTIONS.map(item => <option key={item} value={item}>{label(item, lang)}</option>)}</select>
          </div>
          <button type="button" onClick={() => onUseInCampaign(selectedApprovedEmails)} disabled={!selectedApprovedEmails.length} className="bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('Onaylı lead’leri kampanyaya aktar', 'Use approved leads in campaign')} ({selectedApprovedEmails.length})</button>
        </div>

        <div className="hidden overflow-x-auto border border-slate-200 dark:border-slate-700 md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900"><tr className="text-left text-xs text-slate-500"><th className="p-3">{t('Seç', 'Select')}</th><th className="p-3">{t('Firma', 'Company')}</th><th className="p-3">{t('Tip / ülke', 'Type / country')}</th><th className="p-3">{t('Kaynak', 'Source')}</th><th className="p-3">{t('Uyum / niyet', 'Fit / intent')}</th><th className="p-3">{t('Durum', 'Status')}</th><th className="p-3">{t('İşlemler', 'Actions')}</th></tr></thead>
            <tbody>{filteredLeads.map(item => <Fragment key={item.id}>
              <tr className={`border-t border-slate-200 dark:border-slate-700 ${expandedLeadId === item.id ? 'bg-cyan-50/60 dark:bg-cyan-950/20' : ''}`}>
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} disabled={item.status !== 'approved'} className="accent-ocean" aria-label={t(`${item.companyName} firmasını seç`, `Select ${item.companyName}`)} /></td>
                <td className="p-3"><p className="font-medium text-slate-800 dark:text-slate-100">{item.companyName}</p><p className="text-xs text-slate-500">{item.email}</p></td>
                <td className="p-3 text-xs text-slate-500">{companyTypeLabel(item.companyType, lang)}{item.country ? ` · ${item.country}` : ''}</td>
                <td className="p-3 text-xs text-slate-500">{label(item.source, lang)}{item.sourceUrl ? <span className="mt-1 block text-green-600 dark:text-green-400">{t('Kaynak mevcut', 'Source available')}</span> : <span className="mt-1 block text-amber-600 dark:text-amber-400">{t('Doğrulanmalı', 'Needs verification')}</span>}</td>
                <td className="p-3 text-xs text-slate-500"><span className="block">{t('Uyum', 'Fit')}: {item.fitScore ?? '—'}</span><span className="block">{t('Niyet', 'Intent')}: {item.intentScore ?? '—'}</span></td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-[11px] ${badge(item.status)}`}>{label(item.status, lang)}</span><p className="mt-1 text-[11px] text-slate-600">{label(item.consentStatus, lang)}</p>{(item.emailDomain === 'no_mx' || item.emailDomain === 'not_found') && <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{t('E-posta alan adı yok', 'No email domain')}</p>}{domainUnverified(item) && <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{t('Alan adı kaynaklarda yok · elle kontrol et', 'Domain not in sources · check by hand')}</p>}</td>
                <td className="p-3"><div className="flex min-w-36 flex-col gap-2"><button type="button" aria-expanded={expandedLeadId === item.id} onClick={() => setExpandedLeadId(current => current === item.id ? null : item.id)} className="border border-ocean px-2 py-1.5 text-xs font-semibold text-ocean">{expandedLeadId === item.id ? t('Detayı kapat', 'Close details') : t('Değerlendir', 'Review')}</button><select value={item.status} onChange={event => updateStatus(item.id, event.target.value as ProspectLeadStatus)} aria-label={t(`${item.companyName} durumu`, `${item.companyName} status`)} className="border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-white">{STATUS_OPTIONS.map(option => <option key={option} value={option}>{label(option, lang)}</option>)}</select></div></td>
              </tr>
              {expandedLeadId === item.id && <tr className="border-t border-cyan-200 dark:border-cyan-900"><td colSpan={7} className="p-0"><ProspectDecisionPanel item={item} lang={lang} /></td></tr>}
            </Fragment>)}</tbody>
          </table>
          {!filteredLeads.length && <div className="py-10 text-center text-sm text-slate-600">{t('Henüz prospect yok. AI araştırması başlatabilir veya görüşme/CSV ile ekleyebilirsin.', 'No prospects yet. Start AI research or add a meeting/CSV lead.')}</div>}
        </div>

        <div className="space-y-3 md:hidden">{filteredLeads.map(item => <div key={item.id}>
          <article className={`border p-4 ${expandedLeadId === item.id ? 'border-ocean bg-cyan-50/50 dark:bg-cyan-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-800 dark:text-slate-100">{item.companyName}</p><p className="truncate text-xs text-slate-500">{item.email}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${badge(item.status)}`}>{label(item.status, lang)}</span></div>
            <p className="mt-2 text-xs text-slate-500">{companyTypeLabel(item.companyType, lang)}{item.country ? ` · ${item.country}` : ''}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="bg-slate-50 p-2 dark:bg-slate-900"><span className="block text-[10px] text-slate-600">{t('Uyum', 'Fit')}</span><b className="text-sm text-slate-700 dark:text-slate-200">{item.fitScore ?? '—'}</b></div><div className="bg-slate-50 p-2 dark:bg-slate-900"><span className="block text-[10px] text-slate-600">{t('Niyet', 'Intent')}</span><b className="text-sm text-slate-700 dark:text-slate-200">{item.intentScore ?? '—'}</b></div><div className="bg-slate-50 p-2 dark:bg-slate-900"><span className="block text-[10px] text-slate-600">{t('Kaynak', 'Source')}</span><b className={`text-xs ${item.sourceUrl ? 'text-green-600' : 'text-amber-600'}`}>{item.sourceUrl ? t('Var', 'Ready') : t('Eksik', 'Missing')}</b></div></div>
            <div className="mt-3 flex gap-2"><button type="button" aria-expanded={expandedLeadId === item.id} onClick={() => setExpandedLeadId(current => current === item.id ? null : item.id)} className="flex-1 border border-ocean px-3 py-2 text-xs font-semibold text-ocean">{expandedLeadId === item.id ? t('Detayı kapat', 'Close details') : t('Firmayı değerlendir', 'Review company')}</button><select value={item.status} onChange={event => updateStatus(item.id, event.target.value as ProspectLeadStatus)} aria-label={t(`${item.companyName} durumu`, `${item.companyName} status`)} className="min-w-0 border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-white">{STATUS_OPTIONS.map(option => <option key={option} value={option}>{label(option, lang)}</option>)}</select></div>
          </article>
          {expandedLeadId === item.id && <div className="border border-t-0 border-cyan-200 dark:border-cyan-900"><ProspectDecisionPanel item={item} lang={lang} /></div>}
        </div>)}{!filteredLeads.length && <div className="py-10 text-center text-sm text-slate-600">{t('Henüz prospect yok.', 'No prospects yet.')}</div>}</div>
      </div>}
      {mode === 'pool' && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 dark:border-slate-700 pt-4"><button type="button" onClick={() => void verifyEmails(leads.filter(item => item.status !== 'rejected'))} disabled={busy || !leads.some(item => item.status !== 'rejected')} className="border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg text-xs disabled:opacity-40">{t('Havuzdaki e-postaları doğrula', 'Verify emails in the pool')}</button><button type="button" onClick={() => void checkSuppression(approvedLeads.filter(item => selectedIds.length === 0 || selectedIds.includes(item.id)))} disabled={busy || !selectedApprovedEmails.length} className="border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg text-xs disabled:opacity-40">{t('Seçili suppression durumunu kontrol et', 'Check suppression for selected')}</button>{selectedApprovedEmails.length === 1 && <button type="button" onClick={() => void suppressLead(approvedLeads.find(item => item.email === selectedApprovedEmails[0])!)} disabled={busy} className="border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2 rounded-lg text-xs disabled:opacity-40">{t('Seçili lead’i engelle', 'Suppress selected lead')}</button>}{providerStatus && <span className="text-xs text-slate-500 dark:text-slate-400">{t('Sağlayıcı:', 'Provider:')} {providerStatus}</span>}{sourceCount !== null && <span className="text-xs text-slate-500 dark:text-slate-400">{sourceCount} {t('araştırma kaynağı', 'research sources')}</span>}{operationMessage && <span role="status" className="text-xs text-green-700 dark:text-green-300"><Msg text={operationMessage} /></span>}</div>}
    </div>
  </section>;
}

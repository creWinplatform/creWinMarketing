import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { mapSeries } from '../db/async-array';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import {
  EXPERT_FILE_MAX_BYTES, EXPERT_FILE_MIMES, EXPERT_FILES_PER_REQUEST, EXPERT_MAX_REVISIONS, EXPERT_PART_BYTES, EXPERT_SERVICES,
  type ExpertBrief, type ExpertFileMime, type ExpertNote, type ExpertRequestView, type ExpertService, type ExpertState, type ExpertsSnapshot, type PartnerCard, type PartnerProfileView,
} from './experts-types';

// "Ask an expert". A project that bought the agency package can list itself as a partner. A client project's approver
// sends a listed partner a brief (built from the brand kit and brand voice, edited and acknowledged before it is sent);
// the partner accepts or declines, uploads files into the request and delivers them; the client approves or asks for
// changes (at most three rounds). Price and payment are agreed between the two: Ryzevo neither charges nor mediates.
type Permission = Parameters<PlatformRepository['can']>[3];
type RequestRow = {
  id: string; organization_id: string; project_id: string; partner_organization_id: string; partner_project_id: string; service: ExpertService; brief_json: string; state: ExpertState;
  revisions: number; notes_json: string; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; delivered_at: string | null;
  reviewed_by: string | null; reviewed_at: string | null; updated_at: string;
};
type ProfileRow = { project_id: string; organization_id: string; display_name: string; summary: string; services_json: string; languages_json: string; website: string; contact: string; listed: number; updated_at: string };
type FileRow = { id: string; name: string; mime: ExpertFileMime; bytes: number; round: number; submitted_at: string | null; created_at: string };
const OPEN: ExpertState[] = ['sent', 'accepted', 'delivered', 'revision'];
const MAX_OPEN_PER_PROJECT = 10;
const now = () => new Date().toISOString();
// One character over the limit is kept, so a too long text is refused instead of silently cut.
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1) : '';
const line = (value: unknown, max: number) => text(value, max).replace(/\s+/g, ' ');
const within = (value: string, min: number, max: number, message: string) => { if (value.length < min || value.length > max) throw new MarketingStoreError(message); return value; };
const audit = async (db: Db, actor: string, organizationId: string, projectId: string, operation: string) => await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, organizationId, projectId, operation, now());
// An agency package that runs now (not only in its grace period) lets a partner take new work.
const running = async (db: Db, organizationId: string, projectId: string) => Boolean(await db.prepare("SELECT 1 FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND package='agency' AND starts_at<=? AND ends_at>?").get(organizationId, projectId, now(), now()));
const bought = async (db: Db, organizationId: string, projectId: string) => Boolean(await db.prepare("SELECT 1 FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND package='agency'").get(organizationId, projectId));
function sniff(bytes: Buffer): ExpertFileMime | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.length > 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}
function website(value: unknown) {
  let url: URL; try { url = new URL(String(value || '')); } catch { throw new MarketingStoreError('Geçerli bir https web sitesi adresi girin.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new MarketingStoreError('Geçerli bir https web sitesi adresi girin.');
  return url.href.slice(0, 300);
}
const card = (row: ProfileRow): PartnerCard => ({ id: row.project_id, displayName: row.display_name, summary: row.summary, services: JSON.parse(row.services_json), languages: JSON.parse(row.languages_json), website: row.website });

export async function partnerDirectory(db: Db, scope: MarketingScope, service?: unknown): Promise<PartnerCard[]> {
  const repo = new PlatformRepository(db);
  if (!await repo.can(scope.subject, scope.organizationId, scope.projectId, 'read') || (await repo.workspace(scope.subject, scope.organizationId, scope.projectId))?.project.productPack !== 'standard') throw new MarketingStoreError('Uzman listesi için proje erişimi gerekli.', 403);
  const rows = await db.prepare("SELECT p.* FROM platform_partner_profiles p WHERE p.listed=1 AND p.project_id<>? AND EXISTS(SELECT 1 FROM platform_project_subscriptions s WHERE s.organization_id=p.organization_id AND s.project_id=p.project_id AND s.package='agency' AND s.starts_at<=? AND s.ends_at>?) ORDER BY p.display_name").all(scope.projectId, now(), now()) as ProfileRow[];
  return rows.map(card).filter(item => !EXPERT_SERVICES.includes(service as ExpertService) || item.services.includes(service as ExpertService));
}

export class Experts {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(permission: Permission) { return this.repo.can(this.scope.subject, ...this.args(), permission); }
  private async standard() { return (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack === 'standard'; }
  private async need(permission: Permission, message: string) { if (!await this.standard() || !await this.can(permission)) throw new MarketingStoreError(message, 403); }
  // Partner side: only a project that bought the agency package (now or before) is a partner home.
  private async partnerNeed(permission: Permission, message: string) { await this.need(permission, message); if (!await bought(this.db, ...this.args())) throw new MarketingStoreError('Uzman ortaklığı ajans paketi alınmış projelerden yönetilir.', 403); }
  private async files(id: string, submittedOnly: boolean) {
    return (await this.db.prepare(`SELECT id,name,mime,bytes,round,submitted_at,created_at FROM platform_expert_files WHERE request_id=? AND status='ready'${submittedOnly ? ' AND submitted_at IS NOT NULL' : ''} ORDER BY round,created_at`).all(id) as FileRow[])
      .map(row => ({ id: row.id, name: row.name, mime: row.mime, bytes: Number(row.bytes), round: Number(row.round), submitted: Boolean(row.submitted_at), createdAt: row.created_at }));
  }
  private async view(row: RequestRow, side: 'client' | 'partner'): Promise<ExpertRequestView> {
    const partner = await this.db.prepare('SELECT display_name,contact FROM platform_partner_profiles WHERE project_id=?').get(row.partner_project_id) as { display_name: string; contact: string } | undefined;
    const client = side === 'partner' ? await this.db.prepare('SELECT p.name,o.name AS organization FROM platform_projects p JOIN platform_organizations o ON o.id=p.organization_id WHERE p.id=? AND p.organization_id=?').get(row.project_id, row.organization_id) as { name: string; organization: string } | undefined : undefined;
    return { id: row.id, service: row.service, state: row.state, revisions: Number(row.revisions), brief: JSON.parse(row.brief_json), notes: JSON.parse(row.notes_json), files: await this.files(row.id, side === 'client'),
      requestedAt: row.requested_at, decidedAt: row.decided_at, deliveredAt: row.delivered_at, reviewedAt: row.reviewed_at, updatedAt: row.updated_at,
      partnerName: partner?.display_name || '—', partnerContact: side === 'client' && partner && !['sent', 'declined', 'cancelled'].includes(row.state) ? partner.contact : null,
      clientName: client ? (client.name === client.organization ? client.name : `${client.name} · ${client.organization}`) : null };
  }
  private async clientRow(id: unknown) {
    const row = await this.db.prepare('SELECT * FROM platform_expert_requests WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as RequestRow | undefined;
    if (!row) throw new MarketingStoreError('Uzman talebi bulunamadı.', 404); return row;
  }
  private async partnerRow(id: unknown) {
    const row = await this.db.prepare('SELECT * FROM platform_expert_requests WHERE id=? AND partner_organization_id=? AND partner_project_id=?').get(id, ...this.args()) as RequestRow | undefined;
    if (!row) throw new MarketingStoreError('Uzman talebi bulunamadı.', 404); return row;
  }
  private async note(row: RequestRow, value: ExpertNote) { return JSON.stringify([...JSON.parse(row.notes_json) as ExpertNote[], value].slice(-20)); }
  // Moves a request from one of the expected states; a parallel change makes it fail instead of overwriting.
  private async move(row: RequestRow, from: ExpertState[], set: Record<string, unknown>) {
    if (!from.includes(row.state)) throw new MarketingStoreError('Talep bu işlem için uygun durumda değil. Sayfayı yenileyin.', 409);
    const keys = Object.keys(set), changed = (await this.db.prepare(`UPDATE platform_expert_requests SET ${keys.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=? AND state=? AND updated_at=?`).run(...keys.map(key => set[key]), now(), row.id, row.state, row.updated_at)).changes;
    if (!changed) throw new MarketingStoreError('Talep başka bir sekmede değişti. Sayfayı yenileyin.', 409);
  }

  async snapshot(): Promise<ExpertsSnapshot> {
    if (!await this.standard() || !await this.can('read')) throw new MarketingStoreError('Uzman talepleri için proje erişimi gerekli.', 403);
    const clientRows = await this.db.prepare('SELECT * FROM platform_expert_requests WHERE organization_id=? AND project_id=? ORDER BY requested_at DESC').all(...this.args()) as RequestRow[];
    const client = { canRequest: await this.can('campaign.approve'), canReview: await this.can('campaign.approve'), requests: await mapSeries(clientRows, row => this.view(row, 'client')) };
    let partner: ExpertsSnapshot['partner'] = null;
    if (await bought(this.db, ...this.args()) && await this.can('content.write')) {
      const profile = await this.db.prepare('SELECT * FROM platform_partner_profiles WHERE project_id=? AND organization_id=?').get(this.scope.projectId, this.scope.organizationId) as ProfileRow | undefined;
      const rows = await this.db.prepare('SELECT * FROM platform_expert_requests WHERE partner_organization_id=? AND partner_project_id=? ORDER BY requested_at DESC').all(...this.args()) as RequestRow[];
      partner = { canEdit: await this.can('billing.manage'), canWork: true, canDecide: await this.can('campaign.approve'), running: await running(this.db, ...this.args()),
        profile: profile ? { ...card(profile), contact: profile.contact, listed: Boolean(profile.listed), updatedAt: profile.updated_at } as PartnerProfileView : null, requests: await mapSeries(rows, row => this.view(row, 'partner')) };
    }
    return { client, partner };
  }

  // ---- Partner profile (the agency's home project) ----
  async saveProfile(raw: Record<string, unknown>) {
    await this.partnerNeed('billing.manage', 'Uzman profilini yalnız ajans paketinin sahibi düzenleyebilir.');
    const services = [...new Set(Array.isArray(raw.services) ? raw.services : [])].filter((item): item is ExpertService => EXPERT_SERVICES.includes(item as ExpertService));
    const languages = [...new Set(Array.isArray(raw.languages) ? raw.languages : [])].filter((item): item is 'tr' | 'en' => item === 'tr' || item === 'en');
    const displayName = within(line(raw.displayName, 80), 2, 80, 'Görünen ad 2–80 karakter olmalı.'), summary = within(text(raw.summary, 600), 20, 600, 'Tanıtım 20–600 karakter olmalı.');
    const contact = within(line(raw.contact, 120), 5, 120, 'İletişim bilgisi (e-posta veya telefon) 5–120 karakter olmalı.');
    if (!services.length) throw new MarketingStoreError('En az bir hizmet seçin.');
    if (!languages.length) throw new MarketingStoreError('En az bir çalışma dili seçin.');
    const url = website(raw.website), listed = raw.listed === true ? 1 : 0, at = now();
    if (listed && !await running(this.db, ...this.args())) throw new MarketingStoreError('Listede görünmek için ajans paketinin etkin olması gerekir.', 409);
    if (await this.db.prepare('SELECT 1 FROM platform_partner_profiles WHERE project_id=?').get(this.scope.projectId))
      await this.db.prepare('UPDATE platform_partner_profiles SET display_name=?,summary=?,services_json=?,languages_json=?,website=?,contact=?,listed=?,updated_by=?,updated_at=? WHERE project_id=? AND organization_id=?').run(displayName, summary, JSON.stringify(services), JSON.stringify(languages), url, contact, listed, this.scope.subject, at, this.scope.projectId, this.scope.organizationId);
    else await this.db.prepare('INSERT INTO platform_partner_profiles(project_id,organization_id,display_name,summary,services_json,languages_json,website,contact,listed,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(this.scope.projectId, this.scope.organizationId, displayName, summary, JSON.stringify(services), JSON.stringify(languages), url, contact, listed, this.scope.subject, at);
    await audit(this.db, this.scope.subject, ...this.args(), listed ? 'experts.profile.list' : 'experts.profile.save');
    return await this.snapshot();
  }

  // ---- Client side ----
  // The brand part of the brief, from the brand voice and the brand kit. Shown and editable before anything is sent.
  async briefDraft() {
    await this.need('campaign.approve', 'Uzman talebini onay yetkisi olan ekip üyeleri gönderir.');
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, tr = project.language !== 'en';
    const kit = await this.db.prepare('SELECT kit_json FROM platform_brand_kits WHERE organization_id=? AND project_id=?').get(...this.args()) as { kit_json: string } | undefined;
    const value = kit ? JSON.parse(kit.kit_json) as { colors?: Record<string, string>; font?: string; handle?: string; tagline?: string } : null;
    const goals = (project.goals as { label?: { tr?: string; en?: string } | string }[]).map(goal => typeof goal.label === 'string' ? goal.label : goal.label?.[tr ? 'tr' : 'en'] || '').filter(Boolean).slice(0, 5);
    const lines = [
      `${tr ? 'Marka' : 'Brand'}: ${project.name} (${project.website})`,
      value?.tagline ? `${tr ? 'Slogan' : 'Tagline'}: ${value.tagline}` : '',
      value?.handle ? `${tr ? 'Sosyal hesap' : 'Social handle'}: @${value.handle.replace(/^@/, '')}` : '',
      value?.colors ? `${tr ? 'Renkler' : 'Colours'}: ${Object.values(value.colors).join(', ')}` : '',
      value?.font ? `${tr ? 'Yazı tipi' : 'Typeface'}: ${value.font}` : '',
      goals.length ? `${tr ? 'Hedefler' : 'Goals'}: ${goals.join('; ')}` : '',
      project.brandVoice ? `${tr ? 'Marka dili' : 'Brand voice'}: ${project.brandVoice.replace(/\s+/g, ' ').slice(0, 700)}` : '',
    ].filter(Boolean);
    return { brand: lines.join('\n').slice(0, 1500), website: project.website, language: tr ? 'tr' : 'en' };
  }
  async create(raw: Record<string, unknown>) {
    await this.need('campaign.approve', 'Uzman talebini onay yetkisi olan ekip üyeleri gönderir.');
    if (raw.shareAcknowledged !== true) throw new MarketingStoreError('Brifin seçtiğiniz uzmanla paylaşılacağını onaylayın.');
    const service = raw.service as ExpertService;
    if (!EXPERT_SERVICES.includes(service)) throw new MarketingStoreError('Bir hizmet seçin.');
    const today = now().slice(0, 10), due = typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : '';
    if (!due || Number.isNaN(Date.parse(due)) || due <= today || Date.parse(due) - Date.parse(today) > 180 * 86400000) throw new MarketingStoreError('Teslim tarihi yarından sonra ve en çok 180 gün içinde olmalı.');
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project;
    const brief: ExpertBrief = {
      title: within(line(raw.title, 120), 3, 120, 'Başlık 3–120 karakter olmalı.'), details: within(text(raw.details, 2000), 20, 2000, 'İş tanımı 20–2000 karakter olmalı.'),
      deliverables: within(text(raw.deliverables, 600), 3, 600, 'Teslim edilecekleri yazın (en çok 600 karakter).'), dueDate: due, budgetNote: within(line(raw.budgetNote, 120), 0, 120, 'Bütçe notu en çok 120 karakter.'),
      brand: within(text(raw.brand, 1500), 0, 1500, 'Marka bilgisi en çok 1500 karakter.'), contact: within(line(raw.contact, 120), 5, 120, 'Size ulaşılacak iletişim bilgisini yazın (5–120 karakter).'),
      website: project.website, language: project.language === 'en' ? 'en' : 'tr',
    };
    return await this.db.transaction(async () => {
      const partner = await this.db.prepare('SELECT * FROM platform_partner_profiles WHERE project_id=? AND listed=1').get(String(raw.partnerId || '')) as ProfileRow | undefined;
      if (!partner || partner.project_id === this.scope.projectId || !await running(this.db, partner.organization_id, partner.project_id)) throw new MarketingStoreError('Bu uzman şu anda talep almıyor.', 409);
      if (!(JSON.parse(partner.services_json) as ExpertService[]).includes(service)) throw new MarketingStoreError('Bu uzman seçilen hizmeti vermiyor.', 409);
      if ((await this.db.prepare(`SELECT COUNT(*) AS n FROM platform_expert_requests WHERE organization_id=? AND project_id=? AND state IN (${OPEN.map(() => '?').join(',')})`).get(...this.args(), ...OPEN) as { n: number }).n >= MAX_OPEN_PER_PROJECT) throw new MarketingStoreError(`Aynı anda en çok ${MAX_OPEN_PER_PROJECT} açık uzman talebi olabilir.`, 429);
      const id = `exp_${randomUUID().replace(/-/g, '')}`, at = now();
      await this.db.prepare("INSERT INTO platform_expert_requests(id,organization_id,project_id,partner_organization_id,partner_project_id,service,brief_json,state,revisions,notes_json,requested_by,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,'sent',0,'[]',?,?,?)")
        .run(id, ...this.args(), partner.organization_id, partner.project_id, service, JSON.stringify(brief), this.scope.subject, at, at);
      await audit(this.db, this.scope.subject, ...this.args(), 'experts.request.send'); await audit(this.db, this.scope.subject, partner.organization_id, partner.project_id, 'experts.request.receive');
      return await this.snapshot();
    });
  }
  async cancel(raw: Record<string, unknown>) {
    await this.need('campaign.approve', 'Uzman talebini onay yetkisi olan ekip üyeleri yönetir.');
    const row = await this.clientRow(raw.id);
    await this.move(row, ['sent', 'accepted'], { state: 'cancelled', notes_json: await this.note(row, { by: 'client', kind: 'cancel', text: line(raw.note, 500).slice(0, 500), at: now() }) });
    await audit(this.db, this.scope.subject, ...this.args(), 'experts.request.cancel');
    return await this.snapshot();
  }
  async review(raw: Record<string, unknown>) {
    await this.need('campaign.approve', 'Teslimi onay yetkisi olan ekip üyeleri onaylar.');
    const row = await this.clientRow(raw.id), at = now();
    if (raw.decision === 'approve') await this.move(row, ['delivered'], { state: 'approved', reviewed_by: this.scope.subject, reviewed_at: at });
    else if (raw.decision === 'revision') {
      if (Number(row.revisions) >= EXPERT_MAX_REVISIONS) throw new MarketingStoreError(`En çok ${EXPERT_MAX_REVISIONS} düzeltme turu istenebilir.`, 409);
      const note = within(text(raw.note, 1000), 5, 1000, 'Neyin değişmesini istediğinizi yazın (5–1000 karakter).');
      await this.move(row, ['delivered'], { state: 'revision', revisions: Number(row.revisions) + 1, reviewed_by: this.scope.subject, reviewed_at: at, notes_json: await this.note(row, { by: 'client', kind: 'revision', text: note, at }) });
    } else throw new MarketingStoreError('Geçersiz karar.');
    await audit(this.db, this.scope.subject, ...this.args(), raw.decision === 'approve' ? 'experts.delivery.approve' : 'experts.delivery.revision');
    return await this.snapshot();
  }

  // ---- Partner side ----
  async decide(raw: Record<string, unknown>) {
    await this.partnerNeed('campaign.approve', 'Talepleri onay yetkisi olan ekip üyeleri kabul eder.');
    const row = await this.partnerRow(raw.id), at = now();
    if (raw.decision === 'accept') {
      if (!await running(this.db, ...this.args())) throw new MarketingStoreError('Ajans paketi etkin değilken yeni iş kabul edilemez.', 409);
      await this.move(row, ['sent'], { state: 'accepted', decided_by: this.scope.subject, decided_at: at });
    } else if (raw.decision === 'decline') await this.move(row, ['sent'], { state: 'declined', decided_by: this.scope.subject, decided_at: at, notes_json: await this.note(row, { by: 'partner', kind: 'decline', text: line(raw.note, 500).slice(0, 500), at }) });
    else throw new MarketingStoreError('Geçersiz karar.');
    await audit(this.db, this.scope.subject, ...this.args(), raw.decision === 'accept' ? 'experts.request.accept' : 'experts.request.decline');
    await audit(this.db, this.scope.subject, row.organization_id, row.project_id, raw.decision === 'accept' ? 'experts.request.accepted' : 'experts.request.declined');
    return await this.snapshot();
  }
  // A delivery file is uploaded in parts (each below common proxy body limits and the body reader's time limit), then
  // checked as a whole (size, SHA-256, its own first bytes). It stays with the partner until the delivery is submitted.
  async startFile(raw: Record<string, unknown>) {
    await this.partnerNeed('content.write', 'Teslim dosyası için içerik yazma yetkisi gerekir.');
    const row = await this.partnerRow(raw.id), bytes = Number(raw.bytes);
    if (!['accepted', 'revision'].includes(row.state)) throw new MarketingStoreError('Dosya yalnız kabul edilmiş veya düzeltme istenmiş taleplere eklenir.', 409);
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > EXPERT_FILE_MAX_BYTES || !EXPERT_FILE_MIMES.includes(raw.mime as ExpertFileMime)) throw new MarketingStoreError('Dosya en fazla 6 MB PNG, JPEG, WebP veya PDF olmalı.');
    if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new MarketingStoreError('Dosya özeti geçersiz.');
    const name = (line(raw.name, 120).replace(/[\\/:*?"<>|]/g, '_') || 'teslim').slice(0, 120), id = `exf_${randomUUID().replace(/-/g, '')}`, parts = Math.ceil(bytes / EXPERT_PART_BYTES);
    await this.db.transaction(async () => {
      // Uploads abandoned for a day make room again.
      const stale = await this.db.prepare("SELECT id FROM platform_expert_files WHERE request_id=? AND status='uploading' AND created_at<?").all(row.id, new Date(Date.now() - 86400000).toISOString()) as { id: string }[];
      for (const file of stale) { await this.db.prepare('DELETE FROM platform_expert_file_parts WHERE file_id=?').run(file.id); await this.db.prepare('DELETE FROM platform_expert_files WHERE id=?').run(file.id); }
      if ((await this.db.prepare('SELECT COUNT(*) AS n FROM platform_expert_files WHERE request_id=?').get(row.id) as { n: number }).n >= EXPERT_FILES_PER_REQUEST) throw new MarketingStoreError(`Bir talebe en çok ${EXPERT_FILES_PER_REQUEST} dosya eklenebilir.`, 429);
      await this.db.prepare("INSERT INTO platform_expert_files(id,request_id,name,mime,bytes,sha256,parts,status,round,submitted_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,'uploading',?,NULL,?,?)").run(id, row.id, name, raw.mime, bytes, raw.sha256, parts, Number(row.revisions) + 1, this.scope.subject, now());
    });
    return { fileId: id, parts, partBytes: EXPERT_PART_BYTES };
  }
  private async uploading(fileId: unknown) {
    const file = await this.db.prepare("SELECT f.id,f.bytes,f.parts,f.mime,f.sha256,f.status FROM platform_expert_files f JOIN platform_expert_requests r ON r.id=f.request_id WHERE f.id=? AND r.partner_organization_id=? AND r.partner_project_id=? AND r.state IN ('accepted','revision')").get(fileId, ...this.args()) as { id: string; bytes: number; parts: number; mime: ExpertFileMime; sha256: string; status: string } | undefined;
    if (!file) throw new MarketingStoreError('Yüklenen dosya bulunamadı.', 404);
    return { ...file, bytes: Number(file.bytes), parts: Number(file.parts) };
  }
  async filePart(fileId: unknown, index: unknown, data: Uint8Array) {
    await this.partnerNeed('content.write', 'Teslim dosyası için içerik yazma yetkisi gerekir.');
    const file = await this.uploading(fileId), part = Number(index);
    if (file.status !== 'uploading') throw new MarketingStoreError('Bu dosya zaten tamamlandı.', 409);
    if (!Number.isInteger(part) || part < 0 || part >= file.parts) throw new MarketingStoreError('Geçersiz dosya parçası.');
    if (data.length !== (part === file.parts - 1 ? file.bytes - EXPERT_PART_BYTES * (file.parts - 1) : EXPERT_PART_BYTES)) throw new MarketingStoreError('Dosya parçasının boyutu beklenenden farklı.');
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_expert_file_parts WHERE file_id=? AND part=?').run(file.id, part);
      await this.db.prepare('INSERT INTO platform_expert_file_parts(file_id,part,data) VALUES(?,?,?)').run(file.id, part, Buffer.from(data));
    });
    return { fileId: file.id, part };
  }
  async finishFile(raw: Record<string, unknown>) {
    await this.partnerNeed('content.write', 'Teslim dosyası için içerik yazma yetkisi gerekir.');
    const file = await this.uploading(raw.fileId);
    if (file.status === 'uploading') {
      const data = await this.assemble(file.id, file.parts);
      if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256 || sniff(data) !== file.mime) {
        await this.db.prepare('DELETE FROM platform_expert_file_parts WHERE file_id=?').run(file.id); await this.db.prepare('DELETE FROM platform_expert_files WHERE id=?').run(file.id);
        throw new MarketingStoreError('Dosya eksik veya bozuk geldi ya da türü PNG, JPEG, WebP veya PDF değil. Tekrar yükleyin.');
      }
      await this.db.prepare("UPDATE platform_expert_files SET status='ready' WHERE id=? AND status='uploading'").run(file.id);
    }
    return await this.snapshot();
  }
  private async assemble(fileId: string, parts: number) {
    const rows = await this.db.prepare('SELECT part,data FROM platform_expert_file_parts WHERE file_id=? ORDER BY part').all(fileId) as { part: number; data: Buffer | Uint8Array }[];
    if (rows.length !== parts || rows.some((row, index) => Number(row.part) !== index)) return Buffer.alloc(0);
    return Buffer.concat(rows.map(row => Buffer.from(row.data)));
  }
  async removeFile(raw: Record<string, unknown>) {
    await this.partnerNeed('content.write', 'Teslim dosyası için içerik yazma yetkisi gerekir.');
    const row = await this.partnerRow(raw.id);
    const file = await this.db.prepare('SELECT id FROM platform_expert_files WHERE id=? AND request_id=? AND submitted_at IS NULL').get(raw.fileId, row.id) as { id: string } | undefined;
    if (!file) throw new MarketingStoreError('Teslim edilmiş dosyalar silinemez.', 409);
    await this.db.transaction(async () => { await this.db.prepare('DELETE FROM platform_expert_file_parts WHERE file_id=?').run(file.id); await this.db.prepare('DELETE FROM platform_expert_files WHERE id=?').run(file.id); });
    return await this.snapshot();
  }
  async deliver(raw: Record<string, unknown>) {
    await this.partnerNeed('content.write', 'Teslim için içerik yazma yetkisi gerekir.');
    const row = await this.partnerRow(raw.id), at = now(), note = text(raw.note, 1000);
    return await this.db.transaction(async () => {
      const pending = await this.db.prepare('SELECT status FROM platform_expert_files WHERE request_id=? AND submitted_at IS NULL').all(row.id) as { status: string }[];
      if (pending.some(file => file.status !== 'ready')) throw new MarketingStoreError('Yüklenmesi süren dosyalar var. Bitmesini bekleyin veya kaldırın.', 409);
      if (!pending.length) throw new MarketingStoreError('Teslim için en az bir dosya ekleyin.', 409);
      await this.move(row, ['accepted', 'revision'], { state: 'delivered', delivered_at: at, ...(note ? { notes_json: await this.note(row, { by: 'partner', kind: 'delivery', text: note.slice(0, 1000), at }) } : {}) });
      await this.db.prepare("UPDATE platform_expert_files SET submitted_at=? WHERE request_id=? AND submitted_at IS NULL AND status='ready'").run(at, row.id);
      await audit(this.db, this.scope.subject, ...this.args(), 'experts.delivery.submit'); await audit(this.db, this.scope.subject, row.organization_id, row.project_id, 'experts.delivery.received');
      return await this.snapshot();
    });
  }

  // A file of a request: the client sees delivered files only; the partner sees its own uploads too.
  async file(requestId: string, fileId: string) {
    if (!await this.standard() || !await this.can('read')) throw new MarketingStoreError('Dosya bulunamadı.', 404);
    const own = await this.db.prepare('SELECT id FROM platform_expert_requests WHERE id=? AND organization_id=? AND project_id=?').get(requestId, ...this.args());
    const partner = !own && await this.can('content.write') && await this.db.prepare('SELECT id FROM platform_expert_requests WHERE id=? AND partner_organization_id=? AND partner_project_id=?').get(requestId, ...this.args());
    if (!own && !partner) throw new MarketingStoreError('Dosya bulunamadı.', 404);
    const row = await this.db.prepare(`SELECT id,name,mime,parts FROM platform_expert_files WHERE id=? AND request_id=? AND status='ready'${own ? ' AND submitted_at IS NOT NULL' : ''}`).get(fileId, requestId) as { id: string; name: string; mime: ExpertFileMime; parts: number } | undefined;
    if (!row) throw new MarketingStoreError('Dosya bulunamadı.', 404);
    return { name: row.name, mime: row.mime, data: await this.assemble(row.id, Number(row.parts)) };
  }
}

// Requests that wait for this project: new or returned work for a partner, deliveries to review for a client.
export async function expertAttention(db: Db, scope: MarketingScope, partnerSide: boolean, clientSide: boolean) {
  const rows: { id: string; state: ExpertState; updated_at: string }[] = [];
  if (clientSide) rows.push(...await db.prepare("SELECT id,state,updated_at FROM platform_expert_requests WHERE organization_id=? AND project_id=? AND state='delivered'").all(scope.organizationId, scope.projectId) as typeof rows);
  if (partnerSide) rows.push(...await db.prepare("SELECT id,state,updated_at FROM platform_expert_requests WHERE partner_organization_id=? AND partner_project_id=? AND state IN ('sent','revision')").all(scope.organizationId, scope.projectId) as typeof rows);
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

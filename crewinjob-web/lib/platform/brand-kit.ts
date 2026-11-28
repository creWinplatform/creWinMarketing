import type { Db } from '../db/client';
import 'server-only';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ryzevoFeature } from './ryzevo-features';
import { isVoiceEnabled } from './voice-features';
import { BRAND_FONTS, DEFAULT_BRAND_KIT, HEX_COLOR, LOGO_MAX_BYTES, type BrandFont, type BrandKit, type BrandKitInput, type BrandLogo, type BrandVoiceProfile } from './brand-kit-types';

type Row = { revision: number; kit_json: string; logo_data: string | null; logo_mime: BrandLogo['mime'] | null; updated_at: string };
const MIMES: BrandLogo['mime'][] = ['image/png', 'image/jpeg', 'image/webp'];
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
// The file's own first bytes decide its type; the declared MIME must match them.
function sniff(bytes: Buffer): BrandLogo['mime'] | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
export function normalizeBrandKit(raw: Record<string, unknown>): BrandKitInput {
  const colors = raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors) ? raw.colors as Record<string, unknown> : {};
  const color = (key: keyof BrandKitInput['colors']) => {
    const value = colors[key];
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new MarketingStoreError('Renkler #RRGGBB biçiminde olmalı.');
    return value.toLowerCase();
  };
  if (!BRAND_FONTS.includes(raw.font as BrandFont)) throw new MarketingStoreError('Geçersiz yazı tipi.');
  const kit: BrandKitInput = { colors: { primary: color('primary'), accent: color('accent'), dark: color('dark'), light: color('light') }, font: raw.font as BrandFont, handle: text(raw.handle, 40), tagline: text(raw.tagline, 80) };
  // The brand voice is read only while voice features are on; otherwise the field is ignored and the kit is as before.
  if (isVoiceEnabled() && raw.voiceProfile !== undefined && raw.voiceProfile !== null) kit.voiceProfile = normalizeVoiceProfile(raw.voiceProfile);
  return kit;
}
// Only kind 'designed'. A cloned voice (or any other kind) is refused: cloning needs the voice owner's proven consent
// and a separate legal approval, so it is not offered.
export function normalizeVoiceProfile(raw: unknown): BrandVoiceProfile {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!value || value.kind !== 'designed') throw new MarketingStoreError('Marka sesi yalnız tasarlanmış (designed) bir ses olabilir; ses klonlama desteklenmez.');
  if (typeof value.voiceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.voiceId)) throw new MarketingStoreError('Geçersiz ses kimliği.');
  return { kind: 'designed', voiceId: value.voiceId, label: text(value.label, 40) };
}
export function normalizeLogo(raw: unknown): BrandLogo | null {
  if (raw === null) return null;
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!value || typeof value.data !== 'string' || !MIMES.includes(value.mime as BrandLogo['mime']) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw new MarketingStoreError('Logo PNG, JPEG veya WebP olmalı.');
  const bytes = Buffer.from(value.data, 'base64');
  if (!bytes.length || bytes.length > LOGO_MAX_BYTES) throw new MarketingStoreError('Logo en fazla 400 KB olabilir.');
  if (sniff(bytes) !== value.mime) throw new MarketingStoreError('Logo dosyası bildirilen türde değil.');
  return { data: bytes.toString('base64'), mime: value.mime as BrandLogo['mime'] };
}

// One brand kit per project: everyone in the project reads it (designs use it); people who manage the project's
// settings (connections.manage) change it. Each save moves the revision; a save from an older revision is refused.
export class BrandKits {
  repo: PlatformRepository;
  constructor(public db: Db, public scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize(permission: 'read' | 'connections.manage') {
    const workspace = await this.repo.workspace(this.scope.subject, ...this.args());
    const pack = workspace?.project.productPack;
    if (!workspace || !await this.repo.can(this.scope.subject, ...this.args(), 'read') || !(pack === 'standard' || ryzevoFeature(pack, 'brand'))) throw new MarketingStoreError('Marka kiti için proje erişimi gerekli.', 403);
    if (permission !== 'read' && !await this.repo.can(this.scope.subject, ...this.args(), permission)) throw new MarketingStoreError('Marka kitini yalnız proje ayarlarını yöneten ekip üyeleri değiştirebilir.', 403);
  }
  private async row() { return await this.db.prepare('SELECT revision,kit_json,logo_data,logo_mime,updated_at FROM platform_brand_kits WHERE organization_id=? AND project_id=?').get(...this.args()) as Row | undefined; }
  private async view(row: Row | undefined): Promise<BrandKit> {
    let stored: Partial<BrandKitInput> = {};
    try { stored = row ? JSON.parse(row.kit_json) : {}; } catch { stored = {}; }
    const { voiceProfile, ...rest } = stored;
    // The brand voice is shown only while voice features are on.
    const kit = { ...DEFAULT_BRAND_KIT, ...rest, colors: { ...DEFAULT_BRAND_KIT.colors, ...(stored.colors || {}) }, ...(isVoiceEnabled() && voiceProfile?.kind === 'designed' ? { voiceProfile } : {}) };
    return { ...kit, revision: row?.revision || 0, logo: row?.logo_data && row.logo_mime ? { data: row.logo_data, mime: row.logo_mime } : null, updatedAt: row?.updated_at || null,
      canEdit: await this.repo.can(this.scope.subject, ...this.args(), 'connections.manage') };
  }
  async read() { await this.authorize('read'); return await this.view(await this.row()); }
  // raw.logo: undefined keeps the stored logo, null removes it, {data,mime} replaces it.
  async save(raw: Record<string, unknown>) {
    await this.authorize('connections.manage');
    const kit = normalizeBrandKit(raw), logo = raw.logo === undefined ? undefined : normalizeLogo(raw.logo);
    return await this.db.transaction(async () => {
      await this.authorize('connections.manage');
      const row = await this.row(), now = new Date().toISOString();
      if (raw.expectedRevision !== (row?.revision || 0)) throw new MarketingStoreError('Marka kiti başka bir sekmede değişti. Yenileyip tekrar deneyin.', 409);
      // A stored brand voice is kept unless voice features are on and the save sends null (remove) or a new one.
      if (!kit.voiceProfile && !(isVoiceEnabled() && raw.voiceProfile === null)) {
        let stored: Partial<BrandKitInput> = {};
        try { stored = row ? JSON.parse(row.kit_json) : {}; } catch { stored = {}; }
        if (stored.voiceProfile?.kind === 'designed') kit.voiceProfile = stored.voiceProfile;
      }
      const logoData = logo === undefined ? row?.logo_data ?? null : logo?.data ?? null, logoMime = logo === undefined ? row?.logo_mime ?? null : logo?.mime ?? null;
      if (!row) await this.db.prepare('INSERT INTO platform_brand_kits(organization_id,project_id,revision,kit_json,logo_data,logo_mime,updated_by,updated_at) VALUES(?,?,1,?,?,?,?,?)').run(...this.args(), JSON.stringify(kit), logoData, logoMime, this.scope.subject, now);
      else await this.db.prepare('UPDATE platform_brand_kits SET revision=revision+1,kit_json=?,logo_data=?,logo_mime=?,updated_by=?,updated_at=? WHERE organization_id=? AND project_id=? AND revision=?').run(JSON.stringify(kit), logoData, logoMime, this.scope.subject, now, ...this.args(), row.revision);
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), 'brand_kit.save', now);
      return await this.view(await this.row());
    });
  }
}

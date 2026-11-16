import type { Db } from '../db/client';
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ryzevoFeature } from './ryzevo-features';
import { readMp4 } from './mp4-writer';

// Short videos made in the design studio. The browser encodes the MP4 and uploads it in parts (each below common proxy
// body limits); when the last part arrives the whole file is checked (size, SHA-256, MP4 structure) and becomes "ready".
// A ready video is served without a session at a signed address, because Instagram, Facebook and TikTok fetch it.
// Small enough to arrive within the body reader's 5-second limit on a slow mobile uplink.
export const VIDEO_PART_BYTES = 384 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_PROJECT_LIMIT = { count: 200, bytes: 2 * 1024 * 1024 * 1024 };
type Row = { id: string; organization_id: string; project_id: string; status: 'uploading' | 'ready'; bytes: number; sha256: string; width: number; height: number; duration_ms: number; parts: number; created_at: string; ready_at: string | null };
const ID = /^vid_[a-f0-9]{32}$/;
const integer = (value: unknown, min: number, max: number, message: string) => { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new MarketingStoreError(message); return value as number; };

export function videoSignature(key: string, row: Pick<Row, 'id' | 'organization_id' | 'project_id' | 'sha256'>) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(['ryzevo-video-v1', row.organization_id, row.project_id, row.id, row.sha256].join('\n')).digest('hex');
}
// The public address: PLATFORM_PUBLIC_ORIGIN when it is a valid public https origin, otherwise the panel's own address.
export function videoUrl(origin: string, key: string, row: Pick<Row, 'id' | 'organization_id' | 'project_id' | 'sha256'>) {
  return `${origin.replace(/\/$/, '')}/api/platform/media/videos/${row.id}?signature=${videoSignature(key, row)}`;
}

export class MediaVideos {
  repo: PlatformRepository;
  constructor(public db: Db, public scope: MarketingScope, private key: string) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize() {
    const workspace = await this.repo.workspace(this.scope.subject, ...this.args()), pack = workspace?.project.productPack;
    if (!workspace || !(pack === 'standard' || ryzevoFeature(pack, 'brand'))) throw new MarketingStoreError('Video için proje erişimi gerekli.', 403);
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'content.write')) throw new MarketingStoreError('Video hazırlamak için içerik yazma yetkisi gerekir.', 403);
  }
  private async row(id: unknown) {
    if (typeof id !== 'string' || !ID.test(id)) throw new MarketingStoreError('Video bulunamadı.', 404);
    const row = await this.db.prepare('SELECT * FROM platform_media_videos WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as Row | undefined;
    if (!row) throw new MarketingStoreError('Video bulunamadı.', 404);
    return row;
  }
  async start(raw: Record<string, unknown>) {
    await this.authorize();
    const bytes = integer(raw.bytes, 1, VIDEO_MAX_BYTES, 'Video en fazla 50 MB olabilir.');
    const width = integer(raw.width, 16, 4096, 'Geçersiz video boyutu.'), height = integer(raw.height, 16, 4096, 'Geçersiz video boyutu.');
    const durationMs = integer(raw.durationMs, 500, 180000, 'Video 0,5 ile 180 saniye arasında olmalı.');
    if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new MarketingStoreError('Geçersiz video özeti.');
    const parts = Math.ceil(bytes / VIDEO_PART_BYTES), id = `vid_${randomBytes(16).toString('hex')}`, now = new Date().toISOString();
    return await this.db.transaction(async () => {
      await this.authorize();
      // Abandoned uploads older than a day make room first.
      for (const stale of await this.db.prepare("SELECT id FROM platform_media_videos WHERE organization_id=? AND project_id=? AND status='uploading' AND created_at<?").all(...this.args(), new Date(Date.now() - 86400000).toISOString()) as { id: string }[]) await this.drop(stale.id);
      const used = await this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(bytes),0) total FROM platform_media_videos WHERE organization_id=? AND project_id=?').get(...this.args()) as { n: number; total: number };
      if (Number(used.n) >= VIDEO_PROJECT_LIMIT.count || Number(used.total) + bytes > VIDEO_PROJECT_LIMIT.bytes) throw new MarketingStoreError('Bu projenin video alanı doldu (200 video veya 2 GB). Kullanılmayan videoları silin.', 409);
      await this.db.prepare("INSERT INTO platform_media_videos(id,organization_id,project_id,status,bytes,sha256,width,height,duration_ms,parts,created_by,created_at) VALUES(?,?,?,'uploading',?,?,?,?,?,?,?,?)").run(id, ...this.args(), bytes, raw.sha256, width, height, durationMs, parts, this.scope.subject, now);
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), 'media.video.start', now);
      return { id, parts, partBytes: VIDEO_PART_BYTES };
    });
  }
  // One part, at most VIDEO_PART_BYTES; the last part carries the rest. A part sent twice replaces itself.
  async part(id: unknown, index: unknown, data: Uint8Array) {
    await this.authorize();
    const row = await this.row(id);
    if (row.status !== 'uploading') throw new MarketingStoreError('Bu video zaten tamamlandı.', 409);
    const part = integer(index, 0, row.parts - 1, 'Geçersiz video parçası.'), expected = part === row.parts - 1 ? row.bytes - VIDEO_PART_BYTES * (row.parts - 1) : VIDEO_PART_BYTES;
    if (data.length !== expected) throw new MarketingStoreError('Video parçasının boyutu beklenenden farklı.');
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_media_video_parts WHERE video_id=? AND part=?').run(row.id, part);
      await this.db.prepare('INSERT INTO platform_media_video_parts(video_id,part,data) VALUES(?,?,?)').run(row.id, part, Buffer.from(data));
    });
    return { id: row.id, part };
  }
  // Checks the assembled file and marks it ready; returns the signed public address.
  async finish(id: unknown, origin: string) {
    await this.authorize();
    const row = await this.row(id);
    if (row.status === 'ready') return { id: row.id, url: videoUrl(origin, this.key, row) };
    const file = await this.assemble(row);
    if (file.length !== row.bytes || createHash('sha256').update(file).digest('hex') !== row.sha256) throw new MarketingStoreError('Video eksik veya bozuk yüklendi. Tekrar deneyin.', 409);
    try { const mp4 = readMp4(file); if (!mp4.types.includes('moov') || !mp4.count || mp4.width !== row.width || mp4.height !== row.height) throw new Error(); } catch { throw new MarketingStoreError('Dosya geçerli bir MP4 videosu değil.', 400); }
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE platform_media_videos SET status='ready',ready_at=? WHERE id=? AND status='uploading'").run(now, row.id);
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), 'media.video.ready', now);
    });
    return { id: row.id, url: videoUrl(origin, this.key, row) };
  }
  async list() {
    await this.authorize();
    return (await this.db.prepare("SELECT id,bytes,width,height,duration_ms,created_at FROM platform_media_videos WHERE organization_id=? AND project_id=? AND status='ready' ORDER BY created_at DESC").all(...this.args()) as Row[])
      .map(row => ({ id: row.id, bytes: row.bytes, width: row.width, height: row.height, durationMs: row.duration_ms, createdAt: row.created_at }));
  }
  async remove(id: unknown) {
    await this.authorize();
    const row = await this.row(id);
    await this.db.transaction(async () => { await this.drop(row.id); await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), 'media.video.delete', new Date().toISOString()); });
    return { removed: row.id };
  }
  private async drop(id: string) {
    await this.db.prepare('DELETE FROM platform_media_video_parts WHERE video_id=?').run(id);
    await this.db.prepare('DELETE FROM platform_media_videos WHERE id=?').run(id);
  }
  private async assemble(row: Row) {
    const parts = await this.db.prepare('SELECT part,data FROM platform_media_video_parts WHERE video_id=? ORDER BY part').all(row.id) as { part: number; data: Uint8Array }[];
    if (parts.length !== row.parts || parts.some((p, i) => Number(p.part) !== i)) throw new MarketingStoreError('Video parçaları eksik. Yüklemeyi tekrar deneyin.', 409);
    return Buffer.concat(parts.map(p => Buffer.from(p.data)));
  }
}

// Public read for the networks: only a ready video whose signature matches; nothing else about the project is exposed.
export async function publicVideo(db: Db, key: string, id: string, signature: string) {
  if (!ID.test(id) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const row = await db.prepare("SELECT * FROM platform_media_videos WHERE id=? AND status='ready'").get(id) as Row | undefined;
  if (!row || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(videoSignature(key, row), 'hex'))) return null;
  const parts = await db.prepare('SELECT data FROM platform_media_video_parts WHERE video_id=? ORDER BY part').all(id) as { data: Uint8Array }[];
  const file = Buffer.concat(parts.map(p => Buffer.from(p.data)));
  return file.length === row.bytes ? { file, sha256: row.sha256, readyAt: row.ready_at || row.created_at } : null;
}

import type { Db } from '../db/client';
import 'server-only';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ryzevoFeature } from './ryzevo-features';

// The licensed music library: tracks Ryzevo bought a licence for that also covers its customers' use (an app/SaaS
// licence), added by the server operator with scripts/music-library.cjs. Every project can list and use them in the
// design studio's videos; the licence text travels with each track.
export type MusicTrack = { id: string; title: string; artist: string; mood: string; durationMs: number | null; license: string; source: string };
const ID = /^trk_[a-f0-9]{24}$/;
async function authorize(db: Db, scope: MarketingScope) {
  const repo = new PlatformRepository(db), workspace = await repo.workspace(scope.subject, scope.organizationId, scope.projectId), pack = workspace?.project.productPack;
  if (!workspace || !(pack === 'standard' || ryzevoFeature(pack, 'brand'))) throw new MarketingStoreError('Müzik kütüphanesi için proje erişimi gerekli.', 403);
}
export async function musicTracks(db: Db, scope: MarketingScope): Promise<MusicTrack[]> {
  await authorize(db, scope);
  let rows: { id: string; title: string; artist: string; mood: string; duration_ms: number | null; license: string; source: string }[];
  // Until db:upgrade has added schema 81 the table is missing: the library is simply empty.
  try { rows = await db.prepare('SELECT id,title,artist,mood,duration_ms,license,source FROM platform_music_tracks WHERE active=1 ORDER BY mood,title').all() as typeof rows; } catch { return []; }
  return rows.map(row => ({ id: row.id, title: row.title, artist: row.artist, mood: row.mood, durationMs: row.duration_ms === null ? null : Number(row.duration_ms), license: row.license, source: row.source }));
}
export async function musicTrack(db: Db, scope: MarketingScope, id: string) {
  await authorize(db, scope);
  if (!ID.test(id)) throw new MarketingStoreError('Parça bulunamadı.', 404);
  const row = await db.prepare('SELECT mime,sha256,data FROM platform_music_tracks WHERE id=? AND active=1').get(id) as { mime: string; sha256: string; data: Uint8Array } | undefined;
  if (!row) throw new MarketingStoreError('Parça bulunamadı.', 404);
  return { mime: row.mime, sha256: row.sha256, data: Buffer.from(row.data) };
}

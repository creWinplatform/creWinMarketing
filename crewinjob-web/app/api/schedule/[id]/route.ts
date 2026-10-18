/**
 * PATCH  /api/schedule/[id]  — Zamanlanmış postu güncelle (tarih, içerik, iptal)
 * DELETE /api/schedule/[id]  — Zamanlanmış postu sil
 */
import { NextRequest, NextResponse }  from 'next/server';
import { removeScheduledPost, updateScheduledPost } from '@/lib/scheduled-posts-backend';
import { loadPosts, type ScheduledPost } from '@/lib/scheduled-posts';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const PLATFORMS = new Set(['twitter', 'linkedin', 'facebook', 'instagram', 'tiktok']);

/**
 * Yalnızca düzenlenebilir alanlar kabul edilir (mass-assignment yok: id, results, backendSync,
 * publishedAt, attempts vb. istemciden değiştirilemez). status yalnızca iptal / yeniden planlama.
 */
function sanitizePatch(raw: unknown): { patch: Partial<ScheduledPost>; error?: string } {
  const body  = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const patch: Partial<ScheduledPost> = {};

  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) return { patch, error: 'İçerik boş olamaz' };
    patch.content = body.content;
  }
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms) || !body.platforms.length || !body.platforms.every(p => typeof p === 'string' && PLATFORMS.has(p))) {
      return { patch, error: 'Geçersiz platform listesi' };
    }
    patch.platforms = body.platforms as string[];
  }
  if (body.scheduledAt !== undefined) {
    const d = new Date(String(body.scheduledAt));
    if (isNaN(d.getTime())) return { patch, error: 'Geçersiz tarih formatı' };
    patch.scheduledAt = d.toISOString();
  }
  if (body.note !== undefined) patch.note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;
  if (body.imageData !== undefined) patch.imageData = typeof body.imageData === 'string' && body.imageData ? body.imageData : undefined;
  if (body.imageMime !== undefined) patch.imageMime = typeof body.imageMime === 'string' && body.imageMime ? body.imageMime : undefined;
  if (body.perPlatformContent !== undefined) {
    const ppc = body.perPlatformContent;
    if (ppc !== null && (typeof ppc !== 'object' || Array.isArray(ppc))) return { patch, error: 'Geçersiz perPlatformContent' };
    patch.perPlatformContent = ppc
      ? Object.fromEntries(Object.entries(ppc as Record<string, unknown>)
          .filter(([k, v]) => PLATFORMS.has(k) && typeof v === 'string'))  as Record<string, string>
      : undefined;
  }
  if (body.status !== undefined) {
    // İptal veya yeniden planlama (iptal/başarısız → pending); diğer durumlar sunucunun işi
    if (body.status !== 'cancelled' && body.status !== 'pending') return { patch, error: 'Bu durum değişikliğine izin verilmiyor' };
    patch.status = body.status;
  }
  return { patch };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id }  = await params;
  const { patch, error } = sanitizePatch(await req.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Güncellenecek alan yok' }, { status: 400 });

  const current = loadPosts().find(post => post.id === id);
  if (!current) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (current.status === 'publishing') {
    return NextResponse.json({ error: 'Post şu anda yayınlanıyor — birazdan tekrar deneyin' }, { status: 409 });
  }
  if (current.status === 'published' && patch.status !== undefined) {
    return NextResponse.json({ error: 'Yayınlanmış post yeniden planlanamaz' }, { status: 409 });
  }
  if (patch.status === 'pending') {
    // Yeniden planlama: deneme sayacı sıfırlanır; önceki başarılı platform sonuçları korunur
    patch.attempts = 0;
  }

  const updated = await updateScheduledPost(id, patch);
  if (!updated) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok     = await removeScheduledPost(id);
  if (!ok) return NextResponse.json({ error: 'Post bulunamadı' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

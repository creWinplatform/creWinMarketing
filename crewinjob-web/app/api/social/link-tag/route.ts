import { NextRequest, NextResponse } from 'next/server';
import { crewinProfileLink, newCrewinShareTag, registerCrewinTag } from '@/lib/platform/crewin-links';
import { LINK_TAG } from '@/lib/platform/link-tracking-types';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Paylaşım panelinin kopyala-aç paylaşımları (LinkedIn, X, metni kopyala): panel açılırken bir rz_ etiketi alır,
// linkleri tarayıcıda etiketler (tıklama ile panoya yazma arasında istek olmaz) ve paylaşınca etiketin başlığını kaydeder.
// Instagram/TikTok açıklamasındaki linkler tıklanmaz: onlar için profil linki döner.
export async function GET() {
  return NextResponse.json({
    tag: newCrewinShareTag(),
    profiles: { instagram: crewinProfileLink('instagram'), tiktok: crewinProfileLink('tiktok') },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  if (!hasSameRequestOrigin(req)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403 });
  const body = await req.json().catch(() => null) as { tag?: unknown; title?: unknown } | null;
  if (!body || typeof body.tag !== 'string' || !LINK_TAG.test(body.tag) || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 20000) {
    return NextResponse.json({ error: 'Geçersiz etiket.' }, { status: 400 });
  }
  try { await registerCrewinTag(body.tag, 'share', body.title); } catch (err) { console.warn('[link-tags] kayıt yazılamadı:', err); }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH  /api/schedule/[id]  — Zamanlanmış postu güncelle (tarih, içerik, iptal)
 * DELETE /api/schedule/[id]  — Zamanlanmış postu sil
 */
import { NextRequest, NextResponse }  from 'next/server';
import { updatePost, deletePost }      from '@/lib/scheduled-posts';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id }  = await params;
  const patch   = await req.json();
  const updated = updatePost(id, patch);
  if (!updated) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok     = deletePost(id);
  if (!ok) return NextResponse.json({ error: 'Post bulunamadı' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

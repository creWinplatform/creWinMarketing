import { NextRequest, NextResponse } from 'next/server';
import {
  SEO_WORK_PRIORITIES, SEO_WORK_STATUSES, createSeoWorkItem, listSeoWorkItems, updateSeoWorkItem,
  type SeoWorkStatus,
} from '@/lib/seo-work-items';
import type { AuditPriority } from '@/lib/site-audit';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Tüm iş mantığı lib/seo-work-items.ts'te (dosya kilidi + atomik yazma); route yalnızca doğrular.

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json() as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function GET() {
  return NextResponse.json(listSeoWorkItems());
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  const url = text(body.url, 2000);
  const title = text(body.title, 300);
  const recommendation = text(body.recommendation, 4000);
  const priority = body.priority as AuditPriority;
  if (!url || !title || !recommendation || !SEO_WORK_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'Öneri için URL, başlık, öneri ve öncelik (high/medium/low) gerekli.' }, { status: 400 });
  }
  const item = await createSeoWorkItem({ url, title, recommendation, evidence: text(body.evidence, 8000), priority, source: 'manual' });
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  const status = body.status as SeoWorkStatus;
  if (!id || !SEO_WORK_STATUSES.includes(status)) return NextResponse.json({ error: 'Geçerli bir kayıt ve durum gerekli.' }, { status: 400 });
  const item = await updateSeoWorkItem(id, status, text(body.implementationNote, 4000) || undefined);
  if (!item) return NextResponse.json({ error: 'Öneri bulunamadı.' }, { status: 404 });
  return NextResponse.json(item);
}

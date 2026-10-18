import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// ABP standardina gecis sonrasi GET metotlari Get* onekiyle yayinlaniyor.
const GET_ENDPOINTS = new Set([
  'GetBekleyenSiparisler',
  'BekleyenSiparisler',
  'GetFirmaAra',
  'GetFirmaDurum',
  'GetHareketGecmisi',
  'GetOdemeListesi',
  'GetOzet',
]);

const POST_ENDPOINTS = new Set([
  'OdemeKaydet',
  'HakTanimla',
  'HareketIptal',
  'HavaleSiparisiOnayla',
  'HavaleSiparisiIptal',
  'DekontYukle',
]);

const ALLOWED_RECEIPT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

// Dosya imzası (magic bytes) → gerçek tip. Bildirilen MIME tipine güvenilmez.
const RECEIPT_SIGNATURES: Array<{ type: string; ext: string; bytes: number[] }> = [
  { type: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },                   // %PDF-
  { type: 'image/jpeg',      ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png',       ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function sniffReceiptType(buffer: Buffer): { type: string; ext: string } | null {
  const match = RECEIPT_SIGNATURES.find(sig => buffer.length >= sig.bytes.length && sig.bytes.every((byte, i) => buffer[i] === byte));
  return match ? { type: match.type, ext: match.ext } : null;
}

/** Yol ayırıcı/kontrol karakterlerini temizler ve uzantıyı gerçek tiple eşler. */
function safeReceiptName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() || 'dekont').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9ğüşıöçĞÜŞİÖÇ ._-]/g, '_').trim().slice(0, 100) || 'dekont';
  return `${base}.${ext}`;
}

function endpointOf(params: { endpoint?: string[] }) {
  return (params.endpoint || []).join('/');
}

function errorResponse(err: unknown) {
  const status = typeof err === 'object' && err && 'status' in err && typeof err.status === 'number'
    ? err.status
    : 500;
  const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ endpoint?: string[] }> }) {
  const endpoint = endpointOf((await ctx.params));
  if (!GET_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Desteklenmeyen kredi yönetimi endpointi' }, { status: 404 });
  }

  try {
    const api = agentModule<{
      firmaKrediGet: (endpoint: string, params: Record<string, string>) => Promise<unknown>;
    }>('modules/api.js');
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const result = await api.firmaKrediGet(endpoint, params);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ endpoint?: string[] }> }) {
  const endpoint = endpointOf((await ctx.params));
  if (!POST_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Desteklenmeyen kredi yönetimi endpointi' }, { status: 404 });
  }

  try {
    const api = agentModule<{
      firmaKrediPost: (endpoint: string, body: Record<string, unknown>) => Promise<unknown>;
      firmaKrediDekontYukle: (fileBuffer: Buffer, fileName: string) => Promise<unknown>;
    }>('modules/api.js');

    if (endpoint === 'DekontYukle') {
      let formData: FormData;
      try { formData = await req.formData(); } catch { return NextResponse.json({ error: 'Geçersiz form verisi' }, { status: 400 }); }
      const file = formData.get('dosya') ?? formData.get('file');
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'Dekont dosyası bulunamadı' }, { status: 400 });
      }
      if (file.size === 0) {
        return NextResponse.json({ error: 'Dekont dosyası boş' }, { status: 400 });
      }
      if (file.size > MAX_RECEIPT_SIZE) {
        return NextResponse.json({ error: 'Dekont dosyası en fazla 10MB olabilir' }, { status: 400 });
      }
      // Tip zorunlu (boş tip artık kontrolü atlamıyor) ve içerik imzasıyla aynı olmalı
      if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
        return NextResponse.json({ error: 'Dekont sadece PDF, JPG veya PNG olabilir' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffReceiptType(buffer);
      if (!sniffed || sniffed.type !== file.type) {
        return NextResponse.json({ error: 'Dekont içeriği PDF, JPG veya PNG değil (dosya tipi ile içerik uyuşmuyor)' }, { status: 400 });
      }
      const fileName = safeReceiptName((file as File).name || 'dekont', sniffed.ext);
      const result = await api.firmaKrediDekontYukle(buffer, fileName);
      return NextResponse.json({ result });
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json() as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
    }
    const result = await api.firmaKrediPost(endpoint, body);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

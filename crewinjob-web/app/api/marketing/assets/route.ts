import { NextRequest, NextResponse } from 'next/server';
import { backendStatus, marketingBackend } from '@/lib/marketing-backend';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  try {
    const result = await marketingBackend().marketingAssetGet(params.id ? 'Get' : 'GetAll', params);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Varlıklar alınamadı.' }, { status: backendStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(await marketingBackend().marketingAssetPost('Upload', await req.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Varlık yüklenemedi.' }, { status: backendStatus(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return NextResponse.json(await marketingBackend().marketingAssetDelete('Delete', { id: req.nextUrl.searchParams.get('id') }) ?? { ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Varlık silinemedi.' }, { status: backendStatus(error) });
  }
}

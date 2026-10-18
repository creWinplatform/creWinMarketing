import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// POST /api/cv/upload  — multipart/form-data, dosya alanı: "file" veya "dosya"
// Query params (opsiyonel): belgeKaynakTipi, forceOcr, islemBaslat, userId
//
// ÖNEMLİ: Bu proxy, CV'yi backend'e (GemiAdamiGenel/UploadAndParseCV) panelin SERVİS HESABI
// token'ıyla gönderir. Backend parse/profil işlemini login olan kullanıcı (servis hesabı)
// bağlamında yapar — belirli bir gemi adamının profiline yazılması bu proxy ile garanti DEĞİL.
// Şu an hiçbir UI bu route'u kullanmıyor; güvenli kalsın diye boyut ve tür sınırı uygulanır.

const MAX_CV_BYTES = 10 * 1024 * 1024; // 10 MB

// Uzantı → kabul edilen MIME tipleri (tarayıcı bazen boş/genel tip gönderir)
const ALLOWED_TYPES: Record<string, string[]> = {
  pdf:  ['application/pdf'],
  doc:  ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  jpg:  ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png:  ['image/png'],
};
const GENERIC_TYPES = new Set(['', 'application/octet-stream']);

export async function POST(request: NextRequest) {
  try {
    // Gövdeyi okumadan önce bildirilen boyutu kontrol et (multipart ek yükü için küçük pay)
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared && declared > MAX_CV_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'Dosya en fazla 10 MB olabilir' }, { status: 413 });
    }

    const formData = await request.formData();
    const file = formData.get('file') ?? formData.get('dosya');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Dosya bulunamadı (file veya dosya alanı gerekli)' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Dosya boş' }, { status: 400 });
    }
    if (file.size > MAX_CV_BYTES) {
      return NextResponse.json({ error: 'Dosya en fazla 10 MB olabilir' }, { status: 413 });
    }

    const rawName  = (file as File).name || 'cv.pdf';
    // Yol ayırıcı / kontrol karakteri içermeyen sade dosya adı
    const fileName = rawName.replace(/[\\/\0-\x1f]/g, '_').slice(-120) || 'cv.pdf';
    const ext      = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    const allowedMimes = ALLOWED_TYPES[ext];
    const mime = (file.type || '').toLowerCase();
    if (!allowedMimes || (!GENERIC_TYPES.has(mime) && !allowedMimes.includes(mime))) {
      return NextResponse.json({ error: 'Desteklenmeyen dosya türü — yalnızca PDF, DOC, DOCX, JPG veya PNG' }, { status: 415 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    const opts = {
      belgeKaynakTipi: request.nextUrl.searchParams.get('belgeKaynakTipi') ?? 1,
      forceOcr:        request.nextUrl.searchParams.get('forceOcr') === 'true',
      islemBaslat:     request.nextUrl.searchParams.get('islemBaslat') !== 'false', // varsayılan true
    };

    const userIdParam = request.nextUrl.searchParams.get('userId');
    const userId = userIdParam && /^\d+$/.test(userIdParam) ? Number(userIdParam) : undefined;

    const api    = agentModule('modules/api.js');
    const result = await api.uploadAndParseCV(buf, fileName, opts);

    // Aktivasyon event tracking — best-effort, yükleme sonucunu bloklamaz
    if (userId) {
      const eventName = result?.status === 'success'
        ? 'cv_parse_succeeded'
        : result?.failedFields?.length ? 'cv_parse_partial' : 'cv_uploaded';
      void api.trackActivationEvent(eventName, userId, { fileName, confidence: result?.confidence }).catch(() => null);
    }

    return NextResponse.json({
      result,
      note: 'CV servis hesabı token\'ıyla backend\'e iletildi; backend parse işlemini servis hesabı bağlamında yapar.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

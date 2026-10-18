import { NextResponse } from 'next/server';
import path from 'path';
import { readJson } from '@/lib/json-store';
import { publishToSocial, recordPublishedPosts } from '@/lib/scheduled-posts-backend';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

/**
 * POST /api/scheduler/run
 * Bugünün takvim etkinliklerini alır ve yayınlanmamışlarını sosyal medyaya gönderir.
 *
 * Body: { events: CalendarEventWithContent[] }
 * CalendarEventWithContent = { id, date, platform, content, language, published, imageData?, imageMime?, imageUrl? }
 *
 * "Bugün" APP_TIMEZONE'a göre hesaplanır (istemcideki yerel tarih anahtarlarıyla aynı gün).
 * Etkinliğin görseli varsa (istekte ya da yerel takvim kopyasında) post görselli gider.
 * Başarılı paylaşımlar paylaşım geçmişine yazılır.
 * Her event için /api/social/post'a istek atar, sonuç olarak
 * { published: number, failed: number, results: {...}[] } döner.
 */

interface ScheduleEvent {
  id:         string;
  date:       string;
  platform:   string;
  content:    string;
  language:   string;
  published:  boolean;
  imageData?: string;
  imageMime?: string;
  imageUrl?:  string;
}

interface RunResult {
  eventId:  string;
  platform: string;
  success:  boolean;
  url?:     string;
  error?:   string;
}

const CALENDAR_FILE = path.join(process.cwd(), 'data', 'calendar.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** YYYY-MM-DD — verilen saat dilimindeki bugün (en-CA biçimi ISO tarih verir) */
function todayKey(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Etkinliğin görseli: istekteki base64 → yerel takvim kopyası → imageUrl (http/https) */
async function eventImage(ev: ScheduleEvent, stored?: ScheduleEvent): Promise<{ data?: string; mime?: string }> {
  const data = ev.imageData || stored?.imageData;
  if (data) return { data, mime: ev.imageMime || stored?.imageMime || 'image/png' };
  const url = ev.imageUrl || stored?.imageUrl;
  if (!url || !/^https?:\/\//i.test(url)) return {};
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return {};
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return {};
    return { data: buf.toString('base64'), mime: res.headers.get('content-type') || 'image/jpeg' };
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  try {
    const { events } = await req.json() as { events: ScheduleEvent[] };

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'Gönderilecek etkinlik yok.' }, { status: 400 });
    }

    // Sadece bugünün yayınlanmamış etkinlikleri (UTC değil, uygulama saat dilimi)
    const today = todayKey(process.env.APP_TIMEZONE || 'Europe/Istanbul');
    const toRun = events.filter(e => e.date === today && !e.published);

    if (toRun.length === 0) {
      return NextResponse.json({ published: 0, failed: 0, results: [], message: 'Bugün için bekleyen etkinlik yok.' });
    }

    const storedById = new Map(readJson<ScheduleEvent[]>(CALENDAR_FILE, []).map(e => [e.id, e]));

    const results: RunResult[] = await Promise.all(
      toRun.map(async (ev): Promise<RunResult> => {
        try {
          const image = await eventImage(ev, storedById.get(ev.id));
          const [r]   = await publishToSocial({
            platforms: [ev.platform],
            content:   ev.content,
            imageData: image.data,
            imageMime: image.mime,
          }, 'calendar-runner');

          if (r?.success) {
            await recordPublishedPosts([r], {
              contentFor: () => ev.content,
              imageData:  image.data,
              actor:      'calendar-runner',
            });
          }
          return {
            eventId:  ev.id,
            platform: ev.platform,
            success:  r?.success ?? false,
            url:      r?.url,
            error:    r?.error,
          };
        } catch (err: unknown) {
          return {
            eventId:  ev.id,
            platform: ev.platform,
            success:  false,
            error:    err instanceof Error ? err.message : 'Bilinmeyen hata',
          };
        }
      })
    );

    const published = results.filter(r => r.success).length;
    const failed    = results.filter(r => !r.success).length;

    return NextResponse.json({ published, failed, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/scheduler/run
 * Bugünün takvim etkinliklerini alır ve yayınlanmamışlarını sosyal medyaya gönderir.
 *
 * Body: { events: CalendarEventWithContent[] }
 * CalendarEventWithContent = { id, date, platform, content, language, published }
 *
 * Her event için /api/social/post'a istek atar, sonuç olarak
 * { published: number, failed: number, results: {...}[] } döner.
 */

interface ScheduleEvent {
  id:        string;
  date:      string;
  platform:  string;
  content:   string;
  language:  string;
  published: boolean;
}

interface RunResult {
  eventId:  string;
  platform: string;
  success:  boolean;
  url?:     string;
  error?:   string;
}

export async function POST(req: Request) {
  try {
    const { events } = await req.json() as { events: ScheduleEvent[] };

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'Gönderilecek etkinlik yok.' }, { status: 400 });
    }

    // Sadece bugünün yayınlanmamış etkinlikleri
    const today = new Date().toISOString().slice(0, 10);
    const toRun = events.filter(e => e.date === today && !e.published);

    if (toRun.length === 0) {
      return NextResponse.json({ published: 0, failed: 0, results: [], message: 'Bugün için bekleyen etkinlik yok.' });
    }

    // Her etkinlik için sosyal medyaya gönder
    // origin header sunucu-taraflı/cron çağrılarında gelmez — env'den oku
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get('origin') ?? 'http://localhost:3333';

    const results: RunResult[] = await Promise.all(
      toRun.map(async (ev): Promise<RunResult> => {
        try {
          const res = await fetch(`${origin}/api/social/post`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              platforms: [ev.platform],
              content:   ev.content,
            }),
          });
          const data = await res.json();
          const r    = data.results?.[0];
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

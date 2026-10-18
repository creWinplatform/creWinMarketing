import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import {
  isRecord,
  marketingBackend,
  parseObject,
  records,
  stringValue,
  timestampValue,
} from '@/lib/marketing-backend';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'calendar.json');

interface CalendarEvent {
  id: string;
  date: string;
  platform: string;
  content: string;
  language: string;
  published: boolean;
  createdAt: number;
  campaignId?: string;
  timezone?: string;
  title?: string;
  // Görsel yalnızca yerel kopyada tutulur (backend payload'ına gitmez) — scheduler/run bununla paylaşır
  imageData?: string;
  imageMime?: string;
  imageUrl?: string;
}

// Read-modify-write işlemleri withFileLock(FILE) altında, await'ten sonra yeniden okunarak yapılır.
function load(): CalendarEvent[] {
  const list = readJson<CalendarEvent[]>(FILE, []);
  return Array.isArray(list) ? list : [];
}

function save(events: CalendarEvent[]) {
  writeJsonAtomic(FILE, events);
}

function normalize(raw: Record<string, unknown>, local?: CalendarEvent): CalendarEvent {
  const metadata = parseObject(raw.metadata);
  const startAt = stringValue(raw.startAt, local?.date || new Date().toISOString());
  return {
    ...(local || {} as CalendarEvent),
    id: stringValue(raw.id, local?.id || ''),
    date: startAt.slice(0, 10),
    platform: stringValue(metadata.platform, local?.platform || 'instagram'),
    content: stringValue(metadata.content, stringValue(raw.description, local?.content || '')),
    language: stringValue(metadata.language, local?.language || 'tr'),
    published: Boolean(raw.isPublished ?? raw.published ?? local?.published),
    createdAt: timestampValue(raw.creationTime, local?.createdAt),
    campaignId: stringValue(raw.campaignId, local?.campaignId) || undefined,
    timezone: stringValue(raw.timezone, local?.timezone || 'Europe/Istanbul'),
    title: stringValue(raw.title, local?.title) || undefined,
  };
}

function payload(event: CalendarEvent) {
  const startAt = new Date(`${event.date}T09:00:00`);
  return {
    id: /^\d+$/.test(event.id) ? Number(event.id) : null,
    title: event.title || `${event.platform} içeriği`,
    description: event.content,
    eventType: 'social_post',
    campaignId: event.campaignId || null,
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 30 * 60 * 1000).toISOString(),
    timezone: event.timezone || 'Europe/Istanbul',
    allDay: true,
    color: '#0ea5e9',
    metadata: { platform: event.platform, content: event.content, language: event.language },
  };
}

async function allEvents(): Promise<CalendarEvent[]> {
  const local = load();
  try {
    const result = await marketingBackend().marketingCalendarGet('GetAll', {
      skipCount: 0,
      maxResultCount: 500,
    });
    return await withFileLock(FILE, () => {
      const current   = load();   // backend beklenirken yapılan yerel değişiklikler kaybolmasın
      const localById = new Map(current.map(item => [item.id, item]));
      const remote    = records(result).map(item => normalize(item, localById.get(stringValue(item.id))));
      const ids       = new Set(remote.map(item => item.id));
      const merged    = [...remote, ...current.filter(item => !ids.has(item.id))]
        .sort((a, b) => a.date.localeCompare(b.date));
      if (JSON.stringify(merged) !== JSON.stringify(current)) save(merged);
      return merged;
    });
  } catch {
    return local;
  }
}

export async function GET() {
  return NextResponse.json(await allEvents());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Omit<CalendarEvent, 'id' | 'createdAt'>;
  let event: CalendarEvent = {
    ...body,
    id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  try {
    const result = await marketingBackend().marketingCalendarPost('CreateOrUpdate', payload(event));
    if (isRecord(result)) event = normalize(result, event);
  } catch { /* takvim girdisi yerel olarak kullanılmaya devam eder */ }
  await withFileLock(FILE, () => save([...load().filter(item => item.id !== event.id), event]));
  return NextResponse.json(await allEvents());
}

export async function PATCH(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const action = params.get('action');
  const current = load().find(event => event.id === id);
  if (!current || !id) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });

  // Backend çağrısı kilit dışında; yerel yazım kilit altında ve güncel listeye uygulanır
  let patch: Partial<CalendarEvent>;
  if (action === 'toggle') {
    const published = !current.published;
    if (published && /^\d+$/.test(id)) {
      try { await marketingBackend().marketingCalendarPost('Publish', { id }); } catch { /* UI yerel durumda kalır */ }
    } else if (!published && /^\d+$/.test(id)) {
      try {
        await marketingBackend().marketingCalendarPost('CreateOrUpdate', { ...payload(current), isPublished: false });
      } catch { /* UI yerel durumda kalır */ }
    }
    patch = { published };
  } else {
    const body = await req.json() as Partial<CalendarEvent>;
    let updated: CalendarEvent = { ...current, ...body, id };
    try {
      const result = await marketingBackend().marketingCalendarPost('CreateOrUpdate', payload(updated));
      if (isRecord(result)) updated = normalize(result, updated);
    } catch { /* local mirror */ }
    patch = updated;
  }
  const events = await withFileLock(FILE, () => {
    const list  = load();
    const index = list.findIndex(event => event.id === id);
    if (index === -1) return list;
    list[index] = { ...list[index], ...patch, id: patch.id || id };
    save(list);
    return list;
  });
  return NextResponse.json(events);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (id && /^\d+$/.test(id)) {
    try { await marketingBackend().marketingCalendarDelete('Delete', { id }); } catch { /* local silme yine uygulanır */ }
  }
  if (id) await withFileLock(FILE, () => save(load().filter(event => event.id !== id)));
  return NextResponse.json(await allEvents());
}

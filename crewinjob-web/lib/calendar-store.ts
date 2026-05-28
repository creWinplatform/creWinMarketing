/**
 * İçerik takvimi — sunucu taraflı JSON (data/calendar.json)
 * Tüm fonksiyonlar async; /api/data/calendar ile iletişim kurar.
 */

export interface CalendarEvent {
  id:        string;
  date:      string;
  platform:  string;
  content:   string;
  language:  string;
  published: boolean;
  createdAt: number;
}

const BASE = '/api/data/calendar';

export async function getEvents(): Promise<CalendarEvent[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    return await res.json() as CalendarEvent[];
  } catch { return []; }
}

export async function addEvent(e: Omit<CalendarEvent, 'id' | 'createdAt'>): Promise<CalendarEvent[]> {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(e),
  });
  return await res.json() as CalendarEvent[];
}

export async function removeEvent(id: string): Promise<CalendarEvent[]> {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return await res.json() as CalendarEvent[];
}

export async function togglePublished(id: string): Promise<CalendarEvent[]> {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}&action=toggle`, { method: 'PATCH' });
  return await res.json() as CalendarEvent[];
}

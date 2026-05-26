const CALENDAR_KEY = 'crewinjob_calendar';

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  platform: string;
  content: string;
  language: string;
  published: boolean;
  createdAt: number;
}

export function getEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(CALENDAR_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CalendarEvent[];
  } catch {
    return [];
  }
}

export function addEvent(e: Omit<CalendarEvent, 'id' | 'createdAt'>): CalendarEvent[] {
  const existing = getEvents();
  const newEvent: CalendarEvent = {
    ...e,
    id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const updated = [...existing, newEvent];
  try {
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}

export function removeEvent(id: string): CalendarEvent[] {
  const updated = getEvents().filter(ev => ev.id !== id);
  try {
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}

export function togglePublished(id: string): CalendarEvent[] {
  const updated = getEvents().map(ev =>
    ev.id === id ? { ...ev, published: !ev.published } : ev
  );
  try {
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}

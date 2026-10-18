'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  CalendarDays,
  Plus,
  Save,
  X,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import type { WorkItem } from '@/lib/platform/operations';
import type { UnifiedCampaign } from '@/lib/campaigns';
import type { OperationsSummary } from './ProjectOverview';
import { projectRequest, projectDateKey } from '@/lib/platform/client';
const SocialPublicationCenter=dynamic(()=>import('./SocialPublicationCenter'));
const blank = {
  title: '',
  campaignId: '',
  dueAt: '',
  status: 'planned',
  note: '',
};
export default function ProjectPlanning({
  workspace,
  lang,
}: {
  workspace: WorkspaceContext;
  lang: Locale;
}) {
  const tr = lang === 'tr',
    canWrite = workspace.permissions?.includes('content.write'),
    [items, setItems] = useState<WorkItem[]>([]),
    [campaigns, setCampaigns] = useState<UnifiedCampaign[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(blank),
    [editing, setEditing] = useState<string | null>(null),
    [show, setShow] = useState(false),
    [filter, setFilter] = useState('active'),
    [month, setMonth] = useState(() => new Date());
  const [view,setView]=useState<'work'|'social'>('work');
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('planning')==='social')setView('social');},[]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectRequest<OperationsSummary>(
        '/api/platform/operations',
      );
      setItems(data.tasks);
      const list = await projectRequest<{ items: UnifiedCampaign[] }>(
        '/api/campaigns',
      );
      setCampaigns(list.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const dateValue =
      (event.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>(
        'input[type="datetime-local"]',
      )?.value || form.dueAt;
    setBusy(true);
    setError('');
    try {
      const date = new Date(dateValue);
      if (!Number.isFinite(date.getTime()))
        throw new Error(
          tr
            ? 'Geçerli bir tarih ve saat seçin.'
            : 'Choose a valid date and time.',
        );
      await projectRequest('/api/platform/operations?resource=tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          ...(editing ? { id: editing } : {}),
          dueAt: date.toISOString(),
        }),
      });
      setShow(false);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const edit = (item: WorkItem) => {
    const date = new Date(item.dueAt);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setForm({
      title: item.title,
      campaignId: item.campaignId || '',
      dueAt: date.toISOString().slice(0, 16),
      status: item.status,
      note: item.note,
    });
    setEditing(item.id);
    setShow(true);
  };
  const statuses = {
    planned: tr ? 'Planlandı' : 'Planned',
    in_progress: tr ? 'Devam ediyor' : 'In progress',
    completed: tr ? 'Tamamlandı' : 'Completed',
    cancelled: tr ? 'İptal edildi' : 'Cancelled',
  };
  const visible = items.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'active'
        ? ['planned', 'in_progress'].includes(item.status)
        : item.status === filter),
  );
  const start = new Date(month.getFullYear(), month.getMonth(), 1),
    offset = (start.getDay() + 6) % 7,
    last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const projectDate = (date: Date) => projectDateKey(date,workspace.project.timezone);
  return (
    <section>
      <div className="publication-view-tabs" role="tablist" aria-label={tr?'Takvim görünümü':'Calendar view'} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setView(view==='work'?'social':'work');const tabs=event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]');tabs[view==='work'?1:0]?.focus();}}}>
        <button role="tab" aria-selected={view==='work'} tabIndex={view==='work'?0:-1} onClick={()=>setView('work')}>{tr?'İş planı':'Work plans'}</button>
        <button role="tab" aria-selected={view==='social'} tabIndex={view==='social'?0:-1} onClick={()=>setView('social')}>{tr?'Sosyal yayınlar':'Social publications'}</button>
      </div>
      {view==='social'?<SocialPublicationCenter workspace={workspace} lang={lang}/>:<>
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{tr ? 'OPERASYON' : 'OPERATIONS'}</p>
          <h1>{tr ? 'İş takvimi' : 'Work calendar'}</h1>
          <p className="studio-subtitle">
            {workspace.project.timezone} ·{' '}
            {tr
              ? 'İş planı, otomatik gönderim değildir.'
              : 'Work plans do not automatically send messages.'}
          </p>
        </div>
        {canWrite && (
          <button
            className="studio-primary"
            onClick={() => {
              setForm(blank);
              setEditing(null);
              setShow(true);
            }}
          >
            <Plus size={16} />
            {tr ? 'İş planla' : 'Plan work'}
          </button>
        )}
      </header>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      {show && (
        <form onSubmit={save} className="studio-editor">
          <div className="studio-section-title">
            <h2>
              {editing
                ? tr
                  ? 'İşi düzenle'
                  : 'Edit task'
                : tr
                  ? 'Yeni iş'
                  : 'New task'}
            </h2>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShow(false)}
              aria-label={tr ? 'Kapat' : 'Close'}
              title={tr ? 'Kapat' : 'Close'}
            >
              <X size={18} />
            </button>
          </div>
          <div className="studio-form-grid">
            <label>
              {tr ? 'İş adı' : 'Task title'}
              <input
                required
                maxLength={160}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </label>
            <label>
              {tr
                ? 'Tarih ve saat (cihaz saat dilimi)'
                : 'Date & time (device timezone)'}
              <input
                type="datetime-local"
                required
                value={form.dueAt}
                onChange={(event) =>
                  setForm({ ...form, dueAt: event.target.value })
                }
              />
            </label>
            <label>
              {tr ? 'Kampanya' : 'Campaign'}
              <select
                value={form.campaignId}
                onChange={(event) =>
                  setForm({ ...form, campaignId: event.target.value })
                }
              >
                <option value="">
                  {tr ? 'Bağımsız iş' : 'Independent task'}
                </option>
                {campaigns.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr ? 'Durum' : 'Status'}
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value })
                }
              >
                {Object.entries(statuses).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-form-full">
              {tr ? 'İş notu' : 'Task note'}
              <textarea
                maxLength={2000}
                rows={3}
                value={form.note}
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
              />
            </label>
          </div>
          <div className="studio-form-actions">
            <button
              type="button"
              className="studio-secondary"
              onClick={() => setShow(false)}
            >
              {tr ? 'Vazgeç' : 'Cancel'}
            </button>
            <button className="studio-primary" disabled={busy}>
              <Save size={16} />
              {busy
                ? tr
                  ? 'Kaydediliyor…'
                  : 'Saving…'
                : tr
                  ? 'Kaydet'
                  : 'Save'}
            </button>
          </div>
        </form>
      )}
      <div className="studio-calendar-toolbar">
        <div className="flex items-center gap-3">
          <button
            className="icon-button"
            aria-label={tr ? 'Önceki ay' : 'Previous month'}
            title={tr ? 'Önceki ay' : 'Previous month'}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <h2>
            {month.toLocaleDateString(tr ? 'tr-TR' : 'en-GB', {
              month: 'long',
              year: 'numeric',
            })}
          </h2>
          <button
            className="icon-button"
            aria-label={tr ? 'Sonraki ay' : 'Next month'}
            title={tr ? 'Sonraki ay' : 'Next month'}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <label className="studio-filter">
          <span className="sr-only">
            {tr ? 'Durum filtresi' : 'Status filter'}
          </span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="active">
              {tr ? 'Aktif işler' : 'Active tasks'}
            </option>
            <option value="all">{tr ? 'Tüm işler' : 'All tasks'}</option>
            <option value="completed">{statuses.completed}</option>
            <option value="cancelled">{statuses.cancelled}</option>
          </select>
        </label>
      </div>
      <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr ? 'Aylık iş takvimi' : 'Monthly work calendar'}>
      <div
        className="studio-month-grid"
        aria-label={tr ? 'Aylık takvim' : 'Monthly calendar'}
      >
        {(tr
          ? ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
          : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        ).map((day) => (
          <div className="calendar-day-name" key={day}>
            {day}
          </div>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <div key={`empty${index}`} className="calendar-empty-day" />
        ))}
        {Array.from({ length: last }, (_, index) => {
          const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
            dayItems = visible.filter(
              (item) => projectDate(new Date(item.dueAt)) === key,
            );
          return (
            <div
              key={index}
              className={`calendar-date-cell ${key === projectDate(new Date()) ? 'calendar-today' : ''}`}
            >
              <span>{index + 1}</span>
              {dayItems.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  disabled={!canWrite}
                  onClick={() => edit(item)}
                  title={item.title}
                >
                  {item.title}
                </button>
              ))}
              {dayItems.length > 2 && <small>+{dayItems.length - 2}</small>}
            </div>
          );
        })}
      </div>
      </div>
      <section className="studio-band mt-6">
        <div className="studio-section-title">
          <h2>{tr ? 'İş listesi' : 'Task list'}</h2>
          <span className="studio-badge">{visible.length}</span>
        </div>
        {loading ? (
          <p role="status">{tr ? 'Yükleniyor…' : 'Loading…'}</p>
        ) : visible.length === 0 ? (
          <div className="studio-empty">
            <CalendarDays size={28} />
            <p>
              {tr
                ? 'Bu filtrede iş bulunamadı.'
                : 'No tasks match this filter.'}
            </p>
          </div>
        ) : (
          visible.map((item) => (
            <article key={item.id} className="studio-task-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{item.title}</strong>
                  <span
                    className={`studio-badge ${item.status === 'completed' ? 'badge-success' : ''}`}
                  >
                    {statuses[item.status]}
                  </span>
                </div>
                <p>
                  {new Date(item.dueAt).toLocaleString(tr ? 'tr-TR' : 'en-GB', {
                    timeZone: workspace.project.timezone,
                  })}
                </p>
                {item.note && <small>{item.note}</small>}
              </div>
              {canWrite && (
                <div className="flex shrink-0 gap-1">
                  <button
                    className="icon-button"
                    title={tr ? 'Düzenle' : 'Edit'}
                    aria-label={`${tr ? 'Düzenle' : 'Edit'} ${item.title}`}
                    onClick={() => edit(item)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button text-red-500"
                    title={tr ? 'Sil' : 'Delete'}
                    aria-label={`${tr ? 'Sil' : 'Delete'} ${item.title}`}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          tr
                            ? 'Bu iş planı silinsin mi?'
                            : 'Delete this work plan?',
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await projectRequest(
                          '/api/platform/operations?resource=tasks',
                          {
                            method: 'DELETE',
                            body: JSON.stringify({ id: item.id }),
                          },
                        );
                        await load();
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : 'Request failed.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </section>
      </>}
    </section>
  );
}

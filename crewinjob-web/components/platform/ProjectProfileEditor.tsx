'use client';
import { useState, type FormEvent } from 'react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { translateMessage } from '@/lib/i18n/messages';

export default function ProjectProfileEditor({ workspace, lang, onUpdate }: { workspace: WorkspaceContext; lang: Locale; onUpdate?: (workspace: WorkspaceContext) => void }) {
  const tr = lang === 'tr';
  const failed = tr ? 'İstek tamamlanamadı.' : 'Request failed.';
  const project = workspace.project;
  const [name, setName] = useState(project.name);
  const [website, setWebsite] = useState(project.website);
  const [timezone, setTimezone] = useState(project.timezone);
  const [language, setLanguage] = useState(project.language || 'tr');
  const [voice, setVoice] = useState(project.brandVoice || '');
  const [goals, setGoals] = useState(project.goals.map(goal => ({ id: goal.id, title: goal.label[lang], audience: goal.audience[lang], stages: goal.stages.map(stage => stage[lang]).join('\n') })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const localized = (text: string) => ({ tr: text.trim(), en: text.trim() });
      const response = await fetch('/api/workspace', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, website, timezone, language, brandVoice: voice,
        goals: goals.map(goal => ({ id: goal.id, label: localized(goal.title), audience: localized(goal.audience), stages: goal.stages.split('\n').map(stage => stage.trim()).filter(Boolean).map(localized) })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      onUpdate?.(data); setSaved(true);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { setBusy(false); }
  };
  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  return <details open={project.goals.length===0} className="border-t border-slate-200 pt-4 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">{tr ? 'Marka ve hedefleri düzenle' : 'Edit brand and goals'}</summary><form onSubmit={save} className="mt-4 space-y-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs">{tr ? 'Ürün adı' : 'Product name'}<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} className={input} /></label><label className="text-xs">{tr ? 'Web sitesi' : 'Website'}<input required type="url" value={website} onChange={event => setWebsite(event.target.value)} className={input} /></label><label className="text-xs">{tr ? 'Saat dilimi' : 'Timezone'}<input required value={timezone} onChange={event => setTimezone(event.target.value)} className={input} /></label><label className="text-xs">{tr ? 'İçerik dili' : 'Content language'}<select value={language} onChange={event => setLanguage(event.target.value as Locale)} className={input}><option value="tr">Türkçe</option><option value="en">English</option></select></label></div>
    <label className="block text-xs">{tr ? 'Marka dili ve tonu' : 'Brand voice'}<textarea rows={3} maxLength={2000} value={voice} onChange={event => setVoice(event.target.value)} className={input} /></label>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{tr ? 'Büyüme hedefleri' : 'Growth goals'}</h2><button disabled={goals.length >= 10 || busy} type="button" onClick={() => setGoals([...goals, { id: crypto.randomUUID(), title: '', audience: '', stages: '' }])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{tr ? 'Hedef ekle' : 'Add goal'}</button></div>
    {goals.map((goal, index) => <fieldset key={goal.id} className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700"><legend className="text-xs font-medium">{tr ? `Hedef ${index + 1}` : `Goal ${index + 1}`}</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs">{tr ? 'Hedef adı' : 'Goal name'}<input required maxLength={200} value={goal.title} onChange={event => setGoals(goals.map(item => item.id === goal.id ? { ...item, title: event.target.value } : item))} className={input} /></label><label className="text-xs">{tr ? 'Hedef kitle' : 'Audience'}<input required maxLength={200} value={goal.audience} onChange={event => setGoals(goals.map(item => item.id === goal.id ? { ...item, audience: event.target.value } : item))} className={input} /></label></div><label className="block text-xs">{tr ? 'Dönüşüm adımları (her satıra bir adım, en fazla 8)' : 'Conversion stages (one per line, up to 8)'}<textarea required rows={3} value={goal.stages} onChange={event => setGoals(goals.map(item => item.id === goal.id ? { ...item, stages: event.target.value } : item))} className={input} /></label><button type="button" onClick={() => setGoals(goals.filter(item => item.id !== goal.id))} className="text-xs text-red-600 dark:text-red-300">{tr ? 'Hedefi kaldır' : 'Remove goal'}</button></fieldset>)}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{translateMessage(error, lang)}</p>}{saved && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-300">{tr ? 'Proje ayarları kaydedildi.' : 'Project settings saved.'}</p>}
    <div className="flex justify-end"><button disabled={busy} className="studio-primary disabled:opacity-50">{tr ? 'Ayarları kaydet' : 'Save settings'}</button></div>
  </form></details>;
}

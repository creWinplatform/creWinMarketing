'use client';
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

// Two-level navigation for screens with many sections: a few plain groups first, then the sections of the chosen group
// (only when it has more than one), with one line saying what the group is for. A group opens on the section last
// used in it.
export type TabItem<T extends string> = { id: T; label: string; Icon: LucideIcon };
export type TabGroup<T extends string> = { id: string; label: string; hint: string; Icon: LucideIcon; items: TabItem<T>[] };

const memory = new Map<string, string>();
export default function GroupedTabs<T extends string>({ name, groups, value, onChange, label }: { name: string; groups: TabGroup<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const visible = groups.filter(group => group.items.length > 0);
  const active = visible.find(group => group.items.some(item => item.id === value)) || visible[0];
  const groupNav = useRef<HTMLElement>(null);
  useEffect(() => { if (active) memory.set(`${name}:${active.id}`, value); }, [name, active, value]);
  // Keeps the chosen group in view when the row scrolls sideways on a phone.
  useEffect(() => { groupNav.current?.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.id]);
  if (!active) return null;
  return <div className="grouped-tabs">
    <nav ref={groupNav} className="grouped-tabs-groups" aria-label={label}>
      {visible.map(group => <button key={group.id} type="button" aria-current={group.id === active.id ? 'page' : undefined}
        onClick={() => { const last = memory.get(`${name}:${group.id}`) as T | undefined; onChange(last && group.items.some(item => item.id === last) ? last : group.items[0].id); }}>
        <group.Icon size={16} /><span>{group.label}</span>
      </button>)}
    </nav>
    {active.hint && <p className="grouped-tabs-hint">{active.hint}</p>}
    {active.items.length > 1 && <nav className="studio-settings-tabs grouped-tabs-items" aria-label={active.label}>
      {active.items.map(item => <button key={item.id} type="button" aria-current={item.id === value ? 'page' : undefined} onClick={() => onChange(item.id)}><item.Icon size={15} />{item.label}</button>)}
    </nav>}
  </div>;
}

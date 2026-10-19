'use client';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Megaphone,
  FolderOpen,
  Users,
  RefreshCw,
  Search,
  PenLine,
  MessagesSquare,
  Bot,
  Briefcase,
  Workflow,
  ChartNoAxesCombined,
  ChartLine,
  CalendarDays,
  CreditCard,
  Settings,
  Menu,
  X,
  LogOut,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Globe2,
  Smartphone,
} from 'lucide-react';
import Brand from './Brand';
import type {
  ModuleId,
  WorkspaceContext,
  Locale,
} from '@/lib/platform/catalog';
import { LangToggle } from '@/lib/lang';
import ThemeToggle from '@/components/ThemeToggle';
import { searchText } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
const icons = {
  mobile: Smartphone,
  dashboard: LayoutDashboard,
  campaigns: Megaphone,
  library: FolderOpen,
  growth: Users,
  retention: RefreshCw,
  seo: Search,
  ads: PenLine,
  messaging: MessagesSquare,
  telegrambot: Bot,
  jobbot: Briefcase,
  pipeline: Workflow,
  analytics: ChartNoAxesCombined,
  kpi: ChartLine,
  calendar: CalendarDays,
  firma_kredi: CreditCard,
  project: Settings,
  social: MessagesSquare,
};
const groups = {
  overview: { tr: 'Çalışma alanı', en: 'Workspace' },
  marketing: { tr: 'Üretim & kampanya', en: 'Content & campaigns' },
  audience: { tr: 'Hedef kitle', en: 'Audience' },
  operations: { tr: 'Operasyon', en: 'Operations' },
  measurement: { tr: 'Ölçüm', en: 'Measurement' },
  settings: { tr: 'Yönetim', en: 'Administration' },
};
export default function WorkspaceShell({
  workspace,
  activeTab,
  onNavigate,
  lang,
  children,
  tools,
  guidance,
}: {
  workspace: WorkspaceContext;
  activeTab: ModuleId;
  onNavigate: (tab: ModuleId) => void;
  lang: Locale;
  children: ReactNode;
  tools?: ReactNode;
  guidance?: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [switcher, setSwitcher] = useState(false),
    [spaces, setSpaces] = useState<WorkspaceContext[]>([]),
    [error, setError] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null),
    focusContent = useRef(false),
    skipLink = useRef<HTMLAnchorElement>(null),
    drawer = useRef<HTMLElement>(null),
    sidebar = useRef<HTMLElement>(null),
    body = useRef<HTMLDivElement>(null),
    dock = useRef<HTMLElement>(null),
    main = useRef<HTMLElement>(null),
    tr = lang === 'tr';
  const active = workspace.modules.find((module) => module.id === activeTab);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = [skipLink.current, sidebar.current, body.current, dock.current].filter((node): node is HTMLElement => Boolean(node));
    const inert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    const focus = drawer.current?.querySelector<HTMLButtonElement>('button');
    focus?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        const nodes = Array.from(
            drawer.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,a[href]',
            ) || [],
          ),
          visible = nodes.filter(node => node.getClientRects().length > 0),
          first = visible[0],
          last = visible[visible.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        } else if (!drawer.current?.contains(document.activeElement)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    const desktop = window.matchMedia('(min-width:1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', key);
      desktop.removeEventListener('change', closeOnDesktop);
      background.forEach((node, index) => { node.inert = inert[index]; });
      const destination = !focusContent.current && opener.current?.isConnected && opener.current.getClientRects().length
        ? opener.current : main.current;
      focusContent.current = false;
      destination?.focus({ preventScroll: true });
    };
  }, [open]);
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    focusContent.current = false;
    setOpen(true);
  };
  const navigate = (id: ModuleId) => {
    focusContent.current = open;
    onNavigate(id);
    setOpen(false);
    setQuery('');
  };
  const list = workspace.modules.filter((module) =>
    searchText(module.label[lang],lang).includes(searchText(query,lang)),
  );
  const menu = (
    <>
      <a href="/welcome" className="workspace-brand">
        <Brand compact inverse />
      </a>
      <button
        className="workspace-project"
        onClick={async () => {
          setSwitcher(!switcher);
          setError('');
          if (!switcher) {
            try {
              const response = await fetch('/api/platform/organizations', {
                cache: 'no-store',
              });
              if (!response.ok) throw new Error();
              const data = await response.json();
              setSpaces(data.items || data.workspaces || data);
            } catch {
              setError(
                tr ? 'Projeler yüklenemedi.' : 'Could not load projects.',
              );
            }
          }
        }}
        aria-expanded={switcher}
      >
        <span className="project-avatar">
          {workspace.project.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-semibold">
            {workspace.project.name}
          </span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {workspace.organization.name}
          </span>
        </span>
        <ChevronDown size={14} />
      </button>
      {switcher && (
        <div className="workspace-switcher">
          {error ? (
            <p role="alert"><Msg text={error}/></p>
          ) : (
            spaces.map((space) => (
              <button
                key={space.project.id}
                disabled={space.project.id === workspace.project.id}
                onClick={async () => {
                  setError('');
                  try {
                    const response = await fetch('/api/workspace', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        organizationId: space.organization.id,
                        projectId: space.project.id,
                      }),
                    });
                    if (!response.ok) throw new Error();
                    window.location.href = '/';
                  } catch {
                    setError(
                      tr
                        ? 'Proje değiştirilemedi.'
                        : 'Could not switch project.',
                    );
                  }
                }}
              >
                {space.project.name}
              </button>
            ))
          )}
        </div>
      )}
      <label className="workspace-search">
        <Search size={15} />
        <input
          aria-label={tr ? 'Araç ara' : 'Search tools'}
          placeholder={tr ? 'Araç ara…' : 'Search tools…'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav
        aria-label={tr ? 'Ana navigasyon' : 'Main navigation'}
        className="workspace-navigation"
      >
        {Object.entries(groups).map(([group, label]) => {
          const modules = list.filter((module) => module.group === group);
          return (
            modules.length > 0 && (
              <div key={group} className="nav-group">
                <p>{label[lang]}</p>
                {modules.map((module) => {
                  const Icon = icons[module.id as ModuleId];
                  return (
                    <button
                      key={module.id}
                      aria-current={
                        activeTab === module.id ? 'page' : undefined
                      }
                      onClick={() => navigate(module.id as ModuleId)}
                      title={module.label[lang]}
                    >
                      <Icon size={18} />
                      <span>{module.label[lang]}</span>
                      {activeTab === module.id && (
                        <span className="nav-active-dot" />
                      )}
                    </button>
                  );
                })}
              </div>
            )
          );
        })}
        {list.length === 0 && (
          <p className="px-3 text-sm text-slate-500">
            {tr ? 'Araç bulunamadı.' : 'No tools found.'}
          </p>
        )}
      </nav>
      <div className="workspace-sidebar-footer">
        <span className="status-dot" />
        <span>
          {workspace.project.productPack === 'crewin'
            ? (tr ? 'Crewin çalışma alanı' : 'Crewin workspace')
            : tr
              ? 'Ryzevo çalışma alanı'
              : 'Ryzevo workspace'}
        </span>
        <a
          href="/welcome"
          title={tr ? 'Ürün sayfası' : 'Product website'}
          aria-label={tr ? 'Ürün sayfası' : 'Product website'}
        >
          <ArrowUpRight size={16} />
        </a>
      </div>
    </>
  );
  return (
    <div className="workspace-shell" lang={lang}>
      <a ref={skipLink} href="#workspace-main" className="skip-link">
        {tr ? 'İçeriğe geç' : 'Skip to content'}
      </a>
      <aside ref={sidebar} className="workspace-sidebar">{menu}</aside>
      {open && (
        <div className="workspace-mobile-overlay">
          <button
            className="workspace-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <aside
            id="workspace-mobile-navigation"
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label={tr ? 'Navigasyon' : 'Navigation'}
            className="workspace-mobile-drawer"
          >
            <button
              className="icon-button drawer-close"
              aria-label={tr ? 'Menüyü kapat' : 'Close menu'}
              title={tr ? 'Menüyü kapat' : 'Close menu'}
              onClick={() => setOpen(false)}
            >
              <X size={19} />
            </button>
            {menu}
          </aside>
        </div>
      )}
      <div ref={body} className="workspace-body">
        <header className="workspace-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="icon-button workspace-menu-toggle"
              onClick={openMenu}
              aria-label={tr ? 'Menüyü aç' : 'Open menu'}
              title={tr ? 'Menüyü aç' : 'Open menu'}
              aria-expanded={open}
              aria-controls={open ? 'workspace-mobile-navigation' : undefined}
            >
              <Menu size={20} />
            </button>
            <div className="workspace-breadcrumb"><span>{workspace.project.name}</span><ChevronRight size={14} /><strong>{active?.label[lang]}</strong></div>
          </div>
          <div className="workspace-header-actions">
            {guidance}
            {tools && <div className="workspace-header-tools">{tools}</div>}
            <LangToggle />
            <ThemeToggle />
            <button
              className="icon-button"
              title={tr ? 'Çıkış yap' : 'Sign out'}
              aria-label={tr ? 'Çıkış yap' : 'Sign out'}
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main ref={main} id="workspace-main" className="workspace-main" tabIndex={-1}>
          <div className="workspace-page-context"><span><Globe2 size={14} />{new URL(workspace.project.website).hostname}</span><span>{workspace.project.productPack === 'crewin' ? (tr ? 'Crewin çalışma alanı' : 'Crewin workspace') : (tr ? 'Ryzevo çalışma alanı' : 'Ryzevo workspace')}</span></div>
          {workspace.plan?.id==='trial'&&<aside className="workspace-trial-notice" role="status"><span>{workspace.plan.active&&Date.parse(workspace.plan.endsAt||'')>Date.now()?(tr?`Deneme bitişi: ${new Date(workspace.plan.endsAt!).toLocaleDateString(localeTag(lang),{timeZone:'UTC'})} UTC. Gerçek gönderim kapalı.`:`Trial ends: ${new Date(workspace.plan.endsAt!).toLocaleDateString(localeTag(lang),{timeZone:'UTC'})} UTC. Live delivery is disabled.`):(tr?'Deneme süreniz doldu. Kayıtlarınız korunuyor; yeni üretim kapalı.':'Your trial has ended. Your records are preserved; new production is disabled.')}</span><a className="studio-text-button" href="/?tab=project&settings=plan">{tr?'Plan & kullanım':'Plan & usage'}<ArrowUpRight size={14}/></a></aside>}
          {children}
        </main>
        <footer className="workspace-footer">
          <span>
            {workspace.organization.name} · {workspace.project.name}
          </span>
          <a href={workspace.project.website} target="_blank" rel="noreferrer">
            {new URL(workspace.project.website).hostname}
            <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
      <nav ref={dock} className="ryz-mobile-dock" aria-label={tr ? 'Hızlı navigasyon' : 'Quick navigation'}>
        {(['dashboard', 'campaigns', 'library', 'calendar'] as ModuleId[]).filter(id => workspace.modules.some(module => module.id === id)).map(id => {
          const module = workspace.modules.find(item => item.id === id)!;
          const Icon = icons[id];
          const shortLabel = {dashboard:tr?'Genel bakış':'Overview',campaigns:tr?'Kampanya':'Campaigns',library:tr?'İçerik':'Content',calendar:tr?'Takvim':'Calendar'}[id as 'dashboard'|'campaigns'|'library'|'calendar'];
          return <button key={id} aria-label={module.label[lang]} aria-current={activeTab === id ? 'page' : undefined} onClick={() => navigate(id)} title={module.label[lang]}><Icon size={19} /><span>{shortLabel}</span></button>;
        })}
        <button onClick={openMenu} aria-expanded={open} aria-controls={open ? 'workspace-mobile-navigation' : undefined} title={tr ? 'Tüm araçlar' : 'All tools'}><Menu size={19} /><span>{tr ? 'Diğer' : 'More'}</span></button>
      </nav>
    </div>
  );
}

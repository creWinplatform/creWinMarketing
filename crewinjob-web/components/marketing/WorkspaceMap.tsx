'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Fingerprint, Mail, Megaphone, PenLine, Search, Share2, Target, X } from 'lucide-react';
import type { Lang } from '@/lib/i18n/shared';

// Landing hero: ürünün çevresinde modül haritası. Düğüme tıklanınca harita o modüle yakınlaşır ve
// örnek ekranı açılır. Tüm veriler örnektir ("Örnek proje verileri"); gerçek müşteri verisi yoktur.
// Metinler iki dillidir: { tr, en }. Dil, sayfadan (sunucu) prop olarak gelir.

type ModuleKey = 'measure' | 'profile' | 'goals' | 'content' | 'campaign' | 'social' | 'email' | 'seo' | 'calendar';
type L = { tr: string; en: string };
type T = (tr: string, en: string) => string;
const l = (tr: string, en: string): L => ({ tr, en });

type ModuleDef = {
  key: ModuleKey;
  n: string;
  icon: ReactNode;
  title: L;
  sub: L;
  x: number; // sahne içinde yüzde: satırlar dikeyde ayrık, aynı satırdakiler yatayda ayrık kalır
  y: number;
  detailTitle: L;
  detailText: L;
  points: L[];
  screen: (name: string, t: T) => ReactNode;
};

const Tiles = ({ items }: { items: Array<{ l: string; v: string; s: string; tone?: 'none' | 'goal' }> }) => (
  <div className="rm-tiles">
    {items.map(t => <div key={t.l} className={`rm-tile${t.tone ? ` rm-tile-${t.tone}` : ''}`}>{t.l}<b>{t.v}</b>{t.s}</div>)}
  </div>
);

const I = 15;
const DEFAULT_NAME = 'Northstar';
const NAME_KEY = 'ryzevo_demo_product_name';

const MODULES: ModuleDef[] = [
  { key: 'measure', n: '', icon: <Target size={16} />, title: l('Ürünün', 'Your product'), sub: l('Hedef: ücretli müşteri · Ölçüm: 3 aşama', 'Goal: paying customer · Measurement: 3 stages'), x: 50, y: 50,
    detailTitle: l('Veriye dayalı ölçüm', 'Data-based measurement'),
    detailText: l('Bağlanan kaynaklardan veya tarihli manuel kayıtlardan ürünün kendi dönüşüm aşamalarını izleme. Bağlanmamış servisler için veri üretilmez.', 'Track your product’s own conversion stages from connected sources or dated manual records. No data is generated for services that aren’t connected.'),
    points: [l('Tarihli, kaynağı belli kayıtlar', 'Dated records with a known source'), l('Kendi aşamaların', 'Your own stages'), l('Veri yok ≠ sıfır', 'No data ≠ zero')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('Analitik', 'Analytics')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Büyüme raporu', 'Growth report')}</h4><p className="rm-sub">{t('Manuel ölçüm kayıtları', 'Manual measurement records')}</p>
      <Tiles items={[{ l: t('Kayıt', 'Sign-ups'), v: '42', s: t('14.10', '14 Oct') }, { l: t('İlk kullanım', 'First use'), v: '18', s: t('14.10', '14 Oct') }, { l: t('Aktivasyon', 'Activation'), v: '7', s: t('14.10', '14 Oct') }]} />
      <Tiles items={[{ l: t('Talep', 'Leads'), v: '—', s: t('Veri yok', 'No data'), tone: 'none' }, { l: 'Demo', v: '—', s: t('Veri yok', 'No data'), tone: 'none' }, { l: t('Müşteri', 'Customers'), v: '—', s: t('Veri yok', 'No data'), tone: 'none' }]} /></> },
  { key: 'profile', n: '01', icon: <Fingerprint size={I} />, title: l('Çalışma alanı', 'Workspace'), sub: l('marka dili, kitle, roller', 'brand voice, audience, roles'), x: 21, y: 30,
    detailTitle: l('Ürüne özel çalışma alanı', 'A workspace for your product'),
    detailText: l('Marka dili, hedef kitle, büyüme hedefleri, dönüşüm aşamaları ve ekip rolleri. Çalışma alanı senin ürününle başlar.', 'Brand voice, target audience, growth goals, conversion stages and team roles. The workspace starts with your product.'),
    points: [l('Proje profili ve marka dili', 'Project profile and brand voice'), l('Hedef kitle tanımı', 'Target audience definition'), l('Ekip rolleri: sahip, editör, inceleyen', 'Team roles: owner, editor, reviewer')],
    screen: (name, t) => <><div className="rm-scr-top"><span>{t('Proje ayarları', 'Project settings')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Proje profili', 'Project profile')}</h4><p className="rm-sub">{name} · product.example</p>
      <div className="rm-f"><label>{t('Hedef kitle', 'Target audience')}</label><div>{t('Küçük ekiplerle çalışan ürün yöneticileri', 'Product managers working with small teams')}</div></div>
      <div className="rm-f"><label>{t('Marka dili', 'Brand voice')}</label><div className="rm-chips"><span className="on">{t('Net', 'Clear')}</span><span className="on">{t('Güven veren', 'Reassuring')}</span><span>{t('Esprili', 'Playful')}</span></div></div>
      <div className="rm-f"><label>{t('Roller', 'Roles')}</label><div className="rm-chips"><span>{t('Sahip', 'Owner')}</span><span>{t('Editör', 'Editor')}</span><span>{t('İnceleyen', 'Reviewer')}</span></div></div></> },
  { key: 'goals', n: '02', icon: <Target size={I} />, title: l('Büyüme hedefleri', 'Growth goals'), sub: l('kendi aşamaların', 'your own stages'), x: 25, y: 9,
    detailTitle: l('Büyüme hedefleri', 'Growth goals'),
    detailText: l('Her işletmenin büyüme tanımı farklıdır. Aşamaları sen yazarsın; ölçümler ve modüller bu hedefe göre çalışır.', 'Every business defines growth differently. You write the stages; measurements and modules work toward that goal.'),
    points: [l('Kendi dönüşüm aşamaların', 'Your own conversion stages'), l('Hedef aşaması ve metrik tanımı', 'Goal stage and metric definition'), l('Veri yoksa tahmin değil, açıklık', 'No data means clarity, not guesses')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('Hedefler', 'Goals')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Ürün aktivasyonu', 'Product activation')}</h4><p className="rm-sub">{t('Yeni kullanıcılar', 'New users')}</p>
      <div className="rm-f"><label>{t('Aşamalar', 'Stages')}</label><div className="rm-chips"><span>{t('Deneme', 'Trial')}</span><span>{t('Aktivasyon', 'Activation')}</span><span className="on">{t('Ücretli müşteri', 'Paying customer')}</span></div></div>
      <Tiles items={[{ l: t('Deneme', 'Trial'), v: '—', s: t('Henüz ölçüm yok', 'Not measured yet'), tone: 'none' }, { l: t('Aktivasyon', 'Activation'), v: '—', s: t('Henüz ölçüm yok', 'Not measured yet'), tone: 'none' }, { l: t('Ücretli', 'Paying'), v: '—', s: t('Hedef', 'Goal'), tone: 'goal' }]} /></> },
  { key: 'content', n: '03', icon: <PenLine size={I} />, title: l('AI içerik stüdyosu', 'AI content studio'), sub: l('fikir, taslak, kütüphane', 'ideas, drafts, library'), x: 76, y: 11,
    detailTitle: l('AI içerik stüdyosu', 'AI content studio'),
    detailText: l('İçerik fikirleri ve taslak üretimi, içerik kütüphanesi ve kanal bazlı hazırlık. AI kullanımı sağlayıcı yapılandırması gerektirir.', 'Content ideas and draft generation, a content library and channel-specific preparation. AI features require a configured AI provider.'),
    points: [l('Fikir ve taslak üretimi', 'Idea and draft generation'), l('İçerik kütüphanesi', 'Content library'), l('Kanal bazlı hazırlık', 'Channel-specific preparation')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('İçerik kütüphanesi', 'Content library')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Yeni ekipler için ürün demosu', 'Product demo for new teams')}</h4><p className="rm-sub">{t('linkedin · 14.10.2026 · Taslak', 'linkedin · 14 Oct 2026 · Draft')}</p>
      <div className="rm-f"><label>{t('Metin', 'Copy')}</label><div className="rm-ta">{t('İyi fikirleri işe dönüştürün. Ürününüzü ve ekibinizin önceliklerini tek bir çalışma alanında buluşturun.', 'Turn good ideas into work. Bring your product and your team’s priorities together in one workspace.')}</div></div>
      <div className="rm-tool"><span>{t('AI ile fikir üret', 'Generate ideas with AI')}</span><span>{t('Yeniden yaz', 'Rewrite')}</span><span className="pri">{t('İncelemeye gönder', 'Submit for review')}</span></div></> },
  { key: 'campaign', n: '04', icon: <Megaphone size={I} />, title: l('Kampanyalar', 'Campaigns'), sub: l('inceleme, onay, gönderim', 'review, approval, sending'), x: 79, y: 31,
    detailTitle: l('Kampanya yönetimi', 'Campaign management'),
    detailText: l('Hedef ve kitle bağlantısı, içerik inceleme, onay ve kontrollü gönderim akışları. Her çıkış bir insan kararı.', 'Goal and audience links, content review, approval and controlled sending. Every release is a human decision.'),
    points: [l('Hedef ve kitle bağlantısı', 'Goal and audience links'), l('İnceleme ve onay', 'Review and approval'), l('Kontrollü gönderim', 'Controlled sending')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('Kampanyalar', 'Campaigns')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('İnceleme ve onay', 'Review and approval')}</h4><p className="rm-sub">{t('Yeni ekipler için ürün demosu · linkedin', 'Product demo for new teams · linkedin')}</p>
      <ul className="rm-rev"><li><i className="ok">✓</i><span>{t('Marka diline uygun', 'Matches the brand voice')}</span><small>{t('profil', 'profile')}</small></li><li><i className="ok">✓</i><span>{t('Hedefe bağlı', 'Linked to a goal')}</span><small>{t('aktivasyon', 'activation')}</small></li><li><i /><span>{t('Görsel önizleme', 'Visual preview')}</span><small>linkedin</small></li><li><i /><span>{t('Onay', 'Approval')}</span><small>{t('ekip lideri', 'team lead')}</small></li></ul>
      <div className="rm-tool"><span>{t('Düzenleme iste', 'Request changes')}</span><span className="pri">{t('Onayla', 'Approve')}</span></div><div className="rm-gate">{t('Standart pilot: otomatik gönderim kapalı.', 'Standard pilot: automatic sending is off.')}</div></> },
  { key: 'social', n: '05', icon: <Share2 size={I} />, title: l('Sosyal yayınlar', 'Social publishing'), sub: l('önizleme, plan, prova', 'preview, schedule, rehearsal'), x: 80, y: 70,
    detailTitle: l('Sosyal yayınlar', 'Social publishing'),
    detailText: l('Desteklenen hesaplarda yayın hazırlığı, görsel önizleme, planlama, prova ve yayın bazlı etkileşim takibi.', 'Publication prep for supported accounts, visual previews, scheduling, rehearsals and per-post engagement tracking.'),
    points: [l('Görsel önizleme ve prova', 'Visual preview and rehearsal'), l('Planlama', 'Scheduling'), l('Yayın bazlı etkileşim takibi', 'Per-post engagement tracking')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('Sosyal yayınlar', 'Social publishing')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Yayın hazırlığı', 'Publication prep')}</h4><p className="rm-sub">{t('instagram · 1080×1350 · prova hazır', 'instagram · 1080×1350 · rehearsal ready')}</p>
      <div className="rm-f"><label>{t('Plan', 'Schedule')}</label><div>{t('16.10.2026 · 09:00 · onay bekliyor', '16 Oct 2026 · 09:00 · awaiting approval')}</div></div>
      <div className="rm-f"><label>{t('Durum', 'Status')}</label><div className="rm-chips"><span className="on">{t('Önizleme', 'Preview')}</span><span className="on">{t('Prova', 'Rehearsal')}</span><span>{t('Yayın', 'Publish')}</span></div></div>
      <div className="rm-gate">{t('Bağlantı eklemek yayın yetkisinin doğrulandığı anlamına gelmez.', 'Adding a connection doesn’t mean publishing access has been verified.')}</div></> },
  { key: 'email', n: '06', icon: <Mail size={I} />, title: l('E-posta operasyonları', 'Email operations'), sub: l('SES, şablon, izin', 'SES, templates, consent'), x: 75, y: 91,
    detailTitle: l('E-posta operasyonları', 'Email operations'),
    detailText: l('Amazon SES bağlantısı, şablonlar, iletişim izinleri ve kontrollü pilot gönderimler.', 'Amazon SES connection, templates, contact consent and controlled pilot sends.'),
    points: [l('SES bağlantısı ve şablonlar', 'SES connection and templates'), l('İletişim izinleri', 'Contact consent'), l('Kontrollü pilot gönderim', 'Controlled pilot sending')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('E-posta', 'Email')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('İlk değer: yeni kullanıcı aktivasyonu', 'First value: new user activation')}</h4><p className="rm-sub">{t('email · şablon · taslak', 'email · template · draft')}</p>
      <div className="rm-f"><label>{t('Alıcı izni', 'Recipient consent')}</label><div>{t('İzinli liste · doğrulandı', 'Consented list · verified')}</div></div>
      <div className="rm-f"><label>{t('Gönderim', 'Sending')}</label><div>{t('Pilot · kontrollü · toplu gönderim kapalı', 'Pilot · controlled · bulk sending off')}</div></div></> },
  { key: 'seo', n: '07', icon: <Search size={I} />, title: l('SEO operasyon merkezi', 'SEO operations hub'), sub: l('denetim, bulgu, iş kartı', 'audit, findings, work items'), x: 25, y: 91,
    detailTitle: l('SEO operasyon merkezi', 'SEO operations hub'),
    detailText: l('Site denetimi, URL envanteri, bulgular, öneriler ve sorumlu ekibe atanabilen iş kartları.', 'Site audits, URL inventory, findings, recommendations and work items you can assign to the responsible team.'),
    points: [l('Site denetimi ve URL envanteri', 'Site audit and URL inventory'), l('Bulgular ve öneriler', 'Findings and recommendations'), l('Sorumlu ekibe iş kartı', 'Work items for the responsible team')],
    screen: (_, t) => <><div className="rm-scr-top"><span>SEO</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Bulgular', 'Findings')}</h4><p className="rm-sub">{t('product.example · 48 URL', 'product.example · 48 URLs')}</p>
      <div className="rm-seo"><div><span>{t('H1 hiyerarşisi net değil', 'Unclear H1 hierarchy')}</span><span>{t('İŞ KARTI', 'WORK ITEM')}</span></div><div><span>{t('Meta açıklama eksik · 6 sayfa', 'Missing meta description · 6 pages')}</span><span>{t('ÖNERİ', 'SUGGESTION')}</span></div><div><span>{t('Sitemap güncel', 'Sitemap up to date')}</span><span>{t('TAMAM', 'OK')}</span></div></div></> },
  { key: 'calendar', n: '08', icon: <CalendarDays size={I} />, title: l('Takvim ve işler', 'Calendar and tasks'), sub: l('sorumlu, tarih, bağlam', 'owner, date, context'), x: 22, y: 70,
    detailTitle: l('Takvim ve iş yönetimi', 'Calendar and task management'),
    detailText: l('Yapılacak işleri, sorumlulukları ve tarihleri aynı bağlamda takip etme. Takvim otomatik yayın anlamına gelmez.', 'Track tasks, owners and dates in the same context. The calendar doesn’t mean automatic publishing.'),
    points: [l('İşler ve sorumlular', 'Tasks and owners'), l('Tarihler ve bağlam', 'Dates and context'), l('Günün ajandası', 'Today’s agenda')],
    screen: (_, t) => <><div className="rm-scr-top"><span>{t('Takvim', 'Calendar')}</span><span>{t('Örnek', 'Sample')}</span></div><h4>{t('Ekim 2026', 'October 2026')}</h4><p className="rm-sub">{t('2 bekleyen iş', '2 open tasks')}</p>
      <div className="rm-cal"><span>13</span><span>14</span><span className="d">15</span><span className="d">16</span><span>17</span><span>18</span><span>19</span></div>
      <div className="rm-rows"><div className="rm-row"><div className="rm-d"><b>15</b>{t('Eki', 'Oct')}</div><div><b>{t('İlk kampanya içeriğini gözden geçir', 'Review the first campaign content')}</b><small>{t('Örnek proje iş planı', 'Sample project work plan')}</small></div><span className="rm-st">● {t('Planlandı', 'Scheduled')}</span></div>
      <div className="rm-row"><div className="rm-d"><b>16</b>{t('Eki', 'Oct')}</div><div><b>{t('Ürün demosu davetini hazırla', 'Prepare the product demo invitation')}</b><small>{t('Örnek proje iş planı', 'Sample project work plan')}</small></div><span className="rm-st">● {t('Devam ediyor', 'In progress')}</span></div></div></> },
];

const CORE = MODULES[0];
const ORDER: ModuleKey[] = ['profile', 'goals', 'content', 'campaign', 'social', 'email', 'seo', 'calendar', 'measure'];

// Merkezden düğüme yumuşak S-eğrisi (viewBox 1000×1000, sahne yüzdesi ×10). Yatay mesafe baskınsa yatay, değilse dikey kontrol noktaları.
function curve(m: ModuleDef): string {
  const x1 = CORE.x * 10, y1 = CORE.y * 10, x2 = m.x * 10, y2 = m.y * 10;
  const dx = x2 - x1, dy = y2 - y1;
  return Math.abs(dx) > Math.abs(dy)
    ? `M${x1} ${y1} C${x1 + dx * 0.55} ${y1}, ${x2 - dx * 0.55} ${y2}, ${x2} ${y2}`
    : `M${x1} ${y1} C${x1} ${y1 + dy * 0.55}, ${x2} ${y2 - dy * 0.55}, ${x2} ${y2}`;
}

export default function WorkspaceMap({ lang = 'tr' }: { lang?: Lang }) {
  const t: T = (tr, en) => (lang === 'en' ? en : tr);
  const tx = (value: L) => value[lang];
  const [active, setActive] = useState<ModuleKey | null>(null);
  const [hover, setHover] = useState<ModuleKey | null>(null);
  const [animate, setAnimate] = useState(false);
  const [name, setName] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const nodeRefs = useRef<Partial<Record<ModuleKey, HTMLButtonElement>>>({});
  const lastNode = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // Giriş animasyonu yalnızca görünür sekmede ve hareket azaltma kapalıyken; aksi hâlde sayfa dinlenme hâlinde tam görünür.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible') return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  // Ürün adı yalnızca bu tarayıcıda hatırlanır (ziyaretçi rahatlığı); sunucuya gitmez.
  useEffect(() => {
    try { const saved = localStorage.getItem(NAME_KEY); if (saved) setName(saved.slice(0, 24)); } catch { /* depolama kapalı olabilir */ }
  }, []);
  const changeName = (value: string) => {
    const v = value.replace(/\s+/g, ' ').slice(0, 24);
    setName(v);
    try { if (v.trim()) localStorage.setItem(NAME_KEY, v.trim()); else localStorage.removeItem(NAME_KEY); } catch { /* yoksay */ }
  };
  const shownName = name.trim() || DEFAULT_NAME;

  const zoomTo = useCallback((button: HTMLButtonElement | null) => {
    const stage = stageRef.current;
    if (!button || !stage || window.innerWidth <= 640) return;
    const r = stage.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    // Sahne zaten ölçeklenmişse geometriyi ölçeksiz hesapla
    const scale = r.width / stage.offsetWidth || 1;
    const cx = (b.left + b.width / 2 - r.left) / scale / stage.offsetWidth;
    const cy = (b.top + b.height / 2 - r.top) / scale / stage.offsetHeight;
    stage.style.transformOrigin = `${cx * 100}% ${cy * 100}%`;
    stage.style.transform = 'scale(2.2)';
    stage.style.filter = 'blur(2px)';
  }, []);

  const open = useCallback((key: ModuleKey, button: HTMLButtonElement | null) => {
    if (button) { lastNode.current = button; zoomTo(button); }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setActive(key);
      if (window.innerWidth <= 1180) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      window.setTimeout(() => backRef.current?.focus({ preventScroll: true }), 60);
    }, button ? 350 : 0);
  }, [zoomTo]);

  const close = useCallback(() => {
    const stage = stageRef.current;
    if (stage) { stage.style.transform = ''; stage.style.filter = ''; }
    setActive(null);
    lastNode.current?.focus({ preventScroll: true });
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    if (!active) return;
    const i = ORDER.indexOf(active);
    const next = ORDER[(i + dir + ORDER.length) % ORDER.length];
    const node = nodeRefs.current[next] ?? null;
    const stage = stageRef.current;
    if (stage) { stage.style.transform = ''; stage.style.filter = ''; }
    // Kısa bir an sonra yeni düğüme yakınlaş; sahne sıfırlanmış olur.
    window.requestAnimationFrame(() => zoomTo(node));
    setActive(next);
  }, [active, zoomTo]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, close, step]);

  const current = active ? MODULES.find(m => m.key === active) ?? null : null;
  const highlighted = active ?? hover;
  const idx = active ? ORDER.indexOf(active) : -1;

  // Not bir bileşen, düz bir render fonksiyonu: içeride tanımlı bir bileşen her render'da
  // yeniden mount olur ve hover sırasında tıklama kaybolur.
  const renderNode = (m: ModuleDef, inList = false) => (
    <button
      key={m.key}
      type="button"
      ref={inList ? undefined : el => { if (el) nodeRefs.current[m.key] = el; }}
      className={`rm-node${m.key === 'measure' ? ' core' : ''}${active === m.key ? ' on' : ''}`}
      style={inList ? undefined : { left: `${m.x}%`, top: `${m.y}%`, '--d': `${0.15 + ORDER.indexOf(m.key) * 0.09}s` } as CSSProperties}
      onClick={e => open(m.key, inList ? null : e.currentTarget)}
      onMouseEnter={() => setHover(m.key)} onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(m.key)} onBlur={() => setHover(null)}
      aria-label={t(`${tx(m.title)} modülünü aç`, `Open the ${tx(m.title)} module`)} aria-expanded={active === m.key}>
      <span className="rm-ic" aria-hidden="true">{m.icon}</span>
      <span className="rm-node-text"><b>{m.key === 'measure' ? `${tx(m.title)}: ${shownName}` : tx(m.title)}</b><small>{m.n && <em>{m.n}</em>}{tx(m.sub)}</small></span>
      <span className="rm-node-go" aria-hidden="true"><ArrowUpRight size={14} /></span>
    </button>
  );

  return (
    <section className="rm-hero" id="map" aria-labelledby="rm-title">
      <div className="rm-wrap"><div className="rm-hero-top">
        <span className="rm-k" lang="en">Grow with intent.</span>
        {lang === 'en'
          ? <h1 id="rm-title">A <span className="g">growth</span> workspace built around your product.</h1>
          : <h1 id="rm-title">Ürününe özel bir <span className="g">büyüme</span> çalışma alanı.</h1>}
        <p className="rm-lead">{t('AI destekli içeriklerini, kampanyalarını, SEO çalışmalarını ve ekibini aynı hedef etrafında buluştur. Bu harita senin çalışma alanın: ürünün ortada, her modül ona bağlı.', 'Bring your AI-assisted content, campaigns, SEO work and team together around one goal. This map is your workspace: your product sits at the center, and every module connects to it.')}</p>
        <label className="rm-name"><span>{t('Ürününün adı', 'Your product’s name')}</span><input id="rm-product-name" type="text" value={name} maxLength={24} placeholder={DEFAULT_NAME} autoComplete="off" spellCheck={false} onChange={e => changeName(e.target.value)} aria-describedby="rm-name-hint" /><small id="rm-name-hint">{t('Harita senin ürününle güncellenir. Yalnızca bu tarayıcıda kalır.', 'The map updates with your product. It stays in this browser only.')}</small></label>
        <div className="rm-ctas"><a className="rm-btn rm-btn-lime" href="#flow">{t('Ürünü keşfet', 'Explore the product')}</a><a className="rm-btn rm-btn-line" href="/join">{t('Davetle katıl', 'Join by invite')} <ArrowUpRight size={16} /></a></div>
        <p className="rm-hint"><i aria-hidden="true">↗</i><span>{t('Haritada bir düğüme tıkla; o modülün gerçek ekranına yakınlaş.', 'Click any node on the map to zoom into that module’s real screen.')}</span></p>
      </div></div>

      <div className="rm-map-wrap">
        <div className={`rm-map${animate ? ' animate' : ''}`} ref={stageRef} style={{ '--cx': `${CORE.x}%`, '--cy': `${CORE.y}%` } as CSSProperties}>
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {MODULES.filter(m => m.key !== 'measure').map((m, i) => (
              <path key={m.key} d={curve(m)} pathLength={1} className={highlighted === m.key ? 'on' : undefined} style={{ '--d': `${0.25 + i * 0.09}s` } as CSSProperties} />
            ))}
          </svg>
          {MODULES.map(m => renderNode(m))}
        </div>

        <div className="rm-map-list" aria-label={t('Modüller', 'Modules')}>
          {MODULES.map(m => renderNode(m, true))}
        </div>

        <div className={`rm-detail${current ? ' on' : ''}`} ref={detailRef} role="region" aria-live="polite" aria-hidden={!current}>
          <div className="rm-detail-bar">
            <span className="rm-detail-idx">{idx >= 0 ? `${idx + 1} / ${ORDER.length}` : ''}</span>
            <div className="rm-detail-nav">
              <button type="button" onClick={() => step(-1)} aria-label={t('Önceki modül', 'Previous module')}><ArrowLeft size={16} /></button>
              <button type="button" onClick={() => step(1)} aria-label={t('Sonraki modül', 'Next module')}><ArrowRight size={16} /></button>
              <button type="button" className="rm-back" ref={backRef} onClick={close}><X size={15} /> {t('Haritaya dön', 'Back to map')}</button>
            </div>
          </div>
          {current && (
            <div className="rm-detail-body" key={current.key}>
              <div><span className="rm-k">{t('Modül', 'Module')} {current.n && `· ${current.n}`}</span><h3>{tx(current.detailTitle)}</h3><p>{tx(current.detailText)}</p><ul className="rm-points">{current.points.map(p => <li key={p.tr}>{tx(p)}</li>)}</ul><p className="rm-detail-keys">{t('Esc: kapat · ← →: modüller arasında geç', 'Esc: close · ← →: switch modules')}</p></div>
              <div className="rm-screen">{current.screen(shownName, t)}</div>
            </div>
          )}
        </div>
        <div className="rm-mapcap"><span>{t('Çalışma alanı haritası · her modül ürünün hedefine bağlı', 'Workspace map · every module connects to your product’s goal')}</span><span>{t('Örnek proje verileri', 'Sample project data')}</span></div>
      </div>
    </section>
  );
}

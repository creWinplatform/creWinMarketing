'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, Fingerprint, Mail, Megaphone, PenLine, Search, Share2, Target, X } from 'lucide-react';

// Landing hero: ürünün çevresinde modül haritası. Düğüme tıklanınca harita o modüle yakınlaşır ve
// örnek ekranı açılır. Tüm veriler örnektir ("Örnek proje verileri"); gerçek müşteri verisi yoktur.

type ModuleKey = 'measure' | 'profile' | 'goals' | 'content' | 'campaign' | 'social' | 'email' | 'seo' | 'calendar';

type ModuleDef = {
  key: ModuleKey;
  n: string;
  icon: ReactNode;
  title: string;
  sub: string;
  x: number; // sahne içinde yüzde: satırlar dikeyde ayrık, aynı satırdakiler yatayda ayrık kalır
  y: number;
  detailTitle: string;
  detailText: string;
  points: string[];
  screen: (name: string) => ReactNode;
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
  { key: 'measure', n: '', icon: <Target size={16} />, title: 'Ürünün', sub: 'Hedef: ücretli müşteri · Ölçüm: 3 aşama', x: 50, y: 50,
    detailTitle: 'Veriye dayalı ölçüm', detailText: 'Bağlanan kaynaklardan veya tarihli manuel kayıtlardan ürünün kendi dönüşüm aşamalarını izleme. Bağlanmamış servisler için veri üretilmez.',
    points: ['Tarihli, kaynağı belli kayıtlar', 'Kendi aşamaların', 'Veri yok ≠ sıfır'],
    screen: () => <><div className="rm-scr-top"><span>Analitik</span><span>Örnek</span></div><h4>Büyüme raporu</h4><p className="rm-sub">Manuel ölçüm kayıtları</p>
      <Tiles items={[{ l: 'Kayıt', v: '42', s: '14.10' }, { l: 'İlk kullanım', v: '18', s: '14.10' }, { l: 'Aktivasyon', v: '7', s: '14.10' }]} />
      <Tiles items={[{ l: 'Talep', v: '—', s: 'Veri yok', tone: 'none' }, { l: 'Demo', v: '—', s: 'Veri yok', tone: 'none' }, { l: 'Müşteri', v: '—', s: 'Veri yok', tone: 'none' }]} /></> },
  { key: 'profile', n: '01', icon: <Fingerprint size={I} />, title: 'Çalışma alanı', sub: 'marka dili, kitle, roller', x: 21, y: 30,
    detailTitle: 'Ürüne özel çalışma alanı', detailText: 'Marka dili, hedef kitle, büyüme hedefleri, dönüşüm aşamaları ve ekip rolleri. Çalışma alanı senin ürününle başlar.',
    points: ['Proje profili ve marka dili', 'Hedef kitle tanımı', 'Ekip rolleri: sahip, editör, inceleyen'],
    screen: name => <><div className="rm-scr-top"><span>Proje ayarları</span><span>Örnek</span></div><h4>Proje profili</h4><p className="rm-sub">{name} · product.example</p>
      <div className="rm-f"><label>Hedef kitle</label><div>Küçük ekiplerle çalışan ürün yöneticileri</div></div>
      <div className="rm-f"><label>Marka dili</label><div className="rm-chips"><span className="on">Net</span><span className="on">Güven veren</span><span>Esprili</span></div></div>
      <div className="rm-f"><label>Roller</label><div className="rm-chips"><span>Sahip</span><span>Editör</span><span>İnceleyen</span></div></div></> },
  { key: 'goals', n: '02', icon: <Target size={I} />, title: 'Büyüme hedefleri', sub: 'kendi aşamaların', x: 25, y: 9,
    detailTitle: 'Büyüme hedefleri', detailText: 'Her işletmenin büyüme tanımı farklıdır. Aşamaları sen yazarsın; ölçümler ve modüller bu hedefe göre çalışır.',
    points: ['Kendi dönüşüm aşamaların', 'Hedef aşaması ve metrik tanımı', 'Veri yoksa tahmin değil, açıklık'],
    screen: () => <><div className="rm-scr-top"><span>Hedefler</span><span>Örnek</span></div><h4>Ürün aktivasyonu</h4><p className="rm-sub">Yeni kullanıcılar</p>
      <div className="rm-f"><label>Aşamalar</label><div className="rm-chips"><span>Deneme</span><span>Aktivasyon</span><span className="on">Ücretli müşteri</span></div></div>
      <Tiles items={[{ l: 'Deneme', v: '—', s: 'Henüz ölçüm yok', tone: 'none' }, { l: 'Aktivasyon', v: '—', s: 'Henüz ölçüm yok', tone: 'none' }, { l: 'Ücretli', v: '—', s: 'Hedef', tone: 'goal' }]} /></> },
  { key: 'content', n: '03', icon: <PenLine size={I} />, title: 'AI içerik stüdyosu', sub: 'fikir, taslak, kütüphane', x: 76, y: 11,
    detailTitle: 'AI içerik stüdyosu', detailText: 'İçerik fikirleri ve taslak üretimi, içerik kütüphanesi ve kanal bazlı hazırlık. AI kullanımı sağlayıcı yapılandırması gerektirir.',
    points: ['Fikir ve taslak üretimi', 'İçerik kütüphanesi', 'Kanal bazlı hazırlık'],
    screen: () => <><div className="rm-scr-top"><span>İçerik kütüphanesi</span><span>Örnek</span></div><h4>Yeni ekipler için ürün demosu</h4><p className="rm-sub">linkedin · 14.10.2026 · Taslak</p>
      <div className="rm-f"><label>Metin</label><div className="rm-ta">İyi fikirleri işe dönüştürün. Ürününüzü ve ekibinizin önceliklerini tek bir çalışma alanında buluşturun.</div></div>
      <div className="rm-tool"><span>AI ile fikir üret</span><span>Yeniden yaz</span><span className="pri">İncelemeye gönder</span></div></> },
  { key: 'campaign', n: '04', icon: <Megaphone size={I} />, title: 'Kampanyalar', sub: 'inceleme, onay, gönderim', x: 79, y: 31,
    detailTitle: 'Kampanya yönetimi', detailText: 'Hedef ve kitle bağlantısı, içerik inceleme, onay ve kontrollü gönderim akışları. Her çıkış bir insan kararı.',
    points: ['Hedef ve kitle bağlantısı', 'İnceleme ve onay', 'Kontrollü gönderim'],
    screen: () => <><div className="rm-scr-top"><span>Kampanyalar</span><span>Örnek</span></div><h4>İnceleme ve onay</h4><p className="rm-sub">Yeni ekipler için ürün demosu · linkedin</p>
      <ul className="rm-rev"><li><i className="ok">✓</i><span>Marka diline uygun</span><small>profil</small></li><li><i className="ok">✓</i><span>Hedefe bağlı</span><small>aktivasyon</small></li><li><i /><span>Görsel önizleme</span><small>linkedin</small></li><li><i /><span>Onay</span><small>ekip lideri</small></li></ul>
      <div className="rm-tool"><span>Düzenleme iste</span><span className="pri">Onayla</span></div><div className="rm-gate">Standart pilot: otomatik gönderim kapalı.</div></> },
  { key: 'social', n: '05', icon: <Share2 size={I} />, title: 'Sosyal yayınlar', sub: 'önizleme, plan, prova', x: 80, y: 70,
    detailTitle: 'Sosyal yayınlar', detailText: 'Desteklenen hesaplarda yayın hazırlığı, görsel önizleme, planlama, prova ve yayın bazlı etkileşim takibi.',
    points: ['Görsel önizleme ve prova', 'Planlama', 'Yayın bazlı etkileşim takibi'],
    screen: () => <><div className="rm-scr-top"><span>Sosyal yayınlar</span><span>Örnek</span></div><h4>Yayın hazırlığı</h4><p className="rm-sub">instagram · 1080×1350 · prova hazır</p>
      <div className="rm-f"><label>Plan</label><div>16.10.2026 · 09:00 · onay bekliyor</div></div>
      <div className="rm-f"><label>Durum</label><div className="rm-chips"><span className="on">Önizleme</span><span className="on">Prova</span><span>Yayın</span></div></div>
      <div className="rm-gate">Bağlantı eklemek yayın yetkisinin doğrulandığı anlamına gelmez.</div></> },
  { key: 'email', n: '06', icon: <Mail size={I} />, title: 'E-posta operasyonları', sub: 'SES, şablon, izin', x: 75, y: 91,
    detailTitle: 'E-posta operasyonları', detailText: 'Amazon SES bağlantısı, şablonlar, iletişim izinleri ve kontrollü pilot gönderimler.',
    points: ['SES bağlantısı ve şablonlar', 'İletişim izinleri', 'Kontrollü pilot gönderim'],
    screen: () => <><div className="rm-scr-top"><span>E-posta</span><span>Örnek</span></div><h4>İlk değer: yeni kullanıcı aktivasyonu</h4><p className="rm-sub">email · şablon · taslak</p>
      <div className="rm-f"><label>Alıcı izni</label><div>İzinli liste · doğrulandı</div></div>
      <div className="rm-f"><label>Gönderim</label><div>Pilot · kontrollü · toplu gönderim kapalı</div></div></> },
  { key: 'seo', n: '07', icon: <Search size={I} />, title: 'SEO operasyon merkezi', sub: 'denetim, bulgu, iş kartı', x: 25, y: 91,
    detailTitle: 'SEO operasyon merkezi', detailText: 'Site denetimi, URL envanteri, bulgular, öneriler ve sorumlu ekibe atanabilen iş kartları.',
    points: ['Site denetimi ve URL envanteri', 'Bulgular ve öneriler', 'Sorumlu ekibe iş kartı'],
    screen: () => <><div className="rm-scr-top"><span>SEO</span><span>Örnek</span></div><h4>Bulgular</h4><p className="rm-sub">product.example · 48 URL</p>
      <div className="rm-seo"><div><span>H1 hiyerarşisi net değil</span><span>İŞ KARTI</span></div><div><span>Meta açıklama eksik · 6 sayfa</span><span>ÖNERİ</span></div><div><span>Sitemap güncel</span><span>TAMAM</span></div></div></> },
  { key: 'calendar', n: '08', icon: <CalendarDays size={I} />, title: 'Takvim ve işler', sub: 'sorumlu, tarih, bağlam', x: 22, y: 70,
    detailTitle: 'Takvim ve iş yönetimi', detailText: 'Yapılacak işleri, sorumlulukları ve tarihleri aynı bağlamda takip etme. Takvim otomatik yayın anlamına gelmez.',
    points: ['İşler ve sorumlular', 'Tarihler ve bağlam', 'Günün ajandası'],
    screen: () => <><div className="rm-scr-top"><span>Takvim</span><span>Örnek</span></div><h4>Ekim 2026</h4><p className="rm-sub">2 bekleyen iş</p>
      <div className="rm-cal"><span>13</span><span>14</span><span className="d">15</span><span className="d">16</span><span>17</span><span>18</span><span>19</span></div>
      <div className="rm-rows"><div className="rm-row"><div className="rm-d"><b>15</b>Eki</div><div><b>İlk kampanya içeriğini gözden geçir</b><small>Örnek proje iş planı</small></div><span className="rm-st">● Planlandı</span></div>
      <div className="rm-row"><div className="rm-d"><b>16</b>Eki</div><div><b>Ürün demosu davetini hazırla</b><small>Örnek proje iş planı</small></div><span className="rm-st">● Devam ediyor</span></div></div></> },
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

export default function WorkspaceMap() {
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
      aria-label={`${m.title} modülünü aç`} aria-expanded={active === m.key}>
      <span className="rm-ic" aria-hidden="true">{m.icon}</span>
      <span className="rm-node-text"><b>{m.key === 'measure' ? `${m.title}: ${shownName}` : m.title}</b><small>{m.n && <em>{m.n}</em>}{m.sub}</small></span>
      <span className="rm-node-go" aria-hidden="true"><ArrowUpRight size={14} /></span>
    </button>
  );

  return (
    <section className="rm-hero" id="map" aria-labelledby="rm-title">
      <div className="rm-wrap"><div className="rm-hero-top">
        <span className="rm-k" lang="en">Grow with intent.</span>
        <h1 id="rm-title">Ürününe özel bir <span className="g">büyüme</span> çalışma alanı.</h1>
        <p className="rm-lead">AI destekli içeriklerini, kampanyalarını, SEO çalışmalarını ve ekibini aynı hedef etrafında buluştur. Bu harita senin çalışma alanın: ürünün ortada, her modül ona bağlı.</p>
        <label className="rm-name"><span>Ürününün adı</span><input id="rm-product-name" type="text" value={name} maxLength={24} placeholder={DEFAULT_NAME} autoComplete="off" spellCheck={false} onChange={e => changeName(e.target.value)} aria-describedby="rm-name-hint" /><small id="rm-name-hint">Harita senin ürününle güncellenir. Yalnızca bu tarayıcıda kalır.</small></label>
        <div className="rm-ctas"><a className="rm-btn rm-btn-lime" href="#flow">Ürünü keşfet</a><a className="rm-btn rm-btn-line" href="/join">Davetle katıl <ArrowUpRight size={16} /></a></div>
        <p className="rm-hint"><i aria-hidden="true">↗</i><span>Haritada bir düğüme tıkla; o modülün gerçek ekranına yakınlaş.</span></p>
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

        <div className="rm-map-list" aria-label="Modüller">
          {MODULES.map(m => renderNode(m, true))}
        </div>

        <div className={`rm-detail${current ? ' on' : ''}`} ref={detailRef} role="region" aria-live="polite" aria-hidden={!current}>
          <div className="rm-detail-bar">
            <span className="rm-detail-idx">{idx >= 0 ? `${idx + 1} / ${ORDER.length}` : ''}</span>
            <div className="rm-detail-nav">
              <button type="button" onClick={() => step(-1)} aria-label="Önceki modül"><ArrowLeft size={16} /></button>
              <button type="button" onClick={() => step(1)} aria-label="Sonraki modül"><ArrowRight size={16} /></button>
              <button type="button" className="rm-back" ref={backRef} onClick={close}><X size={15} /> Haritaya dön</button>
            </div>
          </div>
          {current && (
            <div className="rm-detail-body" key={current.key}>
              <div><span className="rm-k">Modül {current.n && `· ${current.n}`}</span><h3>{current.detailTitle}</h3><p>{current.detailText}</p><ul className="rm-points">{current.points.map(p => <li key={p}>{p}</li>)}</ul><p className="rm-detail-keys">Esc: kapat · ← →: modüller arasında geç</p></div>
              <div className="rm-screen">{current.screen(shownName)}</div>
            </div>
          )}
        </div>
        <div className="rm-mapcap"><span>Çalışma alanı haritası · her modül ürünün hedefine bağlı</span><span>Örnek proje verileri</span></div>
      </div>
    </section>
  );
}

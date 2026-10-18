import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight, CalendarCheck2, ChartNoAxesCombined, Fingerprint, PenLine, ShieldCheck, Target } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import WorkspaceMap from '@/components/marketing/WorkspaceMap';
import ToolCollapse from '@/components/marketing/ToolCollapse';
import Reveal from '@/components/marketing/Reveal';

export const metadata: Metadata = {
  title: 'Ürününe özel büyüme çalışma alanı',
  description: 'Ryzevo: AI destekli içeriklerini, kampanyalarını, SEO çalışmalarını ve ekibini aynı hedef etrafında buluştur.',
};

// Landing: kontrollü pilot. Gerçek müşteri logosu, yorum, büyüme yüzdesi, fiyat veya kullanım sayısı yok;
// ürün ekranları "Örnek proje verileri" etiketiyle gösterilir. CTA'lar mevcut akışlarla sınırlı: keşfet, davetle katıl, giriş yap.

const STEPS = [
  { Icon: Fingerprint, t: 'Ürününü tanımla', p: 'Marka dili, hedef kitle, dönüşüm aşamaları ve ekip rolleri.' },
  { Icon: Target, t: 'Hedefini belirle', p: 'Kendi aşamalarını yaz; metrikler bunlara bağlanır.' },
  { Icon: PenLine, t: 'İçeriğini hazırla', p: 'AI stüdyosu fikir ve taslak üretir; kanal bazlı hazırlık.' },
  { Icon: ShieldCheck, t: 'Onayla ve uygula', p: 'İnceleme, onay ve kontrollü gönderim. Her çıkış bir insan kararı.' },
  { Icon: ChartNoAxesCombined, t: 'Sonuçlarını izle', p: 'Tarihli, kaynağı belli ölçümler. Sonuç bir sonraki adımı besler.' },
];

const PATHS = [
  { t: 'SaaS', s: ['Deneme', 'Aktivasyon', 'Ücretli müşteri'] },
  { t: 'Hizmet işletmesi', s: ['Talep', 'Görüşme', 'Teklif', 'Kazanılan proje'] },
  { t: 'Pazar yeri', s: ['Kayıt', 'İlk işlem', 'Tekrar kullanım'] },
];

const FAQ = [
  { q: 'Kendi ürünüm için kullanabilir miyim?', a: 'Evet. Ürün profiliniz, hedefleriniz ve ekibiniz kendi çalışma alanınızda yer alır. Müşteriye özel araçlar yalnızca o müşterinin projesinde kalır.' },
  { q: 'İçerikler kendiliğinden yayımlanıyor mu?', a: 'Hayır. Standart pilot içerikleri ve kampanyaları taslak olarak saklar. İş takvimi otomatik yayın anlamına gelmez.' },
  { q: 'Çalışma alanına nasıl katılırım?', a: 'Platform yöneticinizden tek kullanımlık davet bağlantısı isteyin. Mevcut hesabınız varsa giriş ekranından devam edebilirsiniz.' },
  { q: 'Sonuçları nasıl takip ederim?', a: 'Projenizin hedeflerine bağlı, kaynağı ve tarihi belli ölçümlerle. Bağlanmamış servisler için trafik, gelir veya performans verisi üretilmez.' },
];

function BrandPair({ compact = false }: { compact?: boolean }) {
  return (<><span className="rm-brand-l"><Brand compact={compact} /></span><span className="rm-brand-d"><Brand compact={compact} inverse /></span></>);
}

export default function WelcomePage() {
  return (
    <div className="ryz-map">
      <Reveal />
      <a className="skip-link" href="#ryzevo-main">İçeriğe geç</a>
      <input type="checkbox" id="rm-menu" className="rm-menu-toggle" hidden />
      <header className="rm-nav">
        <div className="rm-wrap">
          <a href="/welcome" aria-label="Ryzevo ana sayfa" className="rm-logo"><BrandPair /></a>
          <nav aria-label="Ürün navigasyonu"><a href="#map">Harita</a><a href="#collapse">Neden tek yer</a><a href="#flow">Akış</a><a href="#pilot">Pilot</a></nav>
          <div className="rm-nav-cta"><a className="rm-btn rm-btn-line" href="/login">Giriş yap</a><a className="rm-btn rm-btn-ink" href="/join">Davetle katıl <ArrowUpRight size={16} /></a></div>
          <label className="rm-burger" htmlFor="rm-menu">Menü</label>
        </div>
      </header>
      <div className="rm-mobile">
        <a href="#map">Harita</a><a href="#collapse">Neden tek yer</a><a href="#flow">Akış</a><a href="#pilot">Pilot</a>
        <a className="rm-btn rm-btn-line" href="/login">Giriş yap</a><a className="rm-btn rm-btn-ink" href="/join">Davetle katıl <ArrowUpRight size={16} /></a>
      </div>

      <main id="ryzevo-main">
        <WorkspaceMap />

        <section className="rm-collapse" id="collapse">
          <div className="rm-wrap rm-col-grid">
            <div data-reveal><span className="rm-k">Neden tek yer</span><h2>Bir sürü sekme değil.<br />Ortak bir yön.</h2><p>İçerik, kampanya, SEO, görev ve ölçüm farklı araçlarda dağılınca bağlam kaybolur; yapılan işin büyüme hedefine katkısını izlemek zorlaşır. Ryzevo hepsini ürününün hedefleri etrafında düzenler.</p></div>
            <ToolCollapse />
          </div>
        </section>

        <section className="rm-flow" id="flow">
          <div className="rm-wrap">
            <div data-reveal><span className="rm-k">Akış</span><h2>Tanımla, hedefle, hazırla, onayla, izle.</h2><p className="rm-sec-lead">Kime ulaşmak istiyoruz, hangi eylemi bekliyoruz, şimdi ne yapmalıyız ve ne sonuç aldık? Aynı çalışma alanında.</p></div>
            <ol className="rm-steps" data-reveal>{STEPS.map(({ Icon, t, p }) => <li key={t} className="rm-step"><span className="rm-step-ic" aria-hidden="true"><Icon size={18} /></span><h3>{t}</h3><p>{p}</p></li>)}</ol>
            <div className="rm-diff" data-reveal><span className="rm-k">En önemli fark</span><h2>Herkese aynı başarı tablosunu dayatmaz.</h2><p className="rm-sec-lead">Büyüme tanımını sen yazarsın. Ryzevo aşamaları, içerikleri ve ölçümleri ona göre düzenler.</p></div>
            <div className="rm-fgrid" data-reveal>
              {PATHS.map(p => <div key={p.t} className="rm-fun"><h3>{p.t}</h3><small>Örnek büyüme yolu</small><div className="rm-path">{p.s.map((x, i) => <span key={x}>{x}<i>{i === p.s.length - 1 ? 'hedef' : i + 1}</i></span>)}</div></div>)}
            </div>
          </div>
        </section>

        <section className="rm-pilot-sec" id="pilot">
          <div className="rm-wrap">
            <div className="rm-pilot" data-reveal>
              <div><span className="rm-k">Kontrollü pilot</span><h2>Küçük başla. Bilinçli büyü.</h2><p>Ryzevo şu anda davetle açılan çalışma alanlarıyla ilerliyor. Standart pilotta otomatik yayın ve toplu gönderim kapalıdır; AI kullanımı sağlayıcı yapılandırması gerektirir.</p><div className="rm-ctas"><a className="rm-btn rm-btn-ink" href="/join">Davetle katıl <ArrowUpRight size={16} /></a><a className="rm-btn rm-btn-line" href="/login">Giriş yap</a></div></div>
              <div><ul>{['Ürününe özel hedefler ve marka dili', 'İçerik ve kampanya taslakları', 'İş planı ve tarihli ölçüm kayıtları', 'Ekip rolleri ve projeye özel erişim'].map(t => <li key={t}><CalendarCheck2 size={16} aria-hidden="true" />{t}</li>)}</ul><p className="rm-bound">Müşteriye özel araçlar o müşterinin hesabında kalır; başka işletmeler kendi çalışma alanlarını kullanır.</p></div>
            </div>
          </div>
        </section>

        <section className="rm-faq">
          <div className="rm-wrap rm-faq-wrap" data-reveal>
            <span className="rm-k">Net cevaplar</span><h2>Başlamadan önce.</h2>
            <div className="rm-faq-list">{FAQ.map((f, i) => <details key={f.q} open={i === 0}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
          </div>
        </section>
      </main>

      <footer className="rm-footer">
        <div className="rm-wrap">
          <div className="rm-foot"><div><BrandPair /><div className="rm-tag" lang="en">Grow with intent.</div></div><nav aria-label="Alt bağlantılar"><a href="/login">Giriş yap</a><a href="/join">Davetle katıl</a><a href="/login">Çalışma alanına dön <ArrowRight size={14} /></a></nav></div>
          <div className="rm-copy"><span>© {new Date().getFullYear()} Ryzevo · ryzevo.com</span><span>Projene özel. Ekibinle birlikte.</span></div>
        </div>
      </footer>
    </div>
  );
}

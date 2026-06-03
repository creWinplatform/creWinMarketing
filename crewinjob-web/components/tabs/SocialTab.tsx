'use client';
import { useState, useEffect } from 'react';
import OutputPanel from '../OutputPanel';
import SharePanel from '../SharePanel';
import { getTextModel } from '../ModelPicker';
import { saveToHistory, getHistory, deleteFromHistory, clearHistory, HistoryItem } from '@/lib/content-history';
import { saveTemplate, getTemplates, deleteTemplate, PromptTemplate } from '@/lib/prompt-templates';
import { addEvent } from '@/lib/calendar-store';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';

const PLATFORMS = [
  { value: 'instagram', label: '📸 Instagram' },
  { value: 'facebook',  label: '👥 Facebook'  },
  { value: 'twitter',   label: '🐦 Twitter / X' },
  { value: 'linkedin',  label: '💼 LinkedIn'  },
  { value: 'tiktok',    label: '🎵 TikTok'    },
];

const PLATFORM_ICONS: Record<string, string> = {
  instagram: '📸',
  facebook:  '👥',
  twitter:   '🐦',
  linkedin:  '💼',
  tiktok:    '🎵',
};

interface Suggestion {
  icon:     string;
  category: string;
  label:    string;
  prompt:   string;
  tip:      string;
}

// Her platform için GENİŞ havuz — shuffle ile 4'ü gösterilir
const PLATFORM_SUGGESTIONS: Record<string, Suggestion[]> = {
  instagram: [
    { icon: '🔥', category: 'Trend',        label: 'Viral Kariyer Serisi',    prompt: 'Denizcilik kariyerinde "kimse söylemez ama bilmen gereken 5 şey" temalı etkileyici bir Instagram carousel post hazırla',                                                            tip: 'Carousel postlar %3x daha fazla kayıt alır' },
    { icon: '💬', category: 'Engagement',   label: 'Topluluk Sorusu',         prompt: 'Denizcilerin aktif yorum yapacağı, gemide kariyer ilerleme zorluklarını paylaşacağı bir engagement sorusu ve caption yaz',                                                               tip: 'Soru içeren postlar %89 daha fazla yorum alır' },
    { icon: '📣', category: 'Marka',        label: 'Platform Tanıtımı',       prompt: 'CrewinJob\'un BullsEye akıllı eşleştirme özelliğini Instagram\'a özel, gerçek bir denizci perspektifinden hikaye anlatısıyla tanıt',                                                     tip: 'Hikaye formatı güven ve dönüşüm artırır' },
    { icon: '🌊', category: 'İlham',        label: 'Denizde Yaşam',           prompt: 'Gemide çalışmanın benzersiz avantajlarını anlatan, denizcileri motive eden ve potansiyel adaylara ilham veren görsel odaklı bir post yaz',                                                tip: 'Duygusal içerik paylaşım oranını artırır' },
    { icon: '🏅', category: 'Sosyal Kanıt', label: 'Başarı Hikayesi',         prompt: 'CrewinJob sayesinde hayalindeki gemiye kavuşan bir denizcinin hikayesini kısa ve duygusal Instagram caption\'ı olarak yaz, story formatına da uygun olsun',                              tip: 'Sosyal kanıt dönüşüm oranını 2x artırır' },
    { icon: '🎯', category: 'Dönüşüm',     label: 'CTA Odaklı Post',         prompt: 'Denizci adaylarını CrewinJob\'a kayıt olmaya teşvik eden, güçlü CTA içeren, görsel açıklamalı bir Instagram post yaz. Aciliyet ve fırsat hissi ver.',                                   tip: 'Net CTA olan postlar %38 daha fazla tıklanır' },
    { icon: '📊', category: 'Eğitim',      label: 'İnfografik Caption',      prompt: '"Denizcilik sertifika yol haritası" konusunu Instagram infografik tarzında 5 adımda anlatan, kaydedilmeye değer bir caption yaz',                                                         tip: 'Eğitim içeriği kaydetme oranını artırır' },
    { icon: '🌟', category: 'Motivasyon',  label: 'Haftanın İlanı',          prompt: 'Bu haftanın en öne çıkan denizcilik ilanını Instagram\'a özel heyecan yaratan bir dille tanıt, hedef kitleyi doğrudan başvurmaya yönlendir',                                             tip: 'Düzenli ilan postları takipçi sadakatini artırır' },
  ],
  facebook: [
    { icon: '📊', category: 'Haftalık',     label: 'İlan Bülteni',            prompt: 'Haftanın öne çıkan denizcilik iş ilanlarını özet formatında paylaş, her ilanın neden cazip olduğunu açıkla ve etkileşimi artıracak bir soru ile bitir',                                  tip: 'Düzenli bültenler %60 daha fazla takipçi sadakati sağlar' },
    { icon: '🤝', category: 'Topluluk',     label: 'Deneyim Paylaşımı',       prompt: 'Denizci topluluğunu en zorlu rotalarını ve en etkileyici limanlarını paylaşmaya davet eden, nostalji ve bağlılık yaratan bir post yaz',                                                  tip: 'UGC organik erişimi 4x artırır' },
    { icon: '🎯', category: 'Dönüşüm',     label: 'Platform Tanıtımı',       prompt: 'CrewinJob\'un işe alım sürecini nasıl kolaylaştırdığını, rakiplerden farkını net biçimde anlatan, hem iş veren hem denizci perspektifinden ikna edici bir Facebook gönderisi yaz',      tip: 'Fayda odaklı içerik tıklanma oranını artırır' },
    { icon: '📰', category: 'Sektör',      label: 'Trend Analiz',            prompt: 'Denizcilik sektöründe güncel işe alım trendlerini, artan/azalan talep gören pozisyonları analiz eden bilgilendirici bir makale tarzı post yaz',                                          tip: 'Otorite içeriği marka güveni inşa eder' },
    { icon: '🗳️', category: 'Engagement', label: 'Anket & Tartışma',        prompt: 'Denizcilik topluluğunda tartışma yaratacak bir anket oluştur: "Kontrat mı serbest mi tercih edersiniz?" gibi, yorumları tetikleyecek şekilde kur',                                       tip: 'Anketler organik erişimi 2x artırır' },
    { icon: '🚨', category: 'Acil İlan',   label: 'Urgent Pozisyon',         prompt: 'Acil doldurulması gereken kritik bir denizcilik pozisyonunu Facebook\'a özel aciliyet duygusuyla duyur, nitelikli adayları harekete geçir',                                             tip: 'Aciliyet içeren postlar paylaşım oranını artırır' },
    { icon: '🎉', category: 'Kutlama',     label: 'Başarı Duyurusu',         prompt: 'CrewinJob aracılığıyla işe alınan denizci sayısı veya şirket başarısını kutlayan, toplulukla birlikte kutlayan sıcak bir Facebook gönderisi yaz',                                        tip: 'Milestone içerikler marka bağlılığı kurar' },
    { icon: '💡', category: 'Eğitim',      label: 'Kariyer İpucu',           prompt: 'Denizcilik kariyerinde ilerlemenin önündeki 3 yaygın engeli ve nasıl aşılacağını anlatan, değer odaklı ve paylaşılmaya değer bir Facebook içeriği yaz',                                  tip: 'Değer içeriği organik paylaşımı artırır' },
  ],
  twitter: [
    { icon: '🧵', category: 'Thread',       label: 'Viral Thread',            prompt: '5 tweet\'lik güçlü bir thread: Denizcilik kariyerine sıfırdan başlamak için adım adım rehber. Her tweet bağımsız ama birlikte güçlü olsun, hook tweet ile başla',                       tip: 'Thread\'ler tek tweet\'ten %60 daha fazla etkileşim alır' },
    { icon: '⚡', category: 'Anlık',        label: 'Breaking Duyuru',         prompt: 'Yeni açılan kritik denizcilik pozisyonlarını aciliyet ve fırsat hissiyle duyuran, 280 karakterde maksimum etki yaratan bir tweet yaz',                                                   tip: 'Aciliyet içeren tweetler %22 daha fazla tıklanır' },
    { icon: '💡', category: 'Değer',        label: 'Pro İpucu',               prompt: 'Denizci adaylarının CV\'lerinde yaptığı en kritik 3 hatayı ve çözümünü anlatan, kaydedilip paylaşılacak değerde kısa ve net bir tweet yaz',                                             tip: '"Save worthy" içerik organik büyüme sağlar' },
    { icon: '📈', category: 'Sektör',      label: 'Trend Veri',              prompt: 'Denizcilik iş piyasasında bu ay en çok aranan pozisyonları, maaş aralıklarını ve kariyer fırsatlarını data odaklı, otoriter bir tonda paylaş',                                           tip: 'Veri içerikli tweetler %3x daha fazla RT alır' },
    { icon: '🔁', category: 'Engagement',  label: 'RT Bait',                 prompt: 'Denizcilerin "kesinlikle" diyerek RT atacağı, sektörle ilgili güçlü bir gerçeği veya tartışmalı görüşü içeren, kısa ve etkili bir tweet yaz',                                             tip: 'Güçlü görüşler RT oranını artırır' },
    { icon: '🎤', category: 'Otorite',     label: 'Uzman Görüşü',            prompt: 'Denizcilik işe alım sürecinde işverenlerin en çok hangi özelliklere baktığını anlatan, otoriter ve güvenilir bir uzman tweeti yaz',                                                      tip: 'Uzman içeriği takipçi güvenini artırır' },
    { icon: '😄', category: 'Eğlenceli',   label: 'Denizci Humor',           prompt: 'Denizcilerin gülerek paylaşacağı, gemi yaşamından ilham alan esprili ama profesyonel bir tweet yaz. CrewinJob markasıyla bağdaşmalı.',                                                    tip: 'Eğlenceli içerik viral potansiyeli taşır' },
    { icon: '❓', category: 'Soru',        label: 'Topluluk Sorusu',         prompt: 'Denizcilik topluluğunu yanıt vermeye teşvik eden, ilgi çekici ve tartışma yaratan bir soru tweeti yaz. Kısa, net, merak uyandırıcı olsun.',                                              tip: 'Soru tweetleri yanıt oranını 3x artırır' },
  ],
  linkedin: [
    { icon: '🏆', category: 'Liderlik',    label: 'Otorite Makalesi',        prompt: 'Denizcilik sektöründe 2026 işe alım trendlerini derinlemesine analiz eden, sektör liderlerine hitap eden düşünce liderliği makalesi yaz. Veri ve içgörüler içersin.',                   tip: 'Düşünce liderliği profil görüntülemesini 10x artırır' },
    { icon: '📖', category: 'Hikaye',      label: 'Başarı Hikayesi',         prompt: 'CrewinJob aracılığıyla hayalindeki pozisyona kavuşan bir denizcinin dönüşüm hikayesini, duygusal ve profesyonel bir dille LinkedIn formatında anlat',                                    tip: 'Hikaye formatı bağlantı isteklerini %55 artırır' },
    { icon: '🎓', category: 'Eğitim',      label: 'Kariyer Rehberi',         prompt: 'Denizcilik kariyerinde güverte zabitinden kaptana uzanan yolda gereken sertifikalar, deneyimler ve stratejileri adım adım açıklayan kapsamlı bir rehber yaz',                            tip: 'Eğitim içeriği en yüksek kaydetme oranına sahip' },
    { icon: '🤝', category: 'Network',     label: 'Sektör Tartışması',       prompt: 'Denizcilik iş dünyasında tartışmalı ama düşündürücü bir soru sor: otomasyon denizci ihtiyacını azaltır mı? Farklı bakış açılarını dengeli sun.',                                         tip: 'Tartışma başlatan içerikler yorumları %3x artırır' },
    { icon: '📊', category: 'Veri',        label: 'Sektör Raporu',           prompt: '2025-2026 denizcilik sektörü istihdam verilerini yorumlayan, hangi pozisyonların yükselişte olduğunu gösteren kısa bir LinkedIn analiz paylaşımı yaz',                                    tip: 'Veri destekli içerik paylaşım oranını artırır' },
    { icon: '🔮', category: 'Vizyon',      label: 'Gelecek Tahmini',         prompt: 'Denizcilik sektörünün önümüzdeki 5 yılını şekillendirecek 3 büyük trendi anlatan, vizyon sahibi ve ileriye bakışlı bir LinkedIn postu yaz',                                              tip: 'Vizyon içeriği thought leadership inşa eder' },
    { icon: '💼', category: 'İK & İşe Alım', label: 'İşveren Perspektifi', prompt: 'Denizcilik şirketlerinin iş ilanı yayınlarken yaptığı 5 kritik hatayla ve bunların nitelikli adayları nasıl kaçırdığını anlatan, işverenlere yönelik bir LinkedIn postu yaz',           tip: 'B2B içerik karar vericilere ulaşır' },
    { icon: '🌍', category: 'Global',      label: 'Uluslararası Pazar',      prompt: 'Dünyanın en çok denizci istihdam eden 5 ülkesini ve CrewinJob\'un bu pazarlardaki rolünü anlatan, küresel perspektifli bir LinkedIn içeriği yaz',                                       tip: 'Global içerik uluslararası bağlantı çeker' },
  ],
  tiktok: [
    { icon: '🎬', category: 'POV',          label: 'Liman İzin Günü',         prompt: '"POV: Gemi adamısın ve bugün liman iznin var" formatında, Z kuşağına hitap eden, eğlenceli ve merak uyandıran 60 saniyelik TikTok video scripti yaz',                                   tip: 'POV içerikler FYP\'de daha fazla önerilir' },
    { icon: '🪝', category: 'Hook',         label: 'Dur Kaydırma',            prompt: '"Bu videoyu izlemeden denizci olma" hook\'lu, ilk 3 saniyede kaydırmayı durduracak güçlü bir açılışla başlayan kariyer motivasyon videosu scripti yaz',                                 tip: 'İlk 3 saniye izlenmeyi belirler' },
    { icon: '🌍', category: 'Yaşam Tarzı', label: 'Dünya Turu',              prompt: 'Bir denizci olarak ziyaret ettiğin en iyi 5 limanı, her birinde yaşadığın unutulmaz anlarla anlatan, seyahat tutkunu gençlere hitap eden TikTok scripti yaz',                           tip: 'Seyahat içerikleri genç kitlede %80 daha fazla paylaşılır' },
    { icon: '💰', category: 'Motivasyon',  label: 'Kazanç Gerçekliği',       prompt: 'Denizcilik kariyerinde gerçek kazanç rakamlarını şeffaf biçimde paylaşan, kariyer değişikliği düşünenlere hitap eden viral potansiyelli bir TikTok videosu yaz',                        tip: 'Kazanç içerikleri hedef kitlede yüksek ilgi görür' },
    { icon: '😱', category: 'Surpriz',     label: 'Beklenmedik Gerçekler',   prompt: '"Gemide çalışmadan önce bilmediğim 5 şey" formatında, izleyiciyi şaşırtacak, merak uyandıracak ve sektörü tanıtacak bir TikTok video scripti yaz',                                      tip: 'Surpriz içerik izlenme süresini artırır' },
    { icon: '🎓', category: 'Eğitim',      label: 'Hızlı Kariyer Rehberi',  prompt: '"30 saniyede denizcilik kariyerine nasıl başlarsın" formatında, bilgi yoğun, hızlı tempolu ve aksiyon odaklı bir TikTok scripti yaz',                                                    tip: 'Bilgi yoğun içerik kaydetme oranını artırır' },
    { icon: '🏆', category: 'Challenge',   label: 'Viral Challenge',         prompt: 'Denizcilik topluluğunu harekete geçirecek, taklit edilebilir ve CrewinJob markasını organik yayacak bir TikTok challenge konsepti ve video scripti yaz',                                  tip: 'Challenge içerikler UGC ve marka bilinirliği yaratır' },
    { icon: '🌅', category: 'Atmosfer',    label: 'Gündoğumu Nöbeti',        prompt: '"Okyanusun ortasında gündoğumu nöbeti" temalı, denizciliğin poetik ve büyüleyici yönünü anlatan, izleyiciyi büyüleyecek sinematik tarzda bir TikTok scripti yaz',                       tip: 'Estetik içerik \'duygusal\' kitleyi çeker' },
  ],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa`;
  return `${Math.floor(hrs / 24)} gün`;
}

const CARDS_PER_PAGE = 4;

// A/B Variant definitions
interface Variant {
  tone: string;
  label: string;
  emoji: string;
  content: string;
  loading: boolean;
}

// All platforms mode
interface PlatformContent {
  platform: string;
  content: string;
  loading: boolean;
  error: string;
  expanded: boolean;
  editing: boolean;
  editValue: string;
}

export default function SocialTab() {
  const [platform,     setPlatform]     = useState('twitter');
  const [language,     setLanguage]     = useState<'tr' | 'en'>('en');
  const [customPrompt, setCustomPrompt] = useState('');
  const [output,       setOutput]       = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [spinning,     setSpinning]     = useState(false);
  const [visibleSuggestions, setVisible] = useState<Suggestion[]>([]);
  const { lang } = useLang();

  // Feature A: Content History
  const [history,       setHistory]      = useState<HistoryItem[]>([]);
  const [showHistory,   setShowHistory]  = useState(false);

  // Feature B: A/B Variants
  const [variantMode,   setVariantMode]  = useState(false);
  const [variants,      setVariants]     = useState<Variant[]>([]);

  // Feature C: All Platforms Mode
  const [allPlatMode,   setAllPlatMode]  = useState(false);
  const [allPlatData,   setAllPlatData]  = useState<PlatformContent[]>([]);

  // Feature E: AllPlatforms share
  const [sharePlatItem, setSharePlatItem] = useState<{ content: string; platform: string } | null>(null);

  // Feature D: Calendar save
  const [showCalForm,   setShowCalForm]  = useState(false);
  const [calDate,       setCalDate]      = useState('');
  const [calSaved,      setCalSaved]     = useState(false);

  // Feature F: Prompt Templates
  const [templates,       setTemplates]      = useState<PromptTemplate[]>([]);
  const [stratPanel,      setStratPanel]     = useState<'strategy' | 'templates'>('strategy');
  const [showSaveTpl,     setShowSaveTpl]    = useState(false);
  const [tplName,         setTplName]        = useState('');

  // Hydration-safe initializations
  useEffect(() => {
    setVisible(shuffle(PLATFORM_SUGGESTIONS[platform] || []).slice(0, CARDS_PER_PAGE));
  }, [platform]);

  useEffect(() => {
    getHistory().then(setHistory).catch(() => {});
    setTemplates(getTemplates());
    const now = new Date();
    setCalDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  }, []);

  const handleRefresh = () => {
    setSpinning(true);
    setTimeout(() => setSpinning(false), 500);
    setVisible(shuffle(PLATFORM_SUGGESTIONS[platform] || []).slice(0, CARDS_PER_PAGE));
  };

  // ── Feature A: generate and save to history ─────────────────────────────
  const generate = async () => {
    if (!customPrompt.trim()) return;
    setLoading(true);
    setError('');
    setOutput('');
    setVariantMode(false);
    setAllPlatMode(false);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'social', platform, customPrompt, language, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
      logActivity('content_generated', `${platform.charAt(0).toUpperCase() + platform.slice(1)} içeriği üretildi`, `${data.content.length} karakter · ${language.toUpperCase()}`);
      // Save to history
      saveToHistory({ platform, language, content: data.content, prompt: customPrompt })
        .then(setHistory).catch(() => {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : (lang === 'tr' ? 'Hata oluştu' : 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  // ── Feature B: A/B Variant Generation (backend ab_test endpoint) ────────
  const generateVariants = async () => {
    if (!customPrompt.trim()) return;
    setVariantMode(true);
    setAllPlatMode(false);
    setOutput('');
    setError('');

    // Skeleton loading göster
    const TONE_META: Array<{ tone: string; label: string; emoji: string }> = [
      { tone: 'professional', label: 'Profesyonel & Otoriter', emoji: '🎯' },
      { tone: 'emotional',    label: 'Duygusal & İlham Verici', emoji: '❤️' },
      { tone: 'casual',       label: 'Samimi & Konuşma Dili',  emoji: '😊' },
    ];
    setVariants(TONE_META.map(t => ({ ...t, content: '', loading: true })));

    try {
      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:         'ab_test',
          platform,
          customPrompt,
          contentType:  'ilan_ozeti',
          language,
          textModel:    getTextModel(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Backend returns { variants: [{ label, tone, content }] }
      const fetched = (data.variants as Array<{ label: string; tone: string; content: string }>) || [];
      const results = TONE_META.map(t => {
        const match = fetched.find(f => f.tone === t.tone);
        return { ...t, content: match?.content || 'İçerik üretilemedi', loading: false };
      });
      setVariants(results);
      logActivity('content_generated', `A/B test üretildi (${platform})`, `3 varyant · ${language.toUpperCase()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
      setVariants(TONE_META.map(t => ({ ...t, content: `${lang === 'tr' ? 'Hata' : 'Error'}: ${msg}`, loading: false })));
    }
  };

  const useVariant = (content: string) => {
    setOutput(content);
    setVariantMode(false);
    saveToHistory({ platform, language, content, prompt: customPrompt })
      .then(setHistory).catch(() => {});
  };

  // ── Feature C: All Platforms ──────────────────────────────────────────────
  const generateAllPlatforms = async () => {
    if (!customPrompt.trim()) return;
    setAllPlatMode(true);
    setVariantMode(false);
    setOutput('');
    setError('');

    const initialData: PlatformContent[] = PLATFORMS.map(p => ({
      platform: p.value,
      content: '',
      loading: true,
      error: '',
      expanded: true,
      editing: false,
      editValue: '',
    }));
    setAllPlatData(initialData);

    const promises = PLATFORMS.map(async (p) => {
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'social', platform: p.value, customPrompt, language, textModel: getTextModel() }),
        });
        const data = await res.json();
        return {
          platform: p.value,
          content: data.error ? '' : data.content,
          loading: false,
          error: data.error || '',
          expanded: true,
          editing: false,
          editValue: data.error ? '' : data.content,
        };
      } catch {
        return { platform: p.value, content: '', loading: false, error: lang === 'tr' ? 'Hata oluştu' : 'An error occurred', expanded: true, editing: false, editValue: '' };
      }
    });

    const results = await Promise.all(promises);
    setAllPlatData(results);
  };

  const toggleAllPlatExpand = (idx: number) => {
    setAllPlatData(prev => prev.map((p, i) => i === idx ? { ...p, expanded: !p.expanded } : p));
  };

  const startEditAllPlat = (idx: number) => {
    setAllPlatData(prev => prev.map((p, i) => i === idx ? { ...p, editing: true, editValue: p.content } : p));
  };

  const saveEditAllPlat = (idx: number) => {
    setAllPlatData(prev => prev.map((p, i) => i === idx ? { ...p, editing: false, content: p.editValue } : p));
  };

  const copyAllPlat = async (content: string) => {
    await navigator.clipboard.writeText(content);
  };

  // ── Feature D: Add to Calendar ────────────────────────────────────────────
  const saveToCalendar = () => {
    if (!output || !calDate) return;
    void addEvent({ date: calDate, platform, content: output, language, published: false });
    setCalSaved(true);
    setShowCalForm(false);
    setTimeout(() => setCalSaved(false), 3000);
  };

  // ── Feature F: Prompt Templates ───────────────────────────────────────────
  const handleSaveTemplate = () => {
    if (!customPrompt.trim() || !tplName.trim()) return;
    const updated = saveTemplate({ name: tplName, platform, prompt: customPrompt, language });
    setTemplates(updated);
    setTplName('');
    setShowSaveTpl(false);
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(deleteTemplate(id));
  };

  const useTemplate = (tpl: PromptTemplate) => {
    setCustomPrompt(tpl.prompt);
    setPlatform(tpl.platform);
    setLanguage(tpl.language);
    setStratPanel('strategy');
  };

  // ── Feature A: History item restore ─────────────────────────────────────
  const restoreHistory = (item: HistoryItem) => {
    setCustomPrompt(item.prompt);
    setOutput(item.content);
    setPlatform(item.platform);
    setLanguage(item.language as 'tr' | 'en');
    setShowHistory(false);
    setVariantMode(false);
    setAllPlatMode(false);
  };

  const handleDeleteHistory = (id: string) => {
    deleteFromHistory(id).then(setHistory).catch(() => {});
  };

  const handleClearHistory = () => {
    clearHistory().then(() => setHistory([])).catch(() => {});
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-9 gap-6">
      {sharePlatItem && (
        <SharePanel
          content={sharePlatItem.content}
          onClose={() => setSharePlatItem(null)}
        />
      )}

      {/* ── Sol panel ── */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">
            {lang === 'tr' ? 'Sosyal Medya İçerik Üretici' : 'Social Media Content Generator'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr' ? 'Platform seç, strateji belirle, AI ile üret.' : 'Select platform, define strategy, generate with AI.'}
          </p>
        </div>

        {/* Platform seçimi */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {lang === 'tr' ? 'Platform' : 'Platform'}
          </label>
          <div className="grid grid-cols-5 gap-1">
            {PLATFORMS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPlatform(p.value); setOutput(''); setError(''); setVariantMode(false); setAllPlatMode(false); }}
                className={`flex flex-col items-center py-2 px-1 rounded-lg text-xs font-medium transition-colors gap-1 ${
                  platform === p.value
                    ? 'bg-ocean text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                <span className="text-base">{p.label.split(' ')[0]}</span>
                <span className="leading-tight text-center" style={{ fontSize: '10px' }}>
                  {p.label.split(' ').slice(1).join(' ')}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Dil seçimi */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {lang === 'tr' ? 'İçerik Dili' : 'Content Language'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
              { value: 'en', flag: '🇬🇧', label: 'English' },
            ] as { value: 'tr' | 'en'; flag: string; label: string }[]).map(l => (
              <button
                key={l.value}
                onClick={() => setLanguage(l.value)}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors border-2 ${
                  language === l.value
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50 hover:bg-slate-50 dark:hover:bg-slate-600'
                }`}
              >
                <span className="text-base">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Serbest prompt alanı */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {lang === 'tr' ? 'Ne üretmek istiyorsun?' : 'What do you want to generate?'}
          </label>
          <textarea
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder="Bir strateji kartına tıkla ya da kendin yaz..."
            rows={4}
            className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean resize-none placeholder:text-slate-400 dark:placeholder:text-slate-500 leading-relaxed"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {lang === 'tr' ? 'Ne kadar detaylı yazarsan o kadar iyi sonuç alırsın.' : 'The more detail you provide, the better results you get.'}
          </p>
          {/* Feature F: Save template button */}
          {customPrompt.trim() && (
            <div>
              {showSaveTpl ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={tplName}
                    onChange={e => setTplName(e.target.value)}
                    placeholder="Şablon adı..."
                    className="flex-1 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={!tplName.trim()}
                    className="text-xs bg-ocean disabled:opacity-40 text-white px-2 py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                  >
                    {lang === 'tr' ? 'Kaydet' : 'Save'}
                  </button>
                  <button
                    onClick={() => setShowSaveTpl(false)}
                    className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveTpl(true)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-ocean dark:hover:text-ocean border border-dashed border-slate-300 dark:border-slate-600 hover:border-ocean/50 px-3 py-1.5 rounded-lg transition-colors w-full"
                >
                  💾 {lang === 'tr' ? 'Şablon Kaydet' : 'Save Template'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main generate button */}
        <button
          onClick={generate}
          disabled={loading || !customPrompt.trim()}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Üretiliyor...' : 'Generating...'}</>
          ) : (
            <>{language === 'tr' ? '🇹🇷' : '🇬🇧'} {lang === 'tr' ? 'İçerik Üret' : 'Generate Content'}</>
          )}
        </button>

        {/* Feature B: A/B Variant button */}
        <button
          onClick={generateVariants}
          disabled={loading || !customPrompt.trim()}
          title="3 farklı ton (Profesyonel / Duygusal / Samimi) paralelde üretilir, en iyi varyantı seç"
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          🧪 {lang === 'tr' ? 'A/B Test (3 Ton)' : 'A/B Test (3 Tones)'}
        </button>

        {/* Feature C: All platforms button */}
        <button
          onClick={generateAllPlatforms}
          disabled={loading || !customPrompt.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          🌐 {lang === 'tr' ? 'Tüm Platformlara' : 'All Platforms'}
        </button>
      </div>

      {/* ── Orta: Strateji kartları + Şablonlar ── */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-4">
        {/* Panel toggle header */}
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
            <button
              onClick={() => setStratPanel('strategy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stratPanel === 'strategy' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              🎯 {lang === 'tr' ? 'Strateji' : 'Strategy'}
            </button>
            <button
              onClick={() => setStratPanel('templates')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stratPanel === 'templates' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              📁 {lang === 'tr' ? 'Şablonlar' : 'Templates'}
              {templates.length > 0 && (
                <span className="bg-ocean text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {templates.length}
                </span>
              )}
            </button>
          </div>
          {stratPanel === 'strategy' && (
            <button
              onClick={handleRefresh}
              title="Yeni öneriler getir"
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-ocean hover:text-ocean-dark border border-ocean/30 hover:border-ocean/60 bg-ocean/5 hover:bg-ocean/10 rounded-lg px-3 py-1.5 transition-all"
            >
              <span className={`inline-block transition-transform duration-500 ${spinning ? 'rotate-[360deg]' : ''}`}
                    style={{ transitionTimingFunction: 'ease-in-out' }}>🔄</span>
              {lang === 'tr' ? 'Yenile' : 'Refresh'}
            </button>
          )}
        </div>

        {/* Strategy panel */}
        {stratPanel === 'strategy' && (
          <>
            <p className="text-xs text-slate-400 dark:text-slate-500">Tıkla, düzenle, üret — her kart bir içerik stratejisi</p>
            <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: '420px' }}>
              {visibleSuggestions.length === 0 && (
                <div className="flex flex-col gap-2.5">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 animate-pulse">
                      <div className="flex gap-2.5">
                        <div className="w-6 h-6 bg-slate-100 dark:bg-slate-700 rounded shrink-0" />
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/3" />
                          <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-2/3" />
                          <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {visibleSuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setCustomPrompt(s.prompt)}
                  className={`group text-left rounded-xl border p-3.5 transition-all hover:shadow-sm ${
                    customPrompt === s.prompt
                      ? 'border-ocean bg-ocean/5 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 hover:border-ocean/40 bg-white dark:bg-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-700/80'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg shrink-0 mt-0.5">{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.category}</span>
                        {customPrompt === s.prompt && (
                          <span className="text-[10px] bg-ocean text-white px-1.5 py-0.5 rounded-full font-medium">Seçili</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">{s.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">{s.prompt}</p>
                      <div className="mt-2 flex items-center gap-1.5 opacity-70">
                        <span className="text-[10px]">💡</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 italic">{s.tip}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Templates panel */}
        {stratPanel === 'templates' && (
          <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: '450px' }}>
            {templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                <span className="text-3xl opacity-30">📁</span>
                <p className="text-xs text-center text-slate-500 dark:text-slate-400">Henüz şablon yok.</p>
                <p className="text-xs text-center text-slate-400 dark:text-slate-500">Bir prompt yaz ve 💾 ile kaydet.</p>
              </div>
            ) : (
              templates.map(tpl => (
                <div
                  key={tpl.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-800 hover:border-ocean/40 transition-all"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg shrink-0 mt-0.5">{PLATFORM_ICONS[tpl.platform] || '📝'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{tpl.name}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">{tpl.platform}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{tpl.language === 'tr' ? '🇹🇷' : '🇬🇧'}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">{tpl.prompt}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => useTemplate(tpl)}
                      className="flex-1 text-xs bg-ocean text-white py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                    >
                      {lang === 'tr' ? 'Kullan' : 'Use'}
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="text-xs px-2 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Sağ: Çıktı ── */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 min-w-0">
        {/* Output header with history and calendar toggle */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2 flex-1">
            <span>📄</span>
            {variantMode ? 'A/B Varyantlar' : allPlatMode ? (lang === 'tr' ? 'Tüm Platformlar' : 'All Platforms') : (lang === 'tr' ? 'Üretilen İçerik' : 'Generated Content')}
          </h3>
          <div className="flex gap-2">
            {/* Feature A: History toggle */}
            <button
              onClick={() => setShowHistory(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                showHistory
                  ? 'bg-amber-500 text-white border-amber-500'
                  : history.length > 0
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                  : 'bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              📚 {lang === 'tr' ? 'Geçmiş' : 'History'} {history.length > 0 && <span className="bg-amber-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">{history.length}</span>}
            </button>
            {/* Feature D: Calendar add button */}
            {output && !variantMode && !allPlatMode && (
              <button
                onClick={() => setShowCalForm(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                  calSaved
                    ? 'bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                    : showCalForm
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {calSaved
                  ? `✅ ${lang === 'tr' ? 'Takvime Eklendi!' : 'Added to Calendar!'}`
                  : `📅 ${lang === 'tr' ? 'Takvime Ekle' : 'Add to Calendar'}`}
              </button>
            )}
          </div>
        </div>

        {/* Feature A: History panel */}
        {showHistory && (
          <div className="mb-4 border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                📚 {lang === 'tr' ? 'İçerik Geçmişi' : 'Content History'}
              </span>
              <button
                onClick={handleClearHistory}
                className="text-[11px] text-red-500 hover:text-red-700 font-medium"
              >
                🗑️ {lang === 'tr' ? 'Geçmişi Temizle' : 'Clear History'}
              </button>
            </div>
            {history.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Şimdiye kadar içerik üretilmedi' : 'No content generated yet'}
              </div>
            ) : (
              <div className="divide-y divide-amber-100 dark:divide-amber-900/30 max-h-52 overflow-y-auto">
                {history.map(item => (
                  <div key={item.id} className="flex items-start gap-2 px-3 py-2 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
                    <button
                      onClick={() => restoreHistory(item)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs">{PLATFORM_ICONS[item.platform] || '📝'}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">{item.platform}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.language === 'tr' ? '🇹🇷' : '🇬🇧'}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">{timeAgo(item.timestamp)}</span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2 leading-relaxed">
                        {item.content.slice(0, 100)}{item.content.length > 100 ? '...' : ''}
                      </p>
                    </button>
                    <button
                      onClick={() => handleDeleteHistory(item.id)}
                      className="text-slate-300 dark:text-slate-600 hover:text-red-500 text-xs shrink-0 mt-1 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feature D: Calendar form */}
        {showCalForm && output && (
          <div className="mb-4 border border-ocean/30 rounded-xl p-3 bg-ocean/5 dark:bg-ocean/10">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
              📅 {lang === 'tr' ? 'Takvime Ekle Formu' : 'Add to Calendar Form'}
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">
                  {lang === 'tr' ? 'Tarih' : 'Date'}
                </label>
                <input
                  type="date"
                  value={calDate}
                  onChange={e => setCalDate(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-700 dark:text-slate-100"
                />
              </div>
              <button
                onClick={saveToCalendar}
                className="bg-ocean hover:bg-ocean-dark text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {lang === 'tr' ? 'Takvime Ekle' : 'Add to Calendar'}
              </button>
              <button
                onClick={() => setShowCalForm(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                {lang === 'tr' ? 'İptal' : 'Cancel'}
              </button>
            </div>
          </div>
        )}

        {/* Feature B: A/B Variant mode */}
        {variantMode && (
          <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVariantMode(false)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
                >
                  ← {lang === 'tr' ? 'Geri' : 'Back'}
                </button>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  🧪 {lang === 'tr' ? 'A/B Test — 3 farklı ton karşılaştırması' : 'A/B Test — 3 tone comparison'}
                </span>
              </div>
              {variants.every(v => !v.loading) && (
                <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                  ✓ {lang === 'tr' ? 'Hazır' : 'Ready'}
                </span>
              )}
            </div>

            {variants.map((v, i) => (
              <div
                key={i}
                className={`border rounded-xl overflow-hidden transition-all ${
                  v.loading
                    ? 'border-slate-200 dark:border-slate-700'
                    : 'border-slate-200 dark:border-slate-700 hover:border-ocean/40 dark:hover:border-ocean/40'
                }`}
              >
                {/* Variant header */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/80 border-b border-slate-200 dark:border-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{v.emoji}</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{v.label}</span>
                    {!v.loading && v.content && !v.content.startsWith('Hata') && !v.content.startsWith('Error') && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {v.content.length} {lang === 'tr' ? 'kar.' : 'chars.'}
                      </span>
                    )}
                  </div>
                  {!v.loading && v.content && !v.content.startsWith('Hata') && !v.content.startsWith('Error') && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { navigator.clipboard.writeText(v.content); }}
                        className="text-[11px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                      >
                        📋 {lang === 'tr' ? 'Kopyala' : 'Copy'}
                      </button>
                      <button
                        onClick={() => useVariant(v.content)}
                        className="text-[11px] bg-ocean text-white px-2.5 py-1 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                      >
                        {lang === 'tr' ? 'Bunu Kullan →' : 'Use This →'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Variant body */}
                <div className="p-3">
                  {v.loading ? (
                    <div className="flex items-center gap-2 py-5 justify-center text-slate-400">
                      <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">{lang === 'tr' ? 'Üretiliyor...' : 'Generating...'}</span>
                    </div>
                  ) : v.content.startsWith('Hata') || v.content.startsWith('Error') ? (
                    <p className="text-xs text-red-500 py-2">{v.content}</p>
                  ) : (
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap line-clamp-6">
                      {v.content}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Bottom hint */}
            {variants.every(v => !v.loading) && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                💡 {lang === 'tr'
                  ? '"Bunu Kullan" ile seçtiğin varyantı OutputPanel\'e al, görsel üret ve paylaş.'
                  : 'Use "Use This" to send the selected variant to the OutputPanel, generate visuals and share.'}
              </p>
            )}
          </div>
        )}

        {/* Feature C: All platforms mode */}
        {allPlatMode && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => setAllPlatMode(false)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
              >
                ← {lang === 'tr' ? 'Geri' : 'Back'}
              </button>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Tüm platformlar için içerik üretiliyor...' : 'Generating content for all platforms...'}
              </span>
            </div>
            {allPlatData.map((p, i) => (
              <div key={p.platform} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleAllPlatExpand(i)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border-b border-slate-200 dark:border-slate-600 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{PLATFORM_ICONS[p.platform]}</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{p.platform}</span>
                    {p.loading && <div className="w-3 h-3 border-2 border-ocean border-t-transparent rounded-full animate-spin" />}
                    {!p.loading && p.content && <span className="text-[10px] text-green-600 dark:text-green-400">✓ {lang === 'tr' ? 'Hazır' : 'Ready'}</span>}
                    {!p.loading && p.error && <span className="text-[10px] text-red-500">✕ {lang === 'tr' ? 'Hata' : 'Error'}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!p.loading && p.content && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); copyAllPlat(p.editing ? p.editValue : p.content); }}
                          className="text-[10px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                        >
                          📋 {lang === 'tr' ? 'Kopyala' : 'Copy'}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); startEditAllPlat(i); }}
                          className="text-[10px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                        >
                          ✏️ {lang === 'tr' ? 'Düzenle' : 'Edit'}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setSharePlatItem({ content: p.editing ? p.editValue : p.content, platform: p.platform }); }}
                          className="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded font-medium transition-colors"
                        >
                          📤 {lang === 'tr' ? 'Paylaş' : 'Share'}
                        </button>
                      </>
                    )}
                    <span className="text-slate-400 dark:text-slate-500 text-xs">{p.expanded ? '▲' : '▼'}</span>
                  </div>
                </button>
                {p.expanded && (
                  <div className="p-3">
                    {p.loading ? (
                      <div className="flex items-center gap-2 py-4 justify-center text-slate-400">
                        <div className="w-4 h-4 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs">{lang === 'tr' ? 'İçerik Üretiliyor' : 'Generating Content'}</span>
                      </div>
                    ) : p.error ? (
                      <p className="text-xs text-red-500">{p.error}</p>
                    ) : p.editing ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={p.editValue}
                          onChange={e => setAllPlatData(prev => prev.map((pp, ii) => ii === i ? { ...pp, editValue: e.target.value } : pp))}
                          rows={5}
                          className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-700 dark:text-slate-100"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEditAllPlat(i)}
                            className="flex-1 text-xs bg-ocean text-white py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                          >
                            {lang === 'tr' ? 'Kaydet' : 'Save'}
                          </button>
                          <button
                            onClick={() => setAllPlatData(prev => prev.map((pp, ii) => ii === i ? { ...pp, editing: false } : pp))}
                            className="text-xs border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            {lang === 'tr' ? 'İptal' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">{p.content}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Normal output mode */}
        {!variantMode && !allPlatMode && (
          <OutputPanel content={output} loading={loading} error={error} platform={platform} contentType="ilan_ozeti" />
        )}
      </div>
    </div>
  );
}

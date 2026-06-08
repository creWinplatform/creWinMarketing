'use client';
import { useState, useEffect, useRef } from 'react';
import OutputPanel from '../OutputPanel';
import SharePanel from '../SharePanel';
import { getTextModel, getImageModel } from '../ModelPicker';
import { compositePostImage } from '@/lib/image-composite';
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
  categoryTr: string;
  categoryEn: string;
  labelTr:  string;
  labelEn:  string;
  prompt:   string;
  tipTr:    string;
  tipEn:    string;
}

const PLATFORM_SUGGESTIONS: Record<string, Suggestion[]> = {
  instagram: [
    { icon: '🔥', categoryTr: 'Trend',        categoryEn: 'Trend',         labelTr: 'Viral Kariyer Serisi',   labelEn: 'Viral Career Series',    prompt: 'Denizcilik kariyerinde "kimse söylemez ama bilmen gereken 5 şey" temalı etkileyici bir Instagram carousel post hazırla',                                                          tipTr: 'Carousel postlar %3x daha fazla kayıt alır',           tipEn: 'Carousel posts get 3x more saves' },
    { icon: '💬', categoryTr: 'Engagement',   categoryEn: 'Engagement',    labelTr: 'Topluluk Sorusu',        labelEn: 'Community Question',     prompt: 'Denizcilerin aktif yorum yapacağı, gemide kariyer ilerleme zorluklarını paylaşacağı bir engagement sorusu ve caption yaz',                                                             tipTr: 'Soru içeren postlar %89 daha fazla yorum alır',        tipEn: 'Posts with questions get 89% more comments' },
    { icon: '📣', categoryTr: 'Marka',        categoryEn: 'Brand',         labelTr: 'Platform Tanıtımı',      labelEn: 'Platform Intro',         prompt: 'CrewinJob\'un BullsEye akıllı eşleştirme özelliğini Instagram\'a özel, gerçek bir denizci perspektifinden hikaye anlatısıyla tanıt',                                                   tipTr: 'Hikaye formatı güven ve dönüşüm artırır',              tipEn: 'Story format boosts trust and conversions' },
    { icon: '🌊', categoryTr: 'İlham',        categoryEn: 'Inspiration',   labelTr: 'Denizde Yaşam',          labelEn: 'Life at Sea',            prompt: 'Gemide çalışmanın benzersiz avantajlarını anlatan, denizcileri motive eden ve potansiyel adaylara ilham veren görsel odaklı bir post yaz',                                              tipTr: 'Duygusal içerik paylaşım oranını artırır',             tipEn: 'Emotional content increases share rate' },
    { icon: '🏅', categoryTr: 'Sosyal Kanıt', categoryEn: 'Social Proof',  labelTr: 'Başarı Hikayesi',        labelEn: 'Success Story',          prompt: 'CrewinJob sayesinde hayalindeki gemiye kavuşan bir denizcinin hikayesini kısa ve duygusal Instagram caption\'ı olarak yaz, story formatına da uygun olsun',                            tipTr: 'Sosyal kanıt dönüşüm oranını 2x artırır',              tipEn: 'Social proof 2x conversion rate' },
    { icon: '🎯', categoryTr: 'Dönüşüm',     categoryEn: 'Conversion',    labelTr: 'CTA Odaklı Post',        labelEn: 'CTA-Focused Post',       prompt: 'Denizci adaylarını CrewinJob\'a kayıt olmaya teşvik eden, güçlü CTA içeren, görsel açıklamalı bir Instagram post yaz. Aciliyet ve fırsat hissi ver.',                                 tipTr: 'Net CTA olan postlar %38 daha fazla tıklanır',         tipEn: 'Posts with clear CTAs get 38% more clicks' },
    { icon: '📊', categoryTr: 'Eğitim',      categoryEn: 'Education',     labelTr: 'İnfografik Caption',     labelEn: 'Infographic Caption',    prompt: '"Denizcilik sertifika yol haritası" konusunu Instagram infografik tarzında 5 adımda anlatan, kaydedilmeye değer bir caption yaz',                                                       tipTr: 'Eğitim içeriği kaydetme oranını artırır',              tipEn: 'Educational content increases save rate' },
    { icon: '🌟', categoryTr: 'Motivasyon',  categoryEn: 'Motivation',    labelTr: 'Haftanın İlanı',         labelEn: 'Job of the Week',        prompt: 'Bu haftanın en öne çıkan denizcilik ilanını Instagram\'a özel heyecan yaratan bir dille tanıt, hedef kitleyi doğrudan başvurmaya yönlendir',                                           tipTr: 'Düzenli ilan postları takipçi sadakatini artırır',     tipEn: 'Regular job posts build follower loyalty' },
  ],
  facebook: [
    { icon: '📊', categoryTr: 'Haftalık',     categoryEn: 'Weekly',        labelTr: 'İlan Bülteni',           labelEn: 'Job Bulletin',           prompt: 'Haftanın öne çıkan denizcilik iş ilanlarını özet formatında paylaş, her ilanın neden cazip olduğunu açıkla ve etkileşimi artıracak bir soru ile bitir',                                tipTr: 'Düzenli bültenler %60 daha fazla takipçi sadakati sağlar', tipEn: 'Regular bulletins give 60% more follower loyalty' },
    { icon: '🤝', categoryTr: 'Topluluk',     categoryEn: 'Community',     labelTr: 'Deneyim Paylaşımı',      labelEn: 'Experience Share',       prompt: 'Denizci topluluğunu en zorlu rotalarını ve en etkileyici limanlarını paylaşmaya davet eden, nostalji ve bağlılık yaratan bir post yaz',                                              tipTr: 'UGC organik erişimi 4x artırır',                       tipEn: 'UGC increases organic reach 4x' },
    { icon: '🎯', categoryTr: 'Dönüşüm',     categoryEn: 'Conversion',    labelTr: 'Platform Tanıtımı',      labelEn: 'Platform Intro',         prompt: 'CrewinJob\'un işe alım sürecini nasıl kolaylaştırdığını, rakiplerden farkını net biçimde anlatan, hem iş veren hem denizci perspektifinden ikna edici bir Facebook gönderisi yaz',    tipTr: 'Fayda odaklı içerik tıklanma oranını artırır',        tipEn: 'Benefit-focused content increases click rate' },
    { icon: '📰', categoryTr: 'Sektör',      categoryEn: 'Industry',      labelTr: 'Trend Analiz',           labelEn: 'Trend Analysis',         prompt: 'Denizcilik sektöründe güncel işe alım trendlerini, artan/azalan talep gören pozisyonları analiz eden bilgilendirici bir makale tarzı post yaz',                                        tipTr: 'Otorite içeriği marka güveni inşa eder',               tipEn: 'Authority content builds brand trust' },
    { icon: '🗳️', categoryTr: 'Engagement', categoryEn: 'Engagement',    labelTr: 'Anket & Tartışma',       labelEn: 'Poll & Discussion',      prompt: 'Denizcilik topluluğunda tartışma yaratacak bir anket oluştur: "Kontrat mı serbest mi tercih edersiniz?" gibi, yorumları tetikleyecek şekilde kur',                                     tipTr: 'Anketler organik erişimi 2x artırır',                  tipEn: 'Polls double organic reach' },
    { icon: '🚨', categoryTr: 'Acil İlan',   categoryEn: 'Urgent Job',    labelTr: 'Urgent Pozisyon',        labelEn: 'Urgent Position',        prompt: 'Acil doldurulması gereken kritik bir denizcilik pozisyonunu Facebook\'a özel aciliyet duygusuyla duyur, nitelikli adayları harekete geçir',                                           tipTr: 'Aciliyet içeren postlar paylaşım oranını artırır',     tipEn: 'Urgency posts increase share rate' },
    { icon: '🎉', categoryTr: 'Kutlama',     categoryEn: 'Milestone',     labelTr: 'Başarı Duyurusu',        labelEn: 'Success Announcement',   prompt: 'CrewinJob aracılığıyla işe alınan denizci sayısı veya şirket başarısını kutlayan, toplulukla birlikte kutlayan sıcak bir Facebook gönderisi yaz',                                      tipTr: 'Milestone içerikler marka bağlılığı kurar',            tipEn: 'Milestone content builds brand loyalty' },
    { icon: '💡', categoryTr: 'Eğitim',      categoryEn: 'Education',     labelTr: 'Kariyer İpucu',          labelEn: 'Career Tip',             prompt: 'Denizcilik kariyerinde ilerlemenin önündeki 3 yaygın engeli ve nasıl aşılacağını anlatan, değer odaklı ve paylaşılmaya değer bir Facebook içeriği yaz',                              tipTr: 'Değer içeriği organik paylaşımı artırır',              tipEn: 'Value content drives organic shares' },
  ],
  twitter: [
    { icon: '🧵', categoryTr: 'Thread',       categoryEn: 'Thread',        labelTr: 'Viral Thread',           labelEn: 'Viral Thread',           prompt: '5 tweet\'lik güçlü bir thread: Denizcilik kariyerine sıfırdan başlamak için adım adım rehber. Her tweet bağımsız ama birlikte güçlü olsun, hook tweet ile başla',                     tipTr: 'Thread\'ler tek tweet\'ten %60 daha fazla etkileşim alır', tipEn: 'Threads get 60% more engagement than single tweets' },
    { icon: '⚡', categoryTr: 'Anlık',        categoryEn: 'Breaking',      labelTr: 'Breaking Duyuru',        labelEn: 'Breaking Announcement',  prompt: 'Yeni açılan kritik denizcilik pozisyonlarını aciliyet ve fırsat hissiyle duyuran, 280 karakterde maksimum etki yaratan bir tweet yaz',                                               tipTr: 'Aciliyet içeren tweetler %22 daha fazla tıklanır',     tipEn: 'Urgency tweets get 22% more clicks' },
    { icon: '💡', categoryTr: 'Değer',        categoryEn: 'Value',         labelTr: 'Pro İpucu',              labelEn: 'Pro Tip',                prompt: 'Denizci adaylarının CV\'lerinde yaptığı en kritik 3 hatayı ve çözümünü anlatan, kaydedilip paylaşılacak değerde kısa ve net bir tweet yaz',                                         tipTr: '"Save worthy" içerik organik büyüme sağlar',           tipEn: '"Save worthy" content drives organic growth' },
    { icon: '📈', categoryTr: 'Sektör',      categoryEn: 'Industry',      labelTr: 'Trend Veri',             labelEn: 'Trend Data',             prompt: 'Denizcilik iş piyasasında bu ay en çok aranan pozisyonları, maaş aralıklarını ve kariyer fırsatlarını data odaklı, otoriter bir tonda paylaş',                                       tipTr: 'Veri içerikli tweetler %3x daha fazla RT alır',        tipEn: 'Data tweets get 3x more retweets' },
    { icon: '🔁', categoryTr: 'Engagement',  categoryEn: 'Engagement',    labelTr: 'RT Bait',                labelEn: 'RT Bait',                prompt: 'Denizcilerin "kesinlikle" diyerek RT atacağı, sektörle ilgili güçlü bir gerçeği veya tartışmalı görüşü içeren, kısa ve etkili bir tweet yaz',                                         tipTr: 'Güçlü görüşler RT oranını artırır',                    tipEn: 'Strong opinions increase RT rate' },
    { icon: '🎤', categoryTr: 'Otorite',     categoryEn: 'Authority',     labelTr: 'Uzman Görüşü',           labelEn: 'Expert Opinion',         prompt: 'Denizcilik işe alım sürecinde işverenlerin en çok hangi özelliklere baktığını anlatan, otoriter ve güvenilir bir uzman tweeti yaz',                                                  tipTr: 'Uzman içeriği takipçi güvenini artırır',               tipEn: 'Expert content builds follower trust' },
    { icon: '😄', categoryTr: 'Eğlenceli',   categoryEn: 'Fun',           labelTr: 'Denizci Humor',          labelEn: 'Seafarer Humor',         prompt: 'Denizcilerin gülerek paylaşacağı, gemi yaşamından ilham alan esprili ama profesyonel bir tweet yaz. CrewinJob markasıyla bağdaşmalı.',                                              tipTr: 'Eğlenceli içerik viral potansiyeli taşır',             tipEn: 'Fun content has viral potential' },
    { icon: '❓', categoryTr: 'Soru',        categoryEn: 'Question',      labelTr: 'Topluluk Sorusu',        labelEn: 'Community Question',     prompt: 'Denizcilik topluluğunu yanıt vermeye teşvik eden, ilgi çekici ve tartışma yaratan bir soru tweeti yaz. Kısa, net, merak uyandırıcı olsun.',                                          tipTr: 'Soru tweetleri yanıt oranını 3x artırır',              tipEn: 'Question tweets get 3x more replies' },
  ],
  linkedin: [
    { icon: '🏆', categoryTr: 'Liderlik',    categoryEn: 'Leadership',    labelTr: 'Otorite Makalesi',       labelEn: 'Authority Article',      prompt: 'Denizcilik sektöründe 2026 işe alım trendlerini derinlemesine analiz eden, sektör liderlerine hitap eden düşünce liderliği makalesi yaz. Veri ve içgörüler içersin.',             tipTr: 'Düşünce liderliği profil görüntülemesini 10x artırır', tipEn: 'Thought leadership 10x profile views' },
    { icon: '📖', categoryTr: 'Hikaye',      categoryEn: 'Story',         labelTr: 'Başarı Hikayesi',        labelEn: 'Success Story',          prompt: 'CrewinJob aracılığıyla hayalindeki pozisyona kavuşan bir denizcinin dönüşüm hikayesini, duygusal ve profesyonel bir dille LinkedIn formatında anlat',                              tipTr: 'Hikaye formatı bağlantı isteklerini %55 artırır',      tipEn: 'Story format increases connection requests by 55%' },
    { icon: '🎓', categoryTr: 'Eğitim',      categoryEn: 'Education',     labelTr: 'Kariyer Rehberi',        labelEn: 'Career Guide',           prompt: 'Denizcilik kariyerinde güverte zabitinden kaptana uzanan yolda gereken sertifikalar, deneyimler ve stratejileri adım adım açıklayan kapsamlı bir rehber yaz',                      tipTr: 'Eğitim içeriği en yüksek kaydetme oranına sahip',      tipEn: 'Educational content has the highest save rate' },
    { icon: '🤝', categoryTr: 'Network',     categoryEn: 'Network',       labelTr: 'Sektör Tartışması',      labelEn: 'Industry Discussion',    prompt: 'Denizcilik iş dünyasında tartışmalı ama düşündürücü bir soru sor: otomasyon denizci ihtiyacını azaltır mı? Farklı bakış açılarını dengeli sun.',                                    tipTr: 'Tartışma başlatan içerikler yorumları %3x artırır',    tipEn: 'Discussion content gets 3x more comments' },
    { icon: '📊', categoryTr: 'Veri',        categoryEn: 'Data',          labelTr: 'Sektör Raporu',          labelEn: 'Industry Report',        prompt: '2025-2026 denizcilik sektörü istihdam verilerini yorumlayan, hangi pozisyonların yükselişte olduğunu gösteren kısa bir LinkedIn analiz paylaşımı yaz',                            tipTr: 'Veri destekli içerik paylaşım oranını artırır',        tipEn: 'Data-backed content increases share rate' },
    { icon: '🔮', categoryTr: 'Vizyon',      categoryEn: 'Vision',        labelTr: 'Gelecek Tahmini',        labelEn: 'Future Forecast',        prompt: 'Denizcilik sektörünün önümüzdeki 5 yılını şekillendirecek 3 büyük trendi anlatan, vizyon sahibi ve ileriye bakışlı bir LinkedIn postu yaz',                                         tipTr: 'Vizyon içeriği thought leadership inşa eder',          tipEn: 'Vision content builds thought leadership' },
    { icon: '💼', categoryTr: 'İK & İşe Alım', categoryEn: 'HR & Hiring', labelTr: 'İşveren Perspektifi',  labelEn: 'Employer Perspective',   prompt: 'Denizcilik şirketlerinin iş ilanı yayınlarken yaptığı 5 kritik hatayla ve bunların nitelikli adayları nasıl kaçırdığını anlatan, işverenlere yönelik bir LinkedIn postu yaz',     tipTr: 'B2B içerik karar vericilere ulaşır',                   tipEn: 'B2B content reaches decision-makers' },
    { icon: '🌍', categoryTr: 'Global',      categoryEn: 'Global',        labelTr: 'Uluslararası Pazar',     labelEn: 'International Market',   prompt: 'Dünyanın en çok denizci istihdam eden 5 ülkesini ve CrewinJob\'un bu pazarlardaki rolünü anlatan, küresel perspektifli bir LinkedIn içeriği yaz',                                   tipTr: 'Global içerik uluslararası bağlantı çeker',            tipEn: 'Global content attracts international connections' },
  ],
  tiktok: [
    { icon: '🎬', categoryTr: 'POV',          categoryEn: 'POV',           labelTr: 'Liman İzin Günü',        labelEn: 'Port Day Off',           prompt: '"POV: Gemi adamısın ve bugün liman iznin var" formatında, Z kuşağına hitap eden, eğlenceli ve merak uyandıran 60 saniyelik TikTok video scripti yaz',                             tipTr: 'POV içerikler FYP\'de daha fazla önerilir',            tipEn: 'POV content gets more FYP recommendations' },
    { icon: '🪝', categoryTr: 'Hook',         categoryEn: 'Hook',          labelTr: 'Dur Kaydırma',           labelEn: 'Stop Scrolling',         prompt: '"Bu videoyu izlemeden denizci olma" hook\'lu, ilk 3 saniyede kaydırmayı durduracak güçlü bir açılışla başlayan kariyer motivasyon videosu scripti yaz',                           tipTr: 'İlk 3 saniye izlenmeyi belirler',                      tipEn: 'First 3 seconds determine watch rate' },
    { icon: '🌍', categoryTr: 'Yaşam Tarzı', categoryEn: 'Lifestyle',     labelTr: 'Dünya Turu',             labelEn: 'World Tour',             prompt: 'Bir denizci olarak ziyaret ettiğin en iyi 5 limanı, her birinde yaşadığın unutulmaz anlarla anlatan, seyahat tutkunu gençlere hitap eden TikTok scripti yaz',                     tipTr: 'Seyahat içerikleri genç kitlede %80 daha fazla paylaşılır', tipEn: 'Travel content is shared 80% more by younger audiences' },
    { icon: '💰', categoryTr: 'Motivasyon',  categoryEn: 'Motivation',    labelTr: 'Kazanç Gerçekliği',      labelEn: 'Earnings Reality',       prompt: 'Denizcilik kariyerinde gerçek kazanç rakamlarını şeffaf biçimde paylaşan, kariyer değişikliği düşünenlere hitap eden viral potansiyelli bir TikTok videosu yaz',                   tipTr: 'Kazanç içerikleri hedef kitlede yüksek ilgi görür',    tipEn: 'Earnings content drives high interest in target audience' },
    { icon: '😱', categoryTr: 'Surpriz',     categoryEn: 'Surprise',      labelTr: 'Beklenmedik Gerçekler',  labelEn: 'Unexpected Facts',       prompt: '"Gemide çalışmadan önce bilmediğim 5 şey" formatında, izleyiciyi şaşırtacak, merak uyandıracak ve sektörü tanıtacak bir TikTok video scripti yaz',                              tipTr: 'Surpriz içerik izlenme süresini artırır',              tipEn: 'Surprise content increases watch time' },
    { icon: '🎓', categoryTr: 'Eğitim',      categoryEn: 'Education',     labelTr: 'Hızlı Kariyer Rehberi', labelEn: 'Quick Career Guide',     prompt: '"30 saniyede denizcilik kariyerine nasıl başlarsın" formatında, bilgi yoğun, hızlı tempolu ve aksiyon odaklı bir TikTok scripti yaz',                                              tipTr: 'Bilgi yoğun içerik kaydetme oranını artırır',          tipEn: 'Info-dense content increases save rate' },
    { icon: '🏆', categoryTr: 'Challenge',   categoryEn: 'Challenge',     labelTr: 'Viral Challenge',        labelEn: 'Viral Challenge',        prompt: 'Denizcilik topluluğunu harekete geçirecek, taklit edilebilir ve CrewinJob markasını organik yayacak bir TikTok challenge konsepti ve video scripti yaz',                          tipTr: 'Challenge içerikler UGC ve marka bilinirliği yaratır', tipEn: 'Challenge content drives UGC and brand awareness' },
    { icon: '🌅', categoryTr: 'Atmosfer',    categoryEn: 'Atmosphere',    labelTr: 'Gündoğumu Nöbeti',       labelEn: 'Sunrise Watch',          prompt: '"Okyanusun ortasında gündoğumu nöbeti" temalı, denizciliğin poetik ve büyüleyici yönünü anlatan, izleyiciyi büyüleyecek sinematik tarzda bir TikTok scripti yaz',               tipTr: 'Estetik içerik \'duygusal\' kitleyi çeker',            tipEn: 'Aesthetic content attracts the emotional audience' },
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

function timeAgo(ts: number, lang: 'tr' | 'en'): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return lang === 'tr' ? 'az önce' : 'just now';
  if (mins < 60) return lang === 'tr' ? `${mins} dk` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === 'tr' ? `${hrs} sa` : `${hrs}h`;
  return lang === 'tr' ? `${Math.floor(hrs / 24)} gün` : `${Math.floor(hrs / 24)}d`;
}

const CARDS_PER_PAGE = 4;

interface Variant {
  tone:    string;
  labelTr: string;
  labelEn: string;
  emoji:   string;
  content: string;
  loading: boolean;
}

const LOGO_KEY = 'crewinjob_brand_logo';

interface PlatformContent {
  platform:     string;
  content:      string;
  loading:      boolean;
  error:        string;
  expanded:     boolean;
  editing:      boolean;
  editValue:    string;
  imageData?:   string;
  imageMime?:   string;
  imageLoading?: boolean;
  imageError?:  string;
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

  const [history,     setHistory]    = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [variantMode, setVariantMode] = useState(false);
  const [variants,    setVariants]    = useState<Variant[]>([]);

  const [allPlatMode, setAllPlatMode] = useState(false);
  const [allPlatData, setAllPlatData] = useState<PlatformContent[]>([]);

  const [sharePlatItem,    setSharePlatItem]    = useState<{ content: string; platform: string; imageData?: string; imageMime?: string } | null>(null);
  const [logoBase64,       setLogoBase64]       = useState('');
  const [allPlatImage,     setAllPlatImage]     = useState('');
  const [allPlatImgLoading,setAllPlatImgLoading]= useState(false);
  const [allPlatImgError,  setAllPlatImgError]  = useState('');
  // Ham görsel (composite öncesi) — başlık değişince yeniden composite için cache
  const [rawBg,            setRawBg]            = useState('');   // base64
  const [rawBgMime,        setRawBgMime]        = useState('');   // e.g. image/jpeg
  // Başlık düzenleme
  const [customHeadline,   setCustomHeadline]   = useState('');
  const [headlineSuggestions, setHeadlineSuggestions] = useState<string[]>([]);
  const [headlineApplying, setHeadlineApplying] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [showCalForm, setShowCalForm] = useState(false);
  const [calDate,     setCalDate]     = useState('');
  const [calSaved,    setCalSaved]    = useState(false);

  const [templates,    setTemplates]   = useState<PromptTemplate[]>([]);
  const [stratPanel,   setStratPanel]  = useState<'strategy' | 'templates'>('strategy');
  const [showSaveTpl,  setShowSaveTpl] = useState(false);
  const [tplName,      setTplName]     = useState('');

  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;

  useEffect(() => {
    setVisible(shuffle(PLATFORM_SUGGESTIONS[platform] || []).slice(0, CARDS_PER_PAGE));
  }, [platform]);

  useEffect(() => {
    getHistory().then(setHistory).catch(() => {});
    setTemplates(getTemplates());
    const now = new Date();
    setCalDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    try { const l = localStorage.getItem(LOGO_KEY); if (l) setLogoBase64(l); } catch { /* ignore */ }
  }, []);

  const handleRefresh = () => {
    setSpinning(true);
    setTimeout(() => setSpinning(false), 500);
    setVisible(shuffle(PLATFORM_SUGGESTIONS[platform] || []).slice(0, CARDS_PER_PAGE));
  };

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
      logActivity('content_generated', t(`${platform} içeriği üretildi`, `${platform} content generated`), `${data.content.length} ${t('karakter', 'chars')} · ${language.toUpperCase()}`);
      saveToHistory({ platform, language, content: data.content, prompt: customPrompt })
        .then(setHistory).catch(() => {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('Hata oluştu', 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const TONE_META: Array<{ tone: string; labelTr: string; labelEn: string; emoji: string }> = [
    { tone: 'professional', labelTr: 'Profesyonel & Otoriter', labelEn: 'Professional & Authoritative', emoji: '🎯' },
    { tone: 'emotional',    labelTr: 'Duygusal & İlham Verici', labelEn: 'Emotional & Inspiring',        emoji: '❤️' },
    { tone: 'casual',       labelTr: 'Samimi & Konuşma Dili',  labelEn: 'Casual & Conversational',      emoji: '😊' },
  ];

  const generateVariants = async () => {
    if (!customPrompt.trim()) return;
    setVariantMode(true);
    setAllPlatMode(false);
    setOutput('');
    setError('');
    setVariants(TONE_META.map(tm => ({ ...tm, content: '', loading: true })));

    try {
      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'ab_test', platform, customPrompt, contentType: 'ilan_ozeti', language, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const fetched = (data.variants as Array<{ label: string; tone: string; content: string }>) || [];
      const results = TONE_META.map(tm => {
        const match = fetched.find(f => f.tone === tm.tone);
        return { ...tm, content: match?.content || t('İçerik üretilemedi', 'Content could not be generated'), loading: false };
      });
      setVariants(results);
      logActivity('content_generated', t(`A/B test üretildi (${platform})`, `A/B test generated (${platform})`), `3 ${t('varyant', 'variants')} · ${language.toUpperCase()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('Hata oluştu', 'An error occurred');
      setVariants(TONE_META.map(tm => ({ ...tm, content: `${t('Hata', 'Error')}: ${msg}`, loading: false })));
    }
  };

  const useVariant = (content: string) => {
    setOutput(content);
    setVariantMode(false);
    saveToHistory({ platform, language, content, prompt: customPrompt })
      .then(setHistory).catch(() => {});
  };

  const generateAllPlatforms = async () => {
    if (!customPrompt.trim()) return;
    setAllPlatMode(true);
    setVariantMode(false);
    setOutput('');
    setError('');
    setAllPlatImage('');
    setAllPlatImgError('');

    const initialData: PlatformContent[] = PLATFORMS.map(p => ({
      platform: p.value, content: '', loading: true, error: '', expanded: true, editing: false, editValue: '',
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
          platform: p.value, content: data.error ? '' : data.content, loading: false,
          error: data.error || '', expanded: true, editing: false, editValue: data.error ? '' : data.content,
        };
      } catch {
        return { platform: p.value, content: '', loading: false, error: t('Hata oluştu', 'An error occurred'), expanded: true, editing: false, editValue: '' };
      }
    });

    const results = await Promise.all(promises);
    setAllPlatData(results);
  };

  /** İçerikten 3 başlık önerisi üretir */
  const extractSuggestions = (content: string, aiHeadline: string): string[] => {
    const words = content
      .replace(/[#*_]/g, '')           // hashtag/markdown temizle
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 12);
    const s1 = aiHeadline;
    const s2 = words.slice(0, 3).join(' ') + '\n' + words.slice(3, 6).join(' ');
    const s3 = words.slice(0, 5).join(' ');
    return [s1, s2, s3].filter((s, i, arr) => s.trim() && arr.indexOf(s) === i);
  };

  // Tüm platformlar için tek ortak görsel — varsayılan olarak instagram (1080x1080) üretilir
  const generateSharedImage = async () => {
    const firstContent = allPlatData.find(p => p.content)?.content || '';
    if (!firstContent) return;
    setAllPlatImgLoading(true);
    setAllPlatImgError('');
    setAllPlatImage('');
    setRawBg('');
    setCustomHeadline('');
    setHeadlineSuggestions([]);
    try {
      const res = await fetch('/api/generate-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform:    'instagram',
          contentType: 'ilan_ozeti',
          textContent: firstContent,
          imageModel:  getImageModel(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const mime     = (data.mimeType  as string) || 'image/jpeg';
      const rawB64   = data.imageData  as string;
      const headline = (data.headline  as string) || 'The Right Job\nThe Right Talent';

      // Ham görsel cache'le (başlık değişince yeniden composite yapmak için)
      setRawBg(rawB64);
      setRawBgMime(mime);

      // Başlık önerilerini üret
      const suggestions = extractSuggestions(firstContent, headline);
      setHeadlineSuggestions(suggestions);
      setCustomHeadline(headline);

      // instagram boyutunda composite — kare format tüm platformlara uyar
      const finalB64 = await compositePostImage(mime, rawB64, logoBase64, headline, 'instagram');
      setAllPlatImage(finalB64);
    } catch (e) {
      setAllPlatImgError(e instanceof Error ? e.message : t('Görsel oluşturulamadı', 'Image generation failed'));
    } finally {
      setAllPlatImgLoading(false);
    }
  };

  /** Mevcut ham görseli yeni başlıkla yeniden composite eder (API çağrısı yok) */
  const applyCustomHeadline = async () => {
    if (!rawBg || !customHeadline.trim()) return;
    setHeadlineApplying(true);
    try {
      const finalB64 = await compositePostImage(rawBgMime, rawBg, logoBase64, customHeadline, 'instagram');
      setAllPlatImage(finalB64);
    } finally {
      setHeadlineApplying(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = (ev.target?.result as string).split(',')[1];
      setLogoBase64(b64);
      try { localStorage.setItem(LOGO_KEY, b64); } catch { /* ignore */ }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoBase64('');
    try { localStorage.removeItem(LOGO_KEY); } catch { /* ignore */ }
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const downloadPlatformImage = async (plt: string) => {
    if (!allPlatImage) return;
    // Seçilen platform boyutuna uyarla
    const firstContent = allPlatData.find(p => p.content)?.content || '';
    try {
      const res = await fetch('/api/generate-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform:    plt,
          contentType: 'ilan_ozeti',
          textContent: firstContent,
          imageModel:  getImageModel(),
        }),
      });
      const data = await res.json();
      if (!data.error && data.imageData) {
        const mime     = (data.mimeType as string) || 'image/jpeg';
        const headline = (data.headline as string) || 'The Right Job\nThe Right Talent';
        const finalB64 = await compositePostImage(mime, data.imageData as string, logoBase64, headline, plt);
        const a = document.createElement('a');
        a.href     = `data:image/png;base64,${finalB64}`;
        a.download = `crewinjob_${plt}_${Date.now()}.png`;
        a.click();
        return;
      }
    } catch { /* fallback */ }
    // Fallback: mevcut görseli indir
    const a = document.createElement('a');
    a.href     = `data:image/png;base64,${allPlatImage}`;
    a.download = `crewinjob_${plt}_${Date.now()}.png`;
    a.click();
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

  const saveToCalendar = () => {
    if (!output || !calDate) return;
    void addEvent({ date: calDate, platform, content: output, language, published: false });
    setCalSaved(true);
    setShowCalForm(false);
    setTimeout(() => setCalSaved(false), 3000);
  };

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
          imageData={sharePlatItem.imageData}
          imageMime={sharePlatItem.imageMime}
          onClose={() => setSharePlatItem(null)}
        />
      )}

      {/* ── Left panel ── */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">
            {t('Sosyal Medya İçerik Üretici', 'Social Media Content Generator')}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {t('Platform seç, strateji belirle, AI ile üret.', 'Select platform, define strategy, generate with AI.')}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('Platform', 'Platform')}
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

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('İçerik Dili', 'Content Language')}
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

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('Ne üretmek istiyorsun?', 'What do you want to generate?')}
          </label>
          <textarea
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder={t('Bir strateji kartına tıkla ya da kendin yaz...', 'Click a strategy card or write your own...')}
            rows={4}
            className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean resize-none placeholder:text-slate-400 dark:placeholder:text-slate-500 leading-relaxed"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('Ne kadar detaylı yazarsan o kadar iyi sonuç alırsın.', 'The more detail you provide, the better results you get.')}
          </p>
          {customPrompt.trim() && (
            <div>
              {showSaveTpl ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={tplName}
                    onChange={e => setTplName(e.target.value)}
                    placeholder={t('Şablon adı...', 'Template name...')}
                    className="flex-1 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={!tplName.trim()}
                    className="text-xs bg-ocean disabled:opacity-40 text-white px-2 py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                  >
                    {t('Kaydet', 'Save')}
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
                  💾 {t('Şablon Kaydet', 'Save Template')}
                </button>
              )}
            </div>
          )}
        </div>

        <button
          onClick={generate}
          disabled={loading || !customPrompt.trim()}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {t('Üretiliyor...', 'Generating...')}</>
          ) : (
            <>{language === 'tr' ? '🇹🇷' : '🇬🇧'} {t('İçerik Üret', 'Generate Content')}</>
          )}
        </button>

        <button
          onClick={generateVariants}
          disabled={loading || !customPrompt.trim()}
          title={t('3 farklı ton (Profesyonel / Duygusal / Samimi) paralelde üretilir, en iyi varyantı seç', '3 tones (Professional / Emotional / Casual) generated in parallel — pick the best variant')}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          🧪 {t('A/B Test (3 Ton)', 'A/B Test (3 Tones)')}
        </button>

        <button
          onClick={generateAllPlatforms}
          disabled={loading || !customPrompt.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          🌐 {t('Tüm Platformlara', 'All Platforms')}
        </button>
      </div>

      {/* ── Middle: Strategy cards + Templates ── */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
            <button
              onClick={() => setStratPanel('strategy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stratPanel === 'strategy' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              🎯 {t('Strateji', 'Strategy')}
            </button>
            <button
              onClick={() => setStratPanel('templates')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stratPanel === 'templates' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              📁 {t('Şablonlar', 'Templates')}
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
              title={t('Yeni öneriler getir', 'Get new suggestions')}
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-ocean hover:text-ocean-dark border border-ocean/30 hover:border-ocean/60 bg-ocean/5 hover:bg-ocean/10 rounded-lg px-3 py-1.5 transition-all"
            >
              <span className={`inline-block transition-transform duration-500 ${spinning ? 'rotate-[360deg]' : ''}`}
                    style={{ transitionTimingFunction: 'ease-in-out' }}>🔄</span>
              {t('Yenile', 'Refresh')}
            </button>
          )}
        </div>

        {stratPanel === 'strategy' && (
          <>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t('Tıkla, düzenle, üret — her kart bir içerik stratejisi', 'Click, edit, generate — each card is a content strategy')}
            </p>
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
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {lang === 'tr' ? s.categoryTr : s.categoryEn}
                        </span>
                        {customPrompt === s.prompt && (
                          <span className="text-[10px] bg-ocean text-white px-1.5 py-0.5 rounded-full font-medium">
                            {t('Seçili', 'Selected')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
                        {lang === 'tr' ? s.labelTr : s.labelEn}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">{s.prompt}</p>
                      <div className="mt-2 flex items-center gap-1.5 opacity-70">
                        <span className="text-[10px]">💡</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                          {lang === 'tr' ? s.tipTr : s.tipEn}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {stratPanel === 'templates' && (
          <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: '450px' }}>
            {templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                <span className="text-3xl opacity-30">📁</span>
                <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                  {t('Henüz şablon yok.', 'No templates yet.')}
                </p>
                <p className="text-xs text-center text-slate-400 dark:text-slate-500">
                  {t('Bir prompt yaz ve 💾 ile kaydet.', 'Write a prompt and save it with 💾.')}
                </p>
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
                      {t('Kullan', 'Use')}
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

      {/* ── Right: Output ── */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 min-w-0">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2 flex-1">
            <span>📄</span>
            {variantMode
              ? t('A/B Varyantlar', 'A/B Variants')
              : allPlatMode
              ? t('Tüm Platformlar', 'All Platforms')
              : t('Üretilen İçerik', 'Generated Content')}
          </h3>
          <div className="flex gap-2">
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
              📚 {t('Geçmiş', 'History')} {history.length > 0 && <span className="bg-amber-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">{history.length}</span>}
            </button>
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
                  ? `✅ ${t('Takvime Eklendi!', 'Added to Calendar!')}`
                  : `📅 ${t('Takvime Ekle', 'Add to Calendar')}`}
              </button>
            )}
          </div>
        </div>

        {showHistory && (
          <div className="mb-4 border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                📚 {t('İçerik Geçmişi', 'Content History')}
              </span>
              <button onClick={handleClearHistory} className="text-[11px] text-red-500 hover:text-red-700 font-medium">
                🗑️ {t('Geçmişi Temizle', 'Clear History')}
              </button>
            </div>
            {history.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 dark:text-slate-500">
                {t('Şimdiye kadar içerik üretilmedi', 'No content generated yet')}
              </div>
            ) : (
              <div className="divide-y divide-amber-100 dark:divide-amber-900/30 max-h-52 overflow-y-auto">
                {history.map(item => (
                  <div key={item.id} className="flex items-start gap-2 px-3 py-2 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
                    <button onClick={() => restoreHistory(item)} className="flex-1 text-left">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs">{PLATFORM_ICONS[item.platform] || '📝'}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">{item.platform}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.language === 'tr' ? '🇹🇷' : '🇬🇧'}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">{timeAgo(item.timestamp, lang)}</span>
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

        {showCalForm && output && (
          <div className="mb-4 border border-ocean/30 rounded-xl p-3 bg-ocean/5 dark:bg-ocean/10">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
              📅 {t('Takvime Ekle Formu', 'Add to Calendar')}
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">
                  {t('Tarih', 'Date')}
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
                {t('Takvime Ekle', 'Add to Calendar')}
              </button>
              <button
                onClick={() => setShowCalForm(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                {t('İptal', 'Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* A/B Variant mode */}
        {variantMode && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVariantMode(false)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
                >
                  ← {t('Geri', 'Back')}
                </button>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  🧪 {t('A/B Test — 3 farklı ton karşılaştırması', 'A/B Test — 3 tone comparison')}
                </span>
              </div>
              {variants.every(v => !v.loading) && (
                <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                  ✓ {t('Hazır', 'Ready')}
                </span>
              )}
            </div>

            {variants.map((v, i) => (
              <div
                key={i}
                className={`border rounded-xl overflow-hidden transition-all ${
                  v.loading ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700 hover:border-ocean/40 dark:hover:border-ocean/40'
                }`}
              >
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/80 border-b border-slate-200 dark:border-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{v.emoji}</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {lang === 'tr' ? v.labelTr : v.labelEn}
                    </span>
                    {!v.loading && v.content && !v.content.startsWith('Hata') && !v.content.startsWith('Error') && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {v.content.length} {t('kar.', 'chars.')}
                      </span>
                    )}
                  </div>
                  {!v.loading && v.content && !v.content.startsWith('Hata') && !v.content.startsWith('Error') && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { navigator.clipboard.writeText(v.content); }}
                        className="text-[11px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                      >
                        📋 {t('Kopyala', 'Copy')}
                      </button>
                      <button
                        onClick={() => useVariant(v.content)}
                        className="text-[11px] bg-ocean text-white px-2.5 py-1 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                      >
                        {t('Bunu Kullan →', 'Use This →')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3">
                  {v.loading ? (
                    <div className="flex items-center gap-2 py-5 justify-center text-slate-400">
                      <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">{t('Üretiliyor...', 'Generating...')}</span>
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

            {variants.every(v => !v.loading) && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                💡 {t(
                  '"Bunu Kullan" ile seçtiğin varyantı OutputPanel\'e al, görsel üret ve paylaş.',
                  'Use "Use This" to send the selected variant to the OutputPanel, generate visuals and share.',
                )}
              </p>
            )}
          </div>
        )}

        {/* All platforms mode */}
        {allPlatMode && (
          <div className="flex flex-col gap-4">
            {/* Üst bar: geri + logo durumu */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                onClick={() => setAllPlatMode(false)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
              >
                ← {t('Geri', 'Back')}
              </button>
              {/* Logo durumu + yükleme */}
              <div className="flex items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                {logoBase64 ? (
                  <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg px-2.5 py-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/png;base64,${logoBase64}`} alt="Logo" className="h-6 w-auto max-w-[80px] object-contain" />
                    <span className="text-[10px] text-green-700 dark:text-green-400 font-medium">✓ Logo</span>
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      className="text-[10px] text-slate-400 hover:text-ocean transition-colors"
                      title={t('Logo değiştir', 'Change logo')}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={removeLogo}
                      className="text-[10px] text-slate-300 hover:text-red-500 transition-colors"
                      title={t('Logo kaldır', 'Remove logo')}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-1.5 transition-colors font-medium"
                  >
                    🏷️ {t('Logo Yükle', 'Upload Logo')}
                  </button>
                )}
              </div>
            </div>

            {/* Tek ortak görsel alanı */}
            <div className="border border-purple-200 dark:border-purple-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-200 dark:border-purple-700">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🎨</span>
                  <span className="text-xs font-semibold text-purple-800 dark:text-purple-300">
                    {t('Paylaşım Görseli', 'Post Image')}
                  </span>
                  <span className="text-[10px] text-purple-500 dark:text-purple-400">
                    {t('— tüm platformlar için tek görsel', '— one image for all platforms')}
                  </span>
                </div>
                <button
                  onClick={generateSharedImage}
                  disabled={allPlatImgLoading || allPlatData.every(p => p.loading || !p.content)}
                  className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  {allPlatImgLoading
                    ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> {t('Üretiliyor...', 'Generating...')}</>
                    : allPlatImage ? `🔄 ${t('Yeniden Üret', 'Regenerate')}` : `✨ ${t('Görsel Üret', 'Generate Image')}`}
                </button>
              </div>

              <div className="p-3">
                {allPlatImgLoading && (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400">
                    <div className="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs animate-pulse">{t('Görsel üretiliyor...', 'Generating image...')}</p>
                  </div>
                )}
                {allPlatImgError && !allPlatImgLoading && (
                  <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
                    ❌ {allPlatImgError}
                  </p>
                )}
                {allPlatImage && !allPlatImgLoading && (
                  <div className="flex flex-col gap-3">
                    {/* Görsel önizleme */}
                    <div className="rounded-xl overflow-hidden bg-slate-950 shadow-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${allPlatImage}`}
                        alt="Post görseli"
                        className="w-full object-contain"
                        style={{ maxHeight: '320px' }}
                      />
                    </div>

                    {/* ── Başlık Düzenleyici ── */}
                    {rawBg && (
                      <div className="rounded-xl border border-purple-200 dark:border-purple-700 bg-purple-50/60 dark:bg-purple-900/20 p-3 flex flex-col gap-2">
                        <p className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                          ✏️ {t('Görsel Başlığı', 'Image Headline')}
                        </p>

                        {/* Öneri chip'leri */}
                        {headlineSuggestions.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {headlineSuggestions.map((s, i) => (
                              <button
                                key={i}
                                onClick={() => setCustomHeadline(s)}
                                title={s}
                                className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all leading-tight max-w-[140px] text-left truncate ${
                                  customHeadline === s
                                    ? 'bg-purple-600 text-white border-purple-600 font-semibold'
                                    : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-300'
                                }`}
                              >
                                {i === 0 ? '🤖 ' : i === 1 ? '✦ ' : '◈ '}
                                {s.replace(/\n/g, ' / ')}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Serbest metin girişi + Uygula */}
                        <div className="flex gap-2 items-start">
                          <textarea
                            value={customHeadline}
                            onChange={e => setCustomHeadline(e.target.value)}
                            rows={2}
                            placeholder={t('Başlık yazın... (satır sonu için Enter)', 'Type headline... (Enter for newline)')}
                            className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none leading-relaxed"
                          />
                          <button
                            onClick={applyCustomHeadline}
                            disabled={headlineApplying || !customHeadline.trim()}
                            className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap"
                          >
                            {headlineApplying
                              ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" />
                              : '✓'}
                            {t('Uygula', 'Apply')}
                          </button>
                        </div>
                        <p className="text-[10px] text-purple-500 dark:text-purple-400">
                          {t('Başlık değişince "Uygula"ya bas — API çağrısı olmadan görsel anında güncellenir.', 'Press "Apply" after editing — image updates instantly without a new API call.')}
                        </p>
                      </div>
                    )}

                    {/* Platform bazlı indirme butonları */}
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        ⬇️ {t('Platform boyutunda indir:', 'Download in platform size:')}
                      </p>
                      <div className="grid grid-cols-5 gap-1.5">
                        {PLATFORMS.map(p => (
                          <button
                            key={p.value}
                            onClick={() => void downloadPlatformImage(p.value)}
                            className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:text-purple-700 dark:hover:text-purple-300 text-slate-600 dark:text-slate-300 transition-colors"
                          >
                            <span className="text-base">{p.label.split(' ')[0]}</span>
                            <span className="text-[9px] font-medium leading-tight text-center">{p.label.split(' ').slice(1).join(' ')}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {!allPlatImage && !allPlatImgLoading && !allPlatImgError && (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-slate-400">
                    <span className="text-3xl opacity-20">🖼️</span>
                    <p className="text-xs text-center text-slate-400 dark:text-slate-500">
                      {t('İçerik üretildikten sonra "Görsel Üret" butonuna tıklayın', 'Click "Generate Image" after content is ready')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Platform içerik kartları */}
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
                    {!p.loading && p.content && <span className="text-[10px] text-green-600 dark:text-green-400">✓ {t('Hazır', 'Ready')}</span>}
                    {!p.loading && p.error && <span className="text-[10px] text-red-500">✕ {t('Hata', 'Error')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!p.loading && p.content && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); copyAllPlat(p.editing ? p.editValue : p.content); }}
                          className="text-[10px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                        >
                          📋 {t('Kopyala', 'Copy')}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); startEditAllPlat(i); }}
                          className="text-[10px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium hover:border-ocean hover:text-ocean transition-colors"
                        >
                          ✏️ {t('Düzenle', 'Edit')}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setSharePlatItem({ content: p.editing ? p.editValue : p.content, platform: p.platform, imageData: allPlatImage || undefined, imageMime: allPlatImage ? 'image/png' : undefined }); }}
                          className="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded font-medium transition-colors"
                        >
                          📤 {t('Paylaş', 'Share')}
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
                        <span className="text-xs">{t('İçerik Üretiliyor', 'Generating Content')}</span>
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
                          <button onClick={() => saveEditAllPlat(i)} className="flex-1 text-xs bg-ocean text-white py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors">
                            {t('Kaydet', 'Save')}
                          </button>
                          <button
                            onClick={() => setAllPlatData(prev => prev.map((pp, ii) => ii === i ? { ...pp, editing: false } : pp))}
                            className="text-xs border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            {t('İptal', 'Cancel')}
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

        {!variantMode && !allPlatMode && (
          <OutputPanel content={output} loading={loading} error={error} platform={platform} contentType="ilan_ozeti" />
        )}
      </div>
    </div>
  );
}

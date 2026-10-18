// ─── CrewinJob Metrics Context Loader ────────────────────────────────────────
// Tüm AI promptlarının ortak bilgi kaynağı.
// Kullanım:
//   const ctx = require('../context');           // modules/ içinden
//   const ctx = require('../../context');        // modules/legacy/ içinden
//
//   ctx.framework()   → tam metrik framework'ü (uzun — KPI raporları için)
//   ctx.playbook()    → metrik iyileştirme playbook'u (uzun — analiz için)
//   ctx.core()        → North Star + 15 ana metrik (kısa — içerik üretimi için)
//   ctx.rules()       → analiz yazım kuralları (her analiz promptuna eklenir)
//   ctx.analysisBlock({ playbook: true }) → prompt'a hazır blok

const fs   = require('fs');
const path = require('path');

const DIR = __dirname;
const _cache = {};

function readDoc(filename) {
  if (_cache[filename] !== undefined) return _cache[filename];
  try {
    _cache[filename] = fs.readFileSync(path.join(DIR, filename), 'utf-8');
  } catch {
    _cache[filename] = '';
  }
  return _cache[filename];
}

function framework() { return readDoc('crewinjob-metrics.md'); }
function playbook()  { return readDoc('metrics-playbook.md'); }

// ─── Kısa özet — hafif promptlar için (içerik üretimi, sosyal medya) ─────────
function core() {
  return `## CrewinJob Ölçüm Çerçevesi (özet)

CrewinJob, denizcilik sektörüne özel iki taraflı bir işgücü marketplace'idir:
bir tarafta gemi insanları (seafarers), diğer tarafta şirketler (shipowner, ship manager, crewing agency).

**North Star:** Monthly Qualified Matches — bir ayda oluşan nitelikli aday–ilan eşleşmesi.
Nitelikli sayılma şartı: profil ≥%80 tamam + belgeler girilmiş + müsaitlik uygun + Fit Score eşik üstü + başvuru/shortlist gerçekleşmiş.

**Gerçek büyümeyi gösteren üçlü:**
Ready-to-Hire Seafarers + Active Hiring Companies + Monthly Qualified Matches

**Kritik bakış açısı:**
"15.000 kayıtlı denizci" bir traction göstergesidir ama tek başına anlamsızdır.
Doğru soru: kaçı aktif, profili tamam, belgeleri güncel, işe hazır?
"75 şirket" yerine: kaçı aktif ilan veriyor, shortlist yapıyor, CV açıyor, tekrar geliyor?

**Takip edilen 15 ana metrik:**
Yeni seafarer kaydı · %80 tamamlanmış profil oranı · Ready-to-Hire profil sayısı · Aylık aktif seafarer ·
Yeni şirket kaydı · Company Activation Rate · Aylık aktif şirket · Aktif ilan sayısı ·
İlan başına nitelikli aday · 7-Day Liquidity Rate · Başvuru→shortlist oranı ·
İlk nitelikli adaya kadar süre · CV unlock dönüşümü · Repeat Job Posting Rate · Confirmed Placement`;
}

// ─── Analiz yazım kuralları — her analiz promptunun sonuna eklenir ───────────
function rules() {
  return `## Analiz Yazım Kuralları (zorunlu)

1. **Her düşük metrik için kaldıraç öner.** "X düşük" demek yetmez — hangi kaldıraç, neden o kaldıraç,
   nasıl ölçülecek: üçü birlikte yazılır.
2. **En fazla 3 aksiyon öner.** Fazlası uygulanmaz. Etki sırasına göre sırala.
3. **Aksiyonu ölçülebilir hedefe bağla.** "Profil tamamlamayı artır" değil →
   "CV parse ile 4 hafta içinde %42'den %55'e".
4. **Ölçülemeyen metriği tahmin etme.** Veri yoksa "Bu veri henüz izlenmiyor — \`job_applied\` event'i
   eklenmeli" de. Uydurma rakam kullanma.
5. **Darboğaz tarafını belirt.** Her analizde "bu dönem darboğaz aday tarafında mı, şirket tarafında mı?"
   sorusuna net cevap ver.
6. **Sayı yoksa iddia yok.** Rakamla desteklenmeyen cümle rapora girmez.
7. **Eşik referansı:** hedefin %80'inin altı kırmızı, %80–100 arası sarı, üstü yeşil.`;
}

// ─── Prompt'a hazır blok ─────────────────────────────────────────────────────
// opts.full     → tam framework (varsayılan: kısa özet)
// opts.playbook → iyileştirme playbook'unu ekle
// opts.rules    → yazım kurallarını ekle (varsayılan: true)
function analysisBlock(opts = {}) {
  const { full = false, playbook: withPlaybook = false, rules: withRules = true } = opts;
  const parts = [full ? framework() : core()];
  if (withPlaybook) parts.push(playbook());
  if (withRules)    parts.push(rules());
  return parts.filter(Boolean).join('\n\n---\n\n');
}

module.exports = { framework, playbook, core, rules, analysisBlock };

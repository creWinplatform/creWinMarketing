import 'server-only';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import type { SetupGuide, SetupSection, SetupState, SetupStep } from './server-setup-types';
import type { ProbeResult } from './operator-types';

// Server setup guide for the team running Ryzevo (the deployment administrator). For each server-side connection it says
// what it opens, what is wrong right now, the exact steps in the provider's console, the values to register (callback
// addresses derived from this panel's own address, permission lists) and the .env.local lines to paste. Setting values
// are never returned: secrets appear as placeholders, and only presence and validity are reported.
const l = (tr: string, en: string): LocalizedText => ({ tr, en });
const META_GRAPH_VERSION = 'v25.0';
export const META_BASE_PERMISSIONS = ['pages_show_list', 'pages_read_engagement', 'instagram_basic'];
export const META_INBOX_PERMISSIONS = ['pages_read_user_content', 'pages_messaging', 'pages_manage_metadata', 'instagram_manage_comments', 'instagram_manage_messages'];
export const META_PUBLISH_PERMISSIONS = ['pages_manage_posts', 'instagram_content_publish'];
const WORKER_FRESH_MS = 15 * 60_000;

type Env = Record<string, string | undefined>;
const local = (origin: string) => { try { return ['localhost', '127.0.0.1'].includes(new URL(origin).hostname); } catch { return false; } };
// A callback setting is valid when it is https (or http on this machine), has no credentials, query or fragment, uses the
// expected path and sits on the address this panel is opened from (the provider sends the browser back there).
function callbackProblems(value: string | undefined, path: string, origin: string, name: string): LocalizedText[] {
  if (!value) return [];
  let url: URL; try { url = new URL(value); } catch { return [l(`${name} geçerli bir adres değil.`, `${name} is not a valid address.`)]; }
  const out: LocalizedText[] = [];
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) out.push(l(`${name} https olmalı (yalnız bu bilgisayarda http://localhost kabul edilir).`, `${name} must be https (http://localhost is accepted only on this machine).`));
  if (url.username || url.password || url.search || url.hash) out.push(l(`${name} kullanıcı adı, soru işareti (?) veya # içermemeli.`, `${name} must not contain a user name, a query (?) or a #.`));
  if (url.pathname !== path) out.push(l(`${name} yolu tam olarak ${path} olmalı.`, `${name} must end exactly with ${path}.`));
  if (url.origin !== origin) out.push(l(`${name} bu panelin adresiyle (${origin}) eşleşmiyor; bağlantı başka adrese döner ve tamamlanmaz. Paneli kayıtlı adresten açın ya da değeri aşağıdaki gibi düzeltin.`, `${name} does not match this panel’s address (${origin}); the connection would return elsewhere and not finish. Open the panel from the registered address or fix the value as below.`));
  return out;
}
const missing = (env: Env, names: string[]) => names.filter(name => !env[name]);
const missingText = (names: string[]) => names.length ? [l(`Eksik ayar: ${names.join(', ')}.`, `Missing setting: ${names.join(', ')}.`)] : [];
const state = (absent: string[], problems: LocalizedText[]): SetupState => absent.length ? 'missing' : problems.length ? 'invalid' : 'ready';
const restart = (isLocal: boolean): SetupStep => ({ text: isLocal
  ? l('Dosyayı kaydedip sunucuyu yeniden başlatın: sunucunun çalıştığı terminalde Ctrl+C, ardından npm run dev. Ayarlar yalnız açılışta okunur.', 'Save the file and restart the server: Ctrl+C in the terminal running it, then npm run dev. Settings are read only at start-up.')
  : l('Ayarları sunucunun ortam değişkenlerine ekleyip uygulamayı yeniden başlatın. Ayarlar yalnız açılışta okunur.', 'Add the settings to the server’s environment and restart the app. Settings are read only at start-up.') });
const envFile = (isLocal: boolean): SetupStep => ({ text: isLocal
  ? l('Proje klasöründeki crewinjob-web/.env.local dosyasını bir metin düzenleyiciyle açıp aşağıdaki satırları sonuna ekleyin. < > arasındaki yerleri kendi değerlerinizle değiştirin; bu dosyayı kimseyle paylaşmayın ve Git’e eklemeyin.', 'Open crewinjob-web/.env.local in the project folder with a text editor and add the lines below at the end. Replace the parts between < > with your own values; never share this file or add it to Git.')
  : l('Aşağıdaki satırları sunucunun ortam değişkenlerine ekleyin. < > arasındaki yerleri kendi değerlerinizle değiştirin; değerleri sohbete, ekran görüntüsüne veya Git’e koymayın.', 'Add the lines below to the server’s environment. Replace the parts between < > with your own values; never put them in chats, screenshots or Git.') });

function google(env: Env, origin: string, isLocal: boolean): SetupSection {
  const names = ['PLATFORM_GOOGLE_CLIENT_ID', 'PLATFORM_GOOGLE_CLIENT_SECRET', 'PLATFORM_GOOGLE_REDIRECT_URI'], callback = `${origin}/api/platform/google/callback`;
  const absent = missing(env, names), invalid = callbackProblems(env.PLATFORM_GOOGLE_REDIRECT_URI, '/api/platform/google/callback', origin, 'PLATFORM_GOOGLE_REDIRECT_URI');
  return { id: 'google', title: l('Google (Search Console ve Google Analytics)', 'Google (Search Console and Google Analytics)'), state: state(absent, invalid),
    unlocks: [l('Search Console düşüş takibi ve arama fırsatları', 'Search Console drop watch and search opportunities'), l('GA4’e bağlı hedef ölçümleri ve aylık rapordaki site rakamları', 'GA4-bound goal measurements and site figures in the monthly report')],
    problems: [...missingText(absent), ...invalid],
    steps: [
      { text: l('Google Cloud’da yeni bir proje açın (ör. “Ryzevo”). Zaten bir projeniz varsa onu seçin.', 'Create a new project in Google Cloud (e.g. “Ryzevo”). If you already have one, select it.'), link: { href: 'https://console.cloud.google.com/projectcreate', label: l('Proje oluştur', 'Create project') } },
      { text: l('Üç API’yi açın: Google Search Console API, Google Analytics Admin API, Google Analytics Data API. Her bağlantıda “Etkinleştir”e (Enable) basın.', 'Enable three APIs: Google Search Console API, Google Analytics Admin API, Google Analytics Data API. Press “Enable” on each.'), link: { href: 'https://console.cloud.google.com/apis/library/searchconsole.googleapis.com', label: l('Search Console API', 'Search Console API') } },
      { text: l('Analytics Admin API’yi açın.', 'Enable the Analytics Admin API.'), link: { href: 'https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com', label: l('Analytics Admin API', 'Analytics Admin API') } },
      { text: l('Analytics Data API’yi açın.', 'Enable the Analytics Data API.'), link: { href: 'https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com', label: l('Analytics Data API', 'Analytics Data API') } },
      { text: l('İzin ekranını (OAuth consent screen) kurun: kullanıcı türü “External”, uygulama adı ve destek e-postası. “Test users” listesine crewinjob.com’un Search Console ve GA4 erişimi olan Google hesabını ekleyin; test modunda yalnız bu hesaplar bağlanabilir.', 'Set up the OAuth consent screen: user type “External”, app name and support email. Add the Google account that can access crewinjob.com’s Search Console and GA4 to “Test users”; in test mode only these accounts can connect.'), link: { href: 'https://console.cloud.google.com/apis/credentials/consent', label: l('İzin ekranı', 'Consent screen') } },
      { text: l('“Create credentials → OAuth client ID” ile istemci oluşturun: tür “Web application”. “Authorized redirect URIs” alanına aşağıdaki adresi aynen yapıştırın.', 'Create a client with “Create credentials → OAuth client ID”: type “Web application”. Paste the address below as is into “Authorized redirect URIs”.'), link: { href: 'https://console.cloud.google.com/apis/credentials/oauthclient', label: l('OAuth istemcisi oluştur', 'Create OAuth client') }, copy: { label: l('Yetkili dönüş adresi', 'Authorized redirect URI'), value: callback } },
      { text: l('Oluşan “Client ID” ve “Client secret” değerlerini aşağıdaki satırlara yazın. İstenen izinler yalnız okumadır: webmasters.readonly ve analytics.readonly.', 'Put the resulting “Client ID” and “Client secret” in the lines below. The permissions asked are read-only: webmasters.readonly and analytics.readonly.') },
      envFile(isLocal), restart(isLocal),
    ],
    env: `PLATFORM_GOOGLE_CLIENT_ID=<Google'daki Client ID>\nPLATFORM_GOOGLE_CLIENT_SECRET=<Google'daki Client secret>\nPLATFORM_GOOGLE_REDIRECT_URI=${callback}`,
    verify: { text: l('Önce “Dene” ile Client ID ve Client secret’ın Google tarafından tanındığını doğrulayın (onay ekranı açılmaz). Sonra Proje ayarları → Bağlantılar → “Google hesabı bağla”da Search Console’u seçip mülkü yazın (ör. sc-domain:crewinjob.com), ardından GA4 için sayısal mülk kimliğini girin; Google’ın ekranında kendi hesabınızla izin verin ve “Erişimi test et”e basın.', 'First use “Check” to confirm Google recognises the Client ID and Client secret (no consent screen opens). Then in Project settings → Connections → “Connect Google account”, choose Search Console and enter the property (e.g. sc-domain:crewinjob.com), then the numeric GA4 property ID; approve with your own account on Google’s screen and press “Test access”.'), href: '/?tab=project&settings=connections&guideProvider=search_console', probe: 'google' } };
}

function meta(env: Env, origin: string, isLocal: boolean): SetupSection {
  const names = ['PLATFORM_META_APP_ID', 'PLATFORM_META_APP_SECRET', 'PLATFORM_META_REDIRECT_URI', 'PLATFORM_META_GRAPH_VERSION'], callback = `${origin}/api/platform/meta/callback`;
  const absent = missing(env, names), invalid = [...callbackProblems(env.PLATFORM_META_REDIRECT_URI, '/api/platform/meta/callback', origin, 'PLATFORM_META_REDIRECT_URI'),
    ...(env.PLATFORM_META_GRAPH_VERSION && !/^v\d{1,3}\.0$/.test(env.PLATFORM_META_GRAPH_VERSION) ? [l('PLATFORM_META_GRAPH_VERSION “v25.0” biçiminde olmalı (v, sayı, .0).', 'PLATFORM_META_GRAPH_VERSION must look like “v25.0” (v, a number, .0).')] : [])];
  return { id: 'meta', title: l('Meta (Facebook Sayfası ve Instagram)', 'Meta (Facebook Page and Instagram)'), state: state(absent, invalid),
    unlocks: [l('Sosyal gelen kutusu: Sayfa ve Instagram yorumları ile mesajları, onaylı cevaplar', 'Social inbox: Page and Instagram comments and messages, approved replies')],
    problems: [...missingText(absent), ...invalid],
    steps: [
      { text: l('Meta for Developers’ta yeni bir uygulama oluşturun; türü “Business” seçin ve Crewin’in Meta Business hesabına bağlayın.', 'Create a new app in Meta for Developers; choose the “Business” type and link it to Crewin’s Meta Business account.'), link: { href: 'https://developers.facebook.com/apps/creation/', label: l('Uygulama oluştur', 'Create app') } },
      { text: l('Uygulamaya “Facebook Login for Business” ürününü ekleyin. Ayarlarındaki “Valid OAuth Redirect URIs” alanına aşağıdaki adresi aynen yapıştırın.', 'Add the “Facebook Login for Business” product to the app. Paste the address below as is into its “Valid OAuth Redirect URIs” setting.'), copy: { label: l('Geçerli OAuth dönüş adresi', 'Valid OAuth redirect URI'), value: callback } },
      { text: l('Uygulamaya şu izinleri ekleyin (temel izinler ve gelen kutusu izinleri). Ryzevo projelerinde yayın da yapılacaksa ayrıca pages_manage_posts ve instagram_content_publish.', 'Add these permissions to the app (basic and inbox permissions). If Ryzevo projects will also publish, add pages_manage_posts and instagram_content_publish too.'), copy: { label: l('İzinler', 'Permissions'), value: [...META_BASE_PERMISSIONS, ...META_INBOX_PERMISSIONS].join(', ') } },
      { text: l('Uygulama geliştirme modunda kalabilir. Bu modda yalnız uygulamada rolü olan hesaplar bağlanır: Crewin Sayfasını yöneten Facebook hesabını “App roles”a ekleyin. Herkese açmak için Meta uygulama incelemesi gerekir.', 'The app can stay in development mode. In this mode only accounts with a role in the app can connect: add the Facebook account that manages the Crewin Page to “App roles”. Opening it to everyone needs Meta app review.'), link: { href: 'https://developers.facebook.com/apps/', label: l('Uygulamalarım', 'My apps') } },
      { text: l('“App settings → Basic”teki “App ID” ve “App secret” değerlerini aşağıdaki satırlara yazın.', 'Put the “App ID” and “App secret” from “App settings → Basic” in the lines below.') },
      envFile(isLocal), restart(isLocal),
    ],
    env: `PLATFORM_META_APP_ID=<Meta'daki App ID>\nPLATFORM_META_APP_SECRET=<Meta'daki App secret>\nPLATFORM_META_REDIRECT_URI=${callback}\nPLATFORM_META_GRAPH_VERSION=${META_GRAPH_VERSION}`,
    verify: { text: l('Önce “Dene” ile App ID ve App secret’ın Meta tarafından kabul edildiğini doğrulayın (onay ekranı açılmaz, hiçbir hesaba erişilmez). Sonra Proje ayarları → Bağlantılar → “Facebook / Instagram bağla”da hesap türünü seçin, “gelen kutusu izinlerini de iste” işaretli kalsın ve “Meta ile devam et”e basın; Meta ekranında kendi hesabınızla izin verip Crewin Sayfasını seçin.', 'First use “Check” to confirm Meta accepts the App ID and App secret (no consent screen opens, no account is accessed). Then in Project settings → Connections → “Connect Facebook / Instagram”, choose the account type, keep “also request the inbox permissions” ticked and press “Continue with Meta”; approve with your own account on Meta’s screen and choose the Crewin Page.'), href: '/?tab=project&settings=connections&guideProvider=facebook', probe: 'meta' } };
}

function gemini(env: Env, isLocal: boolean): SetupSection {
  const absent = missing(env, ['PLATFORM_GEMINI_API_KEY', 'PLATFORM_GEMINI_MODEL']), model = env.PLATFORM_GEMINI_MODEL || '';
  const invalid = model && !/gemini-(?:2|[3-9])/.test(model) ? [l('Model Google aramasıyla cevap veremiyor: gemini-2 veya üstü bir model gerekir (ör. gemini-2.5-flash).', 'The model cannot answer with Google Search: a gemini-2 or later model is needed (e.g. gemini-2.5-flash).')] : [];
  return { id: 'gemini', title: l('AI modeli (Google aramalı Gemini)', 'AI model (search-grounded Gemini)'), state: state(absent, invalid),
    unlocks: [l('AI görünürlüğü: sorular Google araması açık bir asistana sorulur, markanın anılıp anılmadığı kaydedilir', 'AI visibility: questions are asked to an assistant with Google Search on and whether the brand is named is recorded'), l('Büyüme koçunun AI ile strateji taslağı ve içerik önerileri', 'The growth coach’s AI strategy drafts and content suggestions')],
    problems: [...missingText(absent), ...invalid],
    steps: [
      { text: l('Google AI Studio’da bir API anahtarı oluşturun ve faturalandırmanın açık olduğundan emin olun.', 'Create an API key in Google AI Studio and make sure billing is on.'), link: { href: 'https://aistudio.google.com/app/apikey', label: l('API anahtarı', 'API key') } },
      { text: l('Google aramasıyla temellendirme (grounding) ayrıca ücretlendirilir ve Gemini API ek şartlarına tabidir. İlk gerçek çalıştırmadan önce şartları ve fiyatı okuyun; AI görünürlüğünde her soru bir arama demektir.', 'Grounding with Google Search is billed separately and is subject to the Gemini API additional terms. Read the terms and pricing before the first real run; each AI-visibility question is one search.'), link: { href: 'https://ai.google.dev/gemini-api/terms', label: l('Gemini API şartları', 'Gemini API terms') } },
      { text: l('Fiyatlandırma sayfası.', 'Pricing page.'), link: { href: 'https://ai.google.dev/pricing', label: l('Fiyatlar', 'Pricing') } },
      envFile(isLocal), restart(isLocal),
    ],
    env: `PLATFORM_GEMINI_API_KEY=<Google AI Studio API anahtarı>\nPLATFORM_GEMINI_MODEL=gemini-2.5-flash`,
    verify: { text: l('“Dene” anahtarın ve modelin çalıştığını doğrular; içerik üretmez ve arama yapmaz. Sonra SEO & Blog → AI görünürlüğü’nde bir soru ekleyip tek bir soruyla deneyin.', '“Check” confirms the key and model work; it generates nothing and runs no search. Then add one question in SEO & Blog → AI visibility and try it.'), href: '/?tab=seo&view=visibility', probe: 'gemini' } };
}

function worker(db: Database.Database, env: Env, origin: string, isLocal: boolean, now: number): SetupSection {
  const row = (() => { try { return db.prepare("SELECT last_success_at,outcome,consecutive_failures FROM platform_worker_observations WHERE component='platform-worker'").get() as { last_success_at: string | null; outcome: string; consecutive_failures: number } | undefined; } catch { return undefined; } })();
  const last = row?.last_success_at || null, age = last ? now - Date.parse(last) : Infinity, secret = (env.CRON_SECRET || '').length >= 16;
  const problems: LocalizedText[] = [...(secret ? [] : [l('CRON_SECRET en az 16 karakterlik rastgele bir değer olmalı.', 'CRON_SECRET must be a random value of at least 16 characters.')]),
    ...(!last ? [l('Zamanlanmış işler bu sunucuda hiç çalışmamış.', 'Scheduled jobs have never run on this server.')] : age > WORKER_FRESH_MS ? [l(`Son başarılı çalışma ${Math.round(age / 60_000)} dakika önce; birkaç dakikada bir çalışması gerekir.`, `The last successful run was ${Math.round(age / 60_000)} minutes ago; it should run every few minutes.`)] : []),
    ...(row && row.consecutive_failures > 0 ? [l(`Son ${row.consecutive_failures} çalışma tamamlanamadı; sunucu kaydına bakın.`, `The last ${row.consecutive_failures} run(s) did not complete; check the server log.`)] : [])];
  const url = `${origin}/api/platform/worker`;
  return { id: 'worker', title: l('Zamanlanmış işler (worker)', 'Scheduled jobs (worker)'), state: !secret || !last ? 'missing' : problems.length ? 'stale' : 'ready', lastRunAt: last,
    unlocks: [l('Otomatik SEO taraması ve Search Console düşüş uyarısı', 'Automatic SEO scans and Search Console drop alerts'), l('AI görünürlüğünün haftalık kontrolü', 'The weekly AI-visibility check'), l('Gelen kutusunun 30 dakikada bir okunması, bildirimler, ölçüm senkronu', 'Reading the inbox every 30 minutes, notifications, measurement sync')],
    problems,
    steps: [
      { text: l('Worker, birkaç dakikada bir CRON_SECRET ile çağrılan tek bir adrestir. Yalnız onaylanmış ve zamanı gelmiş işleri yürütür; yeni bir şey göndermeye kendisi karar vermez.', 'The worker is a single address called every few minutes with CRON_SECRET. It only runs approved jobs that are due; it never decides to send anything new.'), copy: { label: l('Worker adresi', 'Worker address'), value: url } },
      ...(secret ? [] : [{ text: l('CRON_SECRET tanımlı değilse .env.local’e en az 32 karakterlik rastgele bir değer ekleyip sunucuyu yeniden başlatın.', 'If CRON_SECRET is not set, add a random value of at least 32 characters to .env.local and restart the server.') }]),
      isLocal
        ? { text: l('Bu bilgisayarda denemek için PowerShell’de aşağıdaki komutu bir kez çalıştırın (<CRON_SECRET> yerine .env.local’deki değeri yazın). Zamanı gelmiş işler gerçekten çalışır: kayıtlı SEO taramaları ve AI görünürlük kontrolleri AI kredisi kullanır.', 'To try it on this machine, run the command below once in PowerShell (replace <CRON_SECRET> with the value in .env.local). Due jobs really run: saved SEO scans and AI-visibility checks use AI credits.'), copy: { label: l('Tek seferlik çalıştırma', 'One-off run'), value: `curl.exe -fsS -X POST -H "x-cron-secret: <CRON_SECRET>" ${url}` } }
        : { text: l('Sunucuda “crontab -e” ile aşağıdaki satırı ekleyin; worker beş dakikada bir çalışır.', 'On the server, add the line below with “crontab -e”; the worker runs every five minutes.'), copy: { label: l('Crontab satırı', 'Crontab line'), value: `*/5 * * * * curl -fsS -m 55 -X POST -H "x-cron-secret: <CRON_SECRET>" ${url} > /dev/null` } },
      ...(isLocal ? [{ text: l('Canlı sunucuda (VPS) aynı işi crontab yapar; aşağıdaki satırı “crontab -e” ile ekleyin ve adresi canlı alan adınızla değiştirin.', 'On the live server (VPS) a crontab does the same; add the line below with “crontab -e” and use your live domain in the address.'), copy: { label: l('Canlı için crontab satırı', 'Crontab line for live'), value: '*/5 * * * * curl -fsS -m 55 -X POST -H "x-cron-secret: <CRON_SECRET>" https://<alan-adınız>/api/platform/worker > /dev/null' } }] : []),
    ],
    env: secret ? null : 'CRON_SECRET=<en az 32 karakterlik rastgele değer>',
    verify: { text: l('Çalıştıktan sonra “Yeniden kontrol et”e basın: son başarılı çalışma zamanı burada görünür.', 'After it runs, press “Check again”: the last successful run time appears here.') } };
}

export function serverSetup(db: Database.Database, origin: string, env: Env = process.env, now = Date.now()): SetupGuide {
  const isLocal = local(origin);
  return { origin, local: isLocal, generatedAt: new Date(now).toISOString(), sections: [google(env, origin, isLocal), meta(env, origin, isLocal), gemini(env, isLocal), worker(db, env, origin, isLocal, now)] };
}

// Credential checks that need no consent screen and touch no account. Google: a token request with a code that cannot be
// valid; Google answers invalid_grant only after it has accepted the client ID and secret. Meta: an app access token
// (client credentials) and the app's name. Secrets go only to the provider, never into the result.
export type SetupFetch = (url: string, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;
const defaultFetch: SetupFetch = (url, init) => fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
const errorCode = (body: unknown) => { const value = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined; return typeof value === 'string' ? value : value && typeof value === 'object' ? String((value as { code?: unknown }).code ?? '') : ''; };
export async function probeGoogle(env: Env = process.env, fetcher: SetupFetch = defaultFetch): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString(), base = { id: 'google' as const, checkedAt };
  if (!env.PLATFORM_GOOGLE_CLIENT_ID || !env.PLATFORM_GOOGLE_CLIENT_SECRET || !env.PLATFORM_GOOGLE_REDIRECT_URI) return { ...base, ok: false, status: null, detail: l('Önce üç Google ayarını ekleyip sunucuyu yeniden başlatın.', 'Add the three Google settings and restart the server first.') };
  try {
    const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'ryzevo-setup-check', client_id: env.PLATFORM_GOOGLE_CLIENT_ID, client_secret: env.PLATFORM_GOOGLE_CLIENT_SECRET, redirect_uri: env.PLATFORM_GOOGLE_REDIRECT_URI }).toString() });
    const code = errorCode(await response.json().catch(() => ({})));
    if (code === 'invalid_grant') return { ...base, ok: true, status: response.status, detail: l('Google, Client ID ve Client secret’ı tanıdı. Dönüş adresinin kayıtlı olduğu, ilk bağlantıda Google ekranı açılınca görülür.', 'Google recognised the Client ID and Client secret. Whether the callback is registered shows when Google’s screen opens on the first connection.') };
    if (code === 'redirect_uri_mismatch') return { ...base, ok: false, status: response.status, detail: l('Google bu dönüş adresini tanımıyor: kartta gösterilen adresi OAuth istemcisinin “Authorized redirect URIs” alanına aynen ekleyin.', 'Google does not know this callback: add the address shown on the card as is to the OAuth client’s “Authorized redirect URIs”.') };
    if (code === 'invalid_client' || code === 'unauthorized_client') return { ...base, ok: false, status: response.status, detail: l('Google bu Client ID / Client secret çiftini tanımadı: ikisini Google Cloud → Credentials’taki “Web application” istemcisinden yeniden kopyalayın.', 'Google did not recognise this Client ID / Client secret pair: copy both again from the “Web application” client in Google Cloud → Credentials.') };
    return { ...base, ok: false, status: response.status, detail: l(`Google beklenmeyen bir yanıt verdi${code ? ` (${code})` : ''}.`, `Google gave an unexpected answer${code ? ` (${code})` : ''}.`) };
  } catch { return { ...base, ok: false, status: null, detail: l('Google’a ulaşılamadı; internet bağlantısını kontrol edip tekrar deneyin.', 'Could not reach Google; check the internet connection and try again.') }; }
}
export async function probeMeta(env: Env = process.env, fetcher: SetupFetch = defaultFetch): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString(), base = { id: 'meta' as const, checkedAt }, version = env.PLATFORM_META_GRAPH_VERSION || '';
  if (!env.PLATFORM_META_APP_ID || !env.PLATFORM_META_APP_SECRET || !/^v\d{1,3}\.0$/.test(version)) return { ...base, ok: false, status: null, detail: l('Önce Meta ayarlarını (App ID, App secret, v25.0 biçiminde Graph sürümü) ekleyip sunucuyu yeniden başlatın.', 'Add the Meta settings (App ID, App secret, a Graph version like v25.0) and restart the server first.') };
  if (!/^\d{5,20}$/.test(env.PLATFORM_META_APP_ID)) return { ...base, ok: false, status: null, detail: l('App ID yalnız rakamlardan oluşmalı; Meta’daki “App settings → Basic” sayfasından kopyalayın.', 'The App ID must be digits only; copy it from “App settings → Basic” in Meta.') };
  try {
    const token = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    token.search = new URLSearchParams({ client_id: env.PLATFORM_META_APP_ID, client_secret: env.PLATFORM_META_APP_SECRET, grant_type: 'client_credentials' }).toString();
    const response = await fetcher(token.toString(), { headers: { Accept: 'application/json' } }), body = await response.json().catch(() => ({})) as { access_token?: unknown };
    if (response.status !== 200 || typeof body.access_token !== 'string') return { ...base, ok: false, status: response.status, detail: l('Meta bu App ID / App secret çiftini kabul etmedi: ikisini “App settings → Basic”ten yeniden kopyalayın (App secret için “Show”a basın).', 'Meta did not accept this App ID / App secret pair: copy both again from “App settings → Basic” (press “Show” for the App secret).') };
    const app = await fetcher(`https://graph.facebook.com/${version}/${env.PLATFORM_META_APP_ID}?fields=name&access_token=${encodeURIComponent(body.access_token)}`, { headers: { Accept: 'application/json' } });
    const name = ((await app.json().catch(() => ({}))) as { name?: unknown }).name;
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : '';
    return { ...base, ok: true, status: response.status, detail: l(`Meta uygulaması doğrulandı${label ? `: ${label}` : ''}. İzinlerin ve dönüş adresinin doğru olduğu, ilk bağlantıda Meta ekranı açılınca görülür.`, `Meta app verified${label ? `: ${label}` : ''}. Whether the permissions and the callback are right shows when Meta’s screen opens on the first connection.`) };
  } catch { return { ...base, ok: false, status: null, detail: l('Meta’ya ulaşılamadı; internet bağlantısını kontrol edip tekrar deneyin.', 'Could not reach Meta; check the internet connection and try again.') }; }
}


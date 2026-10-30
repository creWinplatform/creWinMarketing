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
  return { id: 'google', group: 'connections', title: l('Google (Search Console ve Google Analytics)', 'Google (Search Console and Google Analytics)'), state: state(absent, invalid),
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
  return { id: 'meta', group: 'connections', title: l('Meta (Facebook Sayfası ve Instagram)', 'Meta (Facebook Page and Instagram)'), state: state(absent, invalid),
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
  return { id: 'gemini', group: 'connections', title: l('AI modeli (Google aramalı Gemini)', 'AI model (search-grounded Gemini)'), state: state(absent, invalid),
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
  return { id: 'worker', group: 'connections', title: l('Zamanlanmış işler (worker)', 'Scheduled jobs (worker)'), state: !secret || !last ? 'missing' : problems.length ? 'stale' : 'ready', lastRunAt: last,
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


// ── Security ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Secrets stay where they are; only their length, format or presence is judged. New values are made in the browser.
function adminPassword(env: Env, isLocal: boolean): SetupSection {
  const value = env.ADMIN_PASSWORD || '', weak = value.length > 0 && value.length < 16;
  return { id: 'admin-password', group: 'security', title: l('Yönetici şifresi', 'Administrator password'), state: !value ? 'missing' : weak ? 'invalid' : 'ready',
    unlocks: [l('Crewin çalışma alanına ve operatör konsoluna giriş', 'Signing in to the Crewin workspace and the operator console')],
    problems: !value ? [l('ADMIN_PASSWORD tanımlı değil; yönetici girişi yapılamaz.', 'ADMIN_PASSWORD is not set; the administrator cannot sign in.')] : weak ? [l('Yönetici şifresi 16 karakterden kısa. Bu hesap her şeyi yönetir; uzun ve başka hiçbir yerde kullanılmayan bir şifre olmalı.', 'The administrator password is shorter than 16 characters. This account manages everything; it must be long and used nowhere else.')] : [],
    steps: [
      { text: l('“Üret” ile 24 karakterlik güçlü bir şifre üretin. Şifre yalnız bu tarayıcıda üretilir, sunucuya gönderilmez. Bir şifre yöneticisine kaydedin.', 'Make a strong 24-character password with “Generate”. It is made only in this browser and never sent to the server. Save it in a password manager.'), generate: { kind: 'password', name: 'ADMIN_PASSWORD' } },
      { text: isLocal ? l('crewinjob-web/.env.local dosyasında ADMIN_PASSWORD satırını üretilen değerle değiştirin.', 'Replace the ADMIN_PASSWORD line in crewinjob-web/.env.local with the generated value.') : l('Sunucunun ortam değişkenlerinde ADMIN_PASSWORD değerini üretilen değerle değiştirin.', 'Replace ADMIN_PASSWORD in the server’s environment with the generated value.') },
      restart(isLocal),
      { text: l('Açık oturumlar sürer; bir sonraki girişte yeni şifre kullanılır. Bu şifre Crewin backend’inin şifresi değildir, yalnız bu panelinkidir.', 'Open sessions continue; the new password is used at the next sign-in. This is not the Crewin backend password, only this panel’s.') },
    ],
    env: null, verify: { text: l('Çıkış yapıp yeni şifreyle giriş yapın, sonra “Yeniden kontrol et”e basın.', 'Sign out, sign in with the new password, then press “Check again”.') } };
}
function authSecret(env: Env, isLocal: boolean): SetupSection {
  const value = env.AUTH_SECRET || '', short = value.length > 0 && value.length < 32;
  return { id: 'auth-secret', group: 'security', title: l('Oturum imza anahtarı', 'Session signing secret'), state: !value ? 'missing' : short ? 'invalid' : 'ready',
    unlocks: [l('Giriş oturumlarının taklit edilememesi', 'Sign-in sessions that cannot be forged')],
    problems: !value ? [l('AUTH_SECRET tanımlı değil.', 'AUTH_SECRET is not set.')] : short ? [l('AUTH_SECRET 32 karakterden kısa; en az 64 karakterlik rastgele bir değer önerilir.', 'AUTH_SECRET is shorter than 32 characters; a random value of 64 characters is recommended.')] : [],
    steps: [
      { text: l('“Üret” ile 64 karakterlik rastgele bir değer üretin (yalnız bu tarayıcıda).', 'Make a random 64-character value with “Generate” (only in this browser).'), generate: { kind: 'hex', name: 'AUTH_SECRET' } },
      { text: l('AUTH_SECRET satırını bu değerle değiştirip sunucuyu yeniden başlatın. Değişince açık oturumların hepsi kapanır; herkes yeniden giriş yapar.', 'Replace the AUTH_SECRET line with this value and restart the server. When it changes, every open session ends and everyone signs in again.') },
      restart(isLocal),
    ],
    env: null, verify: { text: l('Yeniden giriş yapıp “Yeniden kontrol et”e basın.', 'Sign in again and press “Check again”.') } };
}
function encryptionKey(env: Env, keyFile: { exists: boolean; path: string }, isLocal: boolean): SetupSection {
  const inEnv = /^[a-f0-9]{64}$/i.test(env.PLATFORM_ENCRYPTION_KEY || '');
  return { id: 'encryption-key', group: 'security', title: l('Bağlantı şifreleme anahtarı', 'Connection encryption key'), state: inEnv ? 'ready' : keyFile.exists ? 'invalid' : 'missing',
    unlocks: [l('Google, Meta ve diğer bağlantıların erişim bilgilerinin veritabanında şifreli saklanması', 'Access details of Google, Meta and other connections stored encrypted in the database')],
    problems: inEnv ? [] : keyFile.exists ? [l(`Anahtar yalnız ${keyFile.path} dosyasında. Dosya kaybolursa veya sunucu taşınırken unutulursa kayıtlı bütün bağlantılar okunamaz.`, `The key lives only in ${keyFile.path}. If the file is lost or left behind when the server moves, every saved connection becomes unreadable.`)] : [l('Şifreleme anahtarı yok; ilk bağlantı kaydedilirken dosyada oluşturulur.', 'There is no encryption key yet; it is created in a file when the first connection is saved.')],
    steps: [
      { text: l(`${keyFile.path} dosyasını açıp içindeki 64 karakterlik değeri kopyalayın. YENİ bir anahtar üretmeyin: mevcut bağlantılar bu anahtarla şifreli.`, `Open ${keyFile.path} and copy the 64-character value inside. Do NOT make a new key: existing connections are encrypted with this one.`) },
      { text: l('Değeri PLATFORM_ENCRYPTION_KEY olarak ortam değişkenine ekleyin ve ayrıca bir şifre yöneticisinde yedekleyin. Veritabanı yedeğiyle aynı yerde saklamayın.', 'Add the value as PLATFORM_ENCRYPTION_KEY and also back it up in a password manager. Do not keep it in the same place as the database backup.') },
      restart(isLocal),
    ],
    env: 'PLATFORM_ENCRYPTION_KEY=<platform-credentials.key dosyasındaki değer>', verify: { text: l('Yeniden başlattıktan sonra Proje ayarları → Bağlantılar’da kayıtlı bir bağlantıda “Erişimi test et”e basın; okunabiliyorsa anahtar doğrudur.', 'After the restart, press “Test access” on a saved connection in Project settings → Connections; if it can be read, the key is right.'), href: '/?tab=project&settings=connections' } };
}
// Secret values that were pasted into tool or editor settings next to the project (for example a permission rule that
// contains a password). Only the file names and how many values were found are reported.
function plaintextSecrets(env: Env, files: { label: string; text: string }[]): SetupSection {
  const secrets = Object.entries(env).filter(([name, value]) => /(PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)/.test(name) && typeof value === 'string' && value.length >= 8).map(([name, value]) => [name, value!] as const);
  // Also password-looking text that matches no current value (an old password still pasted somewhere): counted, never shown.
  const LOOKS = [/\\?"password\\?"\s*:\s*\\?"[^"\\]{4,}/gi, /\s-u\s+[^\s:'"]+:[^\s'"]{6,}/g, /--password[ =][^\s'"]{4,}/gi, /\b[A-Z_]*PASSWORD=[^\s'"]{4,}/g];
  const found = files.map(file => ({ file: file.label, names: [...new Set(secrets.filter(([, value]) => file.text.includes(value)).map(([name]) => name))], looks: LOOKS.reduce((sum, pattern) => sum + (file.text.match(pattern) || []).length, 0) })).filter(item => item.names.length || item.looks);
  return { id: 'plaintext-secrets', group: 'security', title: l('Açık metin duran şifreler', 'Passwords left in plain text'), state: found.length ? 'invalid' : 'ready',
    unlocks: [l('Şifrelerin yalnız .env.local’de durması; araç ayar dosyalarına sızmaması', 'Passwords kept only in .env.local, never leaked into tool settings files')],
    problems: found.flatMap(item => [
      ...(item.names.length ? [l(`${item.file} dosyasında ${item.names.length} gizli değer açık metin duruyor (${item.names.join(', ')}).`, `${item.file} holds ${item.names.length} secret value(s) in plain text (${item.names.join(', ')}).`)] : []),
      ...(item.looks ? [l(`${item.file} dosyasında şifreye benzeyen ${item.looks} ifade var (ör. "password": … veya -u kullanıcı:şifre); eski bir şifre olabilir.`, `${item.file} has ${item.looks} password-looking text(s) (e.g. "password": … or -u user:password); it may be an old password.`)] : [])]),
    steps: [
      { text: l('Dosyayı bir metin düzenleyiciyle açın ve şifre içeren satırları silin (çoğu zaman eski bir izin kuralının içindedir).', 'Open the file in a text editor and delete the lines that contain the password (usually inside an old permission rule).') },
      { text: l('Açıkta kalmış her şifreyi değiştirin: Crewin backend şifresini Crewin yönetim panelinden yenileyin, sonra .env.local’deki karşılığını güncelleyin.', 'Change every password that was exposed: renew the Crewin backend password in the Crewin admin panel, then update its value in .env.local.') },
      { text: l('Sunucuyu yeniden başlatıp “Yeniden kontrol et”e basın.', 'Restart the server and press “Check again”.') },
    ],
    env: null, verify: { text: l('Kart “Hazır” olunca dosyalarda açıkta şifre kalmamıştır.', 'When the card is “Ready”, no password is left in the files.') } };
}

// ── Crewin tabs (legacy channels) ────────────────────────────────────────────────────────────────────────────────────
function crewinEmail(env: Env, isLocal: boolean): SetupSection {
  const names = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'], absent = missing(env, names);
  return { id: 'crewin-email', group: 'crewin', title: l('E-posta gönderimi (Crewin)', 'Email sending (Crewin)'), state: state(absent, []),
    unlocks: [l('WA & Telegram → E-posta Re-aktivasyon ve İş Eşleşme Maili', 'WA & Telegram → Email re-activation and Job match email'), l('Boş profillere hatırlatma gönderimi', 'Reminders to empty profiles')],
    problems: missingText(absent),
    steps: [
      { text: l('Gönderen alan adını (ör. crewinjob.com) Amazon SES’te doğrulayın ve SMTP kimlik bilgisi oluşturun. Başka bir SMTP sağlayıcısı da olur.', 'Verify the sender domain (e.g. crewinjob.com) in Amazon SES and create SMTP credentials. Another SMTP provider works too.'), link: { href: 'https://console.aws.amazon.com/ses/home#/smtp', label: l('SES SMTP ayarları', 'SES SMTP settings') } },
      envFile(isLocal), restart(isLocal),
    ],
    env: 'SMTP_HOST=<ör. email-smtp.eu-west-1.amazonaws.com>\nSMTP_PORT=587\nSMTP_USER=<SMTP kullanıcı adı>\nSMTP_PASSWORD=<SMTP şifresi>\nSMTP_FROM_EMAIL=<ör. info@crewinjob.com>\nSMTP_FROM_NAME=CrewinJob',
    verify: { text: l('WA & Telegram → E-posta Re-aktivasyon’da önce kendinize tek bir deneme gönderin.', 'In WA & Telegram → Email re-activation, first send one test to yourself.'), href: '/?tab=messaging&view=notify_email' } };
}
function crewinWhatsApp(env: Env, isLocal: boolean): SetupSection {
  const absent = missing(env, ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN']);
  return { id: 'crewin-whatsapp', group: 'crewin', title: l('WhatsApp gönderimi (Crewin)', 'WhatsApp sending (Crewin)'), state: state(absent, []),
    unlocks: [l('WA & Telegram → WA Bildirim Gönder', 'WA & Telegram → Send WA notification')],
    problems: missingText(absent),
    steps: [
      { text: l('Meta uygulamanıza WhatsApp ürününü ekleyin, işletme numarasını doğrulayın; “API Setup” sayfasındaki Phone number ID’yi alın.', 'Add the WhatsApp product to your Meta app and verify the business number; take the Phone number ID from the “API Setup” page.'), link: { href: 'https://developers.facebook.com/apps/', label: l('Meta uygulamaları', 'Meta apps') } },
      { text: l('İşletme ayarlarında whatsapp_business_messaging izinli kalıcı bir sistem kullanıcısı erişim anahtarı oluşturun (geçici anahtar 24 saatte biter). En az bir onaylı mesaj şablonu olmalı.', 'In business settings, create a permanent system-user access token with whatsapp_business_messaging (a temporary token ends in 24 hours). At least one approved message template is needed.'), link: { href: 'https://business.facebook.com/settings/system-users', label: l('Sistem kullanıcıları', 'System users') } },
      envFile(isLocal), restart(isLocal),
    ],
    env: 'WHATSAPP_PHONE_NUMBER_ID=<Phone number ID>\nWHATSAPP_ACCESS_TOKEN=<kalıcı sistem kullanıcısı anahtarı>',
    verify: { text: l('WA & Telegram → WA Bildirim Gönder’de kendi numaranıza tek bir şablon mesajı gönderin. Meta her mesajı ücretlendirir.', 'In WA & Telegram → Send WA notification, send one template message to your own number. Meta bills each message.'), href: '/?tab=messaging&view=notify_wa' } };
}
function crewinTelegram(env: Env, agentEnv: Env, isLocal: boolean): SetupSection {
  const bot = missing(env, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID']), session = missing(agentEnv, ['TG_API_ID', 'TG_API_HASH', 'TG_SESSION']), absent = [...bot, ...session];
  return { id: 'crewin-telegram', group: 'crewin', title: l('Telegram (kanal ve grup duyuruları)', 'Telegram (channel and group announcements)'), state: state(absent, []),
    unlocks: [l('WA & Telegram → TG Kanal Gönder (bot ile kanal duyurusu)', 'WA & Telegram → Send to TG channel (channel post by bot)'), l('Otomasyon → “Paylaş”: yeni ilanların katıldığınız gruplarda duyurulması (Telegram oturumu ile)', 'Automation → “Share”: new job ads announced in the groups you joined (with the Telegram session)')],
    problems: missingText(absent),
    steps: [
      { text: l('Kanal duyurusu için: @BotFather’da bir bot oluşturun, botu kanala yönetici olarak ekleyin; bot anahtarı ve kanal kimliği (ör. @crewinjob veya -100…) gerekir.', 'For channel posts: create a bot with @BotFather and add it to the channel as an admin; the bot token and the channel ID (e.g. @crewinjob or -100…) are needed.'), link: { href: 'https://t.me/BotFather', label: l('BotFather', 'BotFather') } },
      { text: l('Grup duyurusu için: my.telegram.org’dan API ID ve API hash alın (crewinjob-agent/.env’e yazılır), ardından Telegram botu sekmesinde “+ Oturum ekle” ile oturumu kaydedin.', 'For group announcements: get the API ID and API hash at my.telegram.org (written to crewinjob-agent/.env), then save the session with “+ Add session” in the Telegram bot tab.'), link: { href: 'https://my.telegram.org/apps', label: l('Telegram API', 'Telegram API') } },
      envFile(isLocal), restart(isLocal),
    ],
    env: 'TELEGRAM_BOT_TOKEN=<BotFather anahtarı>\nTELEGRAM_CHANNEL_ID=<@kanal veya -100…>\n# crewinjob-agent/.env:\nTG_API_ID=<API ID>\nTG_API_HASH=<API hash>',
    verify: { text: l('Telegram botu sekmesinde oturumun “bağlı” göründüğünü kontrol edin; kanal için WA & Telegram → TG Kanal Gönder’de önce kısa bir deneme yapın.', 'Check that the session shows as connected in the Telegram bot tab; for the channel, try a short post first in WA & Telegram → Send to TG channel.'), href: '/?tab=telegrambot' } };
}
function crewinAnalytics(env: Env, isLocal: boolean): SetupSection {
  const absent = missing(env, ['GA4_PROPERTY_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GSC_SITE_URL']);
  const invalid = env.GA4_PROPERTY_ID && !/^\d+$/.test(env.GA4_PROPERTY_ID) ? [l('GA4_PROPERTY_ID yalnız rakamlardan oluşmalı (GA4 → Yönetici → Mülk ayarları).', 'GA4_PROPERTY_ID must be digits only (GA4 → Admin → Property settings).')] : [];
  return { id: 'crewin-analytics', group: 'crewin', title: l('Analitik ve Search Console (Crewin sekmeleri)', 'Analytics and Search Console (Crewin tabs)'), state: state(absent, invalid),
    unlocks: [l('Analitik sekmesindeki ziyaret ve arama grafikleri', 'Visit and search charts in the Analytics tab'), l('SEO & Blog → Düşük CTR Raporu', 'SEO & Blog → Low CTR report')],
    problems: [...missingText(absent), ...invalid],
    steps: [
      { text: l('Google Cloud’da bir servis hesabı oluşturup JSON anahtarını indirin. Bu, Ryzevo’nun Google bağlantısından ayrıdır; Crewin’in eski sekmeleri bunu kullanır.', 'Create a service account in Google Cloud and download its JSON key. This is separate from Ryzevo’s Google connection; Crewin’s legacy tabs use it.'), link: { href: 'https://console.cloud.google.com/iam-admin/serviceaccounts', label: l('Servis hesapları', 'Service accounts') } },
      { text: l('Servis hesabının e-postasını GA4’te Yönetici → Mülk erişim yönetimi’ne “Görüntüleyici” olarak, Search Console’da Ayarlar → Kullanıcılar’a ekleyin.', 'Add the service account’s email in GA4 under Admin → Property access management as “Viewer”, and in Search Console under Settings → Users.') },
      envFile(isLocal), restart(isLocal),
    ],
    env: 'GA4_PROPERTY_ID=<sayısal mülk kimliği>\nGOOGLE_SERVICE_ACCOUNT_JSON=<JSON anahtarın tek satır hâli>\nGSC_SITE_URL=<ör. sc-domain:crewinjob.com>',
    verify: { text: l('Analitik sekmesini açın; “yapılandırılmamış” uyarısı yerine grafikler görünmeli.', 'Open the Analytics tab; charts should show instead of the “not configured” notice.'), href: '/?tab=analytics' } };
}

// ── Going live (needed on the live server; on this machine they wait) ──────────────────────────────────────────────
const https = (value: string | undefined) => { try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
function publicAddress(env: Env, origin: string, isLocal: boolean): SetupSection {
  const ok = https(env.NEXT_PUBLIC_APP_URL) && https(env.PLATFORM_PUBLIC_ORIGIN);
  const problems = [...(https(env.NEXT_PUBLIC_APP_URL) ? [] : [l('NEXT_PUBLIC_APP_URL https ile başlayan canlı adres olmalı.', 'NEXT_PUBLIC_APP_URL must be the live address starting with https.')]), ...(https(env.PLATFORM_PUBLIC_ORIGIN) ? [] : [l('PLATFORM_PUBLIC_ORIGIN https ile başlayan canlı adres olmalı.', 'PLATFORM_PUBLIC_ORIGIN must be the live address starting with https.')])];
  const live = isLocal ? 'https://<alan-adınız>' : origin;
  return { id: 'public-address', group: 'live', title: l('Uygulamanın genel adresi', 'Public app address'), state: ok ? 'ready' : isLocal ? 'later' : 'missing',
    unlocks: [l('E-postalardaki abonelikten çıkma ve tıklama bağlantıları', 'Unsubscribe and click links in emails'), l('Sağlayıcıların çektiği görseller ve bağlantılar', 'Images and links that providers fetch')],
    problems: isLocal ? [] : problems,
    steps: [
      { text: l('Canlı sunucuda iki ayarı canlı alan adıyla doldurun. Bu bilgisayarda gerekmez.', 'On the live server, fill both settings with the live domain. Not needed on this machine.') },
      envFile(isLocal),
    ],
    env: `NEXT_PUBLIC_APP_URL=${live}\nPLATFORM_PUBLIC_ORIGIN=${live}`,
    verify: { text: l('Canlıda bir test e-postasındaki “abonelikten çık” bağlantısının canlı adrese gittiğini kontrol edin.', 'On live, check that the “unsubscribe” link in a test email goes to the live address.') } };
}
function sesFeedback(env: Env, origin: string, isLocal: boolean): SetupSection {
  const endpoint = `${isLocal ? 'https://<alan-adınız>' : origin}/api/track/bounce`;
  return { id: 'ses-feedback', group: 'live', title: l('Geri dönen e-posta ve şikâyet bildirimi', 'Bounce and complaint notices'), state: env.SES_SNS_TOPIC_ARN ? 'ready' : isLocal ? 'later' : 'missing',
    unlocks: [l('Geri dönen adreslerin ve şikâyet edenlerin Crewin listelerinden kendiliğinden çıkarılması', 'Bounced addresses and complainers removed from Crewin lists on their own')],
    problems: env.SES_SNS_TOPIC_ARN || isLocal ? [] : [l('SES_SNS_TOPIC_ARN tanımlı değil; bildirimler reddedilir.', 'SES_SNS_TOPIC_ARN is not set; notices are refused.')],
    steps: [
      { text: l('SES → Configuration sets’te bir set oluşturun (adı SES_CONFIGURATION_SET olur) ve “Event destination” olarak SNS seçin: Bounce ve Complaint.', 'In SES → Configuration sets, create a set (its name becomes SES_CONFIGURATION_SET) and add an SNS “Event destination”: Bounce and Complaint.'), link: { href: 'https://console.aws.amazon.com/ses/home#/configuration-sets', label: l('SES configuration sets', 'SES configuration sets') } },
      { text: l('SNS’te o konuya HTTPS aboneliği ekleyin; adres aşağıda. Bu bilgisayardan erişilemez, canlı alan adı gerekir. Abonelik onayını uygulama kendisi yapar.', 'In SNS, add an HTTPS subscription to that topic at the address below. It cannot reach this machine; a live domain is needed. The app confirms the subscription itself.'), copy: { label: l('SNS abonelik adresi', 'SNS subscription endpoint'), value: endpoint } },
      envFile(isLocal),
    ],
    env: 'SES_CONFIGURATION_SET=<configuration set adı>\nSES_SNS_TOPIC_ARN=<arn:aws:sns:…>',
    verify: { text: l('SNS’te aboneliğin “Confirmed” göründüğünü kontrol edin.', 'Check that the subscription shows as “Confirmed” in SNS.') } };
}
function accountEmail(env: Env, isLocal: boolean): SetupSection {
  const names = ['PLATFORM_AUTH_EMAIL_ENABLED', 'PLATFORM_AUTH_ORIGIN', 'PLATFORM_AUTH_FROM_EMAIL', 'PLATFORM_AUTH_SES_REGION', 'PLATFORM_AUTH_SES_ACCESS_KEY_ID', 'PLATFORM_AUTH_SES_SECRET_ACCESS_KEY'], absent = missing(env, names);
  return { id: 'account-email', group: 'live', title: l('Hesap e-postaları (doğrulama, şifre sıfırlama, uyarılar)', 'Account emails (verification, password reset, alerts)'), state: absent.length ? (isLocal ? 'later' : 'missing') : 'ready',
    unlocks: [l('Ryzevo müşterilerinin kayıt doğrulaması ve şifre sıfırlaması', 'Signup verification and password resets for Ryzevo customers'), l('Uyarı ve haftalık koç özeti e-postaları', 'Alert and weekly coach digest emails')],
    problems: isLocal ? [] : missingText(absent),
    steps: [
      { text: l('SES’te gönderen adresi doğrulayın ve yalnız ses:SendEmail izni olan bir IAM erişim anahtarı oluşturun.', 'Verify the sender address in SES and create an IAM access key that can only ses:SendEmail.'), link: { href: 'https://console.aws.amazon.com/iam/home#/users', label: l('IAM kullanıcıları', 'IAM users') } },
      envFile(isLocal), restart(isLocal),
    ],
    env: `PLATFORM_AUTH_EMAIL_ENABLED=1\nPLATFORM_AUTH_ORIGIN=${isLocal ? 'https://<alan-adınız>' : '<canlı adres>'}\nPLATFORM_AUTH_FROM_EMAIL=<ör. no-reply@alan-adınız>\nPLATFORM_AUTH_SES_REGION=<ör. eu-west-1>\nPLATFORM_AUTH_SES_ACCESS_KEY_ID=<IAM erişim anahtarı>\nPLATFORM_AUTH_SES_SECRET_ACCESS_KEY=<IAM gizli anahtar>`,
    verify: { text: l('Canlıda “Şifremi unuttum” ile kendinize bir sıfırlama e-postası isteyin.', 'On live, request a reset email to yourself with “Forgot password”.') } };
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────────────────────────────
function push(env: Env, isLocal: boolean): SetupSection {
  const names = ['PLATFORM_WEB_PUSH_ENABLED', 'PLATFORM_WEB_PUSH_PUBLIC_KEY', 'PLATFORM_WEB_PUSH_PRIVATE_KEY', 'PLATFORM_WEB_PUSH_SUBJECT'], absent = missing(env, names);
  const invalid = absent.length ? [] : [
    ...(env.PLATFORM_WEB_PUSH_ENABLED !== '1' ? [l('PLATFORM_WEB_PUSH_ENABLED=1 olmalı.', 'PLATFORM_WEB_PUSH_ENABLED must be 1.')] : []),
    ...(Buffer.from(env.PLATFORM_WEB_PUSH_PUBLIC_KEY || '', 'base64url').length !== 65 || Buffer.from(env.PLATFORM_WEB_PUSH_PRIVATE_KEY || '', 'base64url').length !== 32 ? [l('VAPID anahtar çifti biçimi hatalı; “Üret” ile yeni bir çift üretip ikisini birlikte değiştirin.', 'The VAPID key pair has the wrong format; make a new pair with “Generate” and replace both together.')] : []),
    ...(!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env.PLATFORM_WEB_PUSH_SUBJECT || '') ? [l('PLATFORM_WEB_PUSH_SUBJECT “mailto:siz@alan-adı” biçiminde olmalı.', 'PLATFORM_WEB_PUSH_SUBJECT must look like “mailto:you@domain”.')] : [])];
  return { id: 'push', group: 'notifications', title: l('Tarayıcı ve telefon bildirimleri', 'Browser and phone notifications'), state: state(absent, invalid),
    unlocks: [l('Dikkat gerekenler, onay bekleyenler ve SEO uyarılarının bildirim olarak gelmesi (Crewin hesabının e-postası olmadığı için uyarıların tek yolu)', 'Needs-attention items, approvals and SEO alerts arriving as notifications (the only way for alerts, since the Crewin account has no email)')],
    problems: [...missingText(absent), ...invalid],
    steps: [
      { text: l('“Üret” ile bir VAPID anahtar çifti üretin; iki satır birlikte üretilir ve yalnız bu tarayıcıda görünür. Özel anahtarı paylaşmayın.', 'Make a VAPID key pair with “Generate”; both lines are made together and shown only in this browser. Do not share the private key.'), generate: { kind: 'vapid', name: 'PLATFORM_WEB_PUSH' } },
      { text: l('Üretilen iki satırı ve aşağıdaki iki satırı .env.local’e ekleyin (iletişim adresini kendi adresinizle değiştirin).', 'Add the two generated lines and the two lines below to .env.local (replace the contact with your own address).') },
      restart(isLocal),
      { text: l('Genel bakıştaki “Dikkat gerekenler” kartından bildirimleri açın; tarayıcı izin ister. iPhone’da önce paneli ana ekrana ekleyin.', 'Turn notifications on from the “Needs attention” card on the overview; the browser asks for permission. On an iPhone, add the panel to the home screen first.') },
    ],
    env: 'PLATFORM_WEB_PUSH_ENABLED=1\nPLATFORM_WEB_PUSH_SUBJECT=mailto:<sizin e-posta adresiniz>',
    verify: { text: l('Bildirimleri açtıktan sonra bir uyarı oluştuğunda en geç birkaç dakika içinde bildirim gelir (zamanlanmış işler çalışıyor olmalı).', 'Once on, a notification arrives within minutes of a new alert (scheduled jobs must be running).'), href: '/?tab=dashboard' } };
}

// ── Switches that are off on purpose: each says what turning it on changes ──────────────────────────────────────────
const SWITCHES: { name: string; title: LocalizedText; on: LocalizedText; needs: LocalizedText }[] = [
  { name: 'PLATFORM_SOCIAL_PUBLISH_ENABLED', title: l('Gerçek sosyal yayın ve yanıt', 'Real social publishing and replies'), on: l('Onaylanan Ryzevo yayınları ve gelen kutusu cevapları gerçekten gider (Crewin’in Sosyal medya sekmesi bundan bağımsızdır).', 'Approved Ryzevo posts and inbox replies really go out (Crewin’s Social media tab is independent of this).'), needs: l('Meta bağlantısı ve yayın izni.', 'A Meta connection with publishing permission.') },
  { name: 'PLATFORM_EMAIL_PILOT_SEND_ENABLED', title: l('Gerçek e-posta pilot gönderimi', 'Real email pilot sending'), on: l('Onaylı e-posta pilotları müşterinin kendi SES hesabından gerçekten gönderilir.', 'Approved email pilots are really sent from the customer’s own SES account.'), needs: l('Doğrulanmış gönderen ve SES.', 'A verified sender and SES.') },
  { name: 'PLATFORM_WHATSAPP_SEND_ENABLED', title: l('Gerçek WhatsApp gönderimi (Ryzevo)', 'Real WhatsApp sending (Ryzevo)'), on: l('Onaylı WhatsApp şablon gönderileri gider; Meta her mesajı ücretlendirir.', 'Approved WhatsApp template batches go out; Meta bills each message.'), needs: l('WhatsApp bağlantısı ve onaylı şablon.', 'A WhatsApp connection and an approved template.') },
  { name: 'PLATFORM_ADS_ENABLED', title: l('Reklam oluşturma ve başlatma', 'Creating and starting ads'), on: l('Onaylı reklam planları sağlayıcıda duraklatılmış oluşturulur; başlatmak ayrıca onay ister ve harcama tavanı içinde kalır.', 'Approved ad plans are created paused at the provider; starting needs separate approval and stays within the spend cap.'), needs: l('Reklam hesabı bağlantısı ve harcama tavanı.', 'An ad account connection and a spend cap.') },
  { name: 'PLATFORM_ALERT_EMAIL_ENABLED', title: l('Uyarı e-postaları', 'Alert emails'), on: l('Abone olan ekip üyelerine uyarılar e-postayla gider.', 'Alerts are emailed to teammates who subscribed.'), needs: l('Hesap e-postaları kartı.', 'The account emails card.') },
  { name: 'PLATFORM_PUBLIC_SIGNUP_ENABLED', title: l('Herkese açık kayıt', 'Public signup'), on: l('Herkes /register adresinden Ryzevo hesabı açabilir.', 'Anyone can open a Ryzevo account at /register.'), needs: l('Hesap e-postaları kartı ve yasal metinler.', 'The account emails card and the legal texts.') },
  { name: 'PLATFORM_PAYTR_LIVE_ENABLED', title: l('Canlı ödeme (PayTR)', 'Live payments (PayTR)'), on: l('Müşteriler gerçek ödeme yapar; plan yalnız imzalı ve tutarı tutan bildirimle açılır.', 'Customers really pay; a plan opens only on a signed, amount-matching notice.'), needs: l('PayTR mağaza bilgileri, USD onayı, https adres ve satış koşulları sayfası.', 'PayTR merchant details, USD approval, an https address and a sales terms page.') },
];
function switches(env: Env): SetupSection {
  return { id: 'switches', group: 'switches', title: l('Açma kararı sizde olan anahtarlar', 'Switches that are yours to turn on'), state: 'decision',
    unlocks: [l('Bunlar bilerek kapalı tutulur; her biri açılınca gerçek bir şey gönderir, yayınlar veya ücret alır.', 'These are off on purpose; each one, once on, really sends, publishes or charges.')],
    problems: [],
    steps: SWITCHES.map(item => ({ text: l(`${item.title.tr} — şu an ${env[item.name] === '1' ? 'AÇIK' : 'kapalı'}. Açılınca: ${item.on.tr} Gerekenler: ${item.needs.tr}`, `${item.title.en} — now ${env[item.name] === '1' ? 'ON' : 'off'}. When on: ${item.on.en} Needs: ${item.needs.en}`), copy: { label: l('Açmak için satır', 'Line to turn it on'), value: `${item.name}=1` } })),
    env: null, verify: { text: l('Bir anahtarı açtıktan sonra sunucuyu yeniden başlatın; operatör konsolundaki “Canlıya geçiş durumu” listesi yeni durumu gösterir.', 'After turning a switch on, restart the server; the “Go-live readiness” list in the operator console shows the new state.') } };
}

// extra: what the route reads outside the process environment: the agent's .env (Telegram session), the key file and the
// settings files next to the project that are checked for pasted secrets.
export type SetupExtra = { agentEnv?: Env; keyFile?: { exists: boolean; path: string }; files?: { label: string; text: string }[] };
export function serverSetup(db: Database.Database, origin: string, env: Env = process.env, now = Date.now(), extra: SetupExtra = {}): SetupGuide {
  const isLocal = local(origin), keyFile = extra.keyFile || { exists: false, path: 'data/platform-credentials.key' };
  return { origin, local: isLocal, generatedAt: new Date(now).toISOString(), sections: [
    google(env, origin, isLocal), meta(env, origin, isLocal), gemini(env, isLocal), worker(db, env, origin, isLocal, now),
    adminPassword(env, isLocal), authSecret(env, isLocal), encryptionKey(env, keyFile, isLocal), plaintextSecrets(env, extra.files || []),
    crewinEmail(env, isLocal), crewinWhatsApp(env, isLocal), crewinTelegram(env, extra.agentEnv || {}, isLocal), crewinAnalytics(env, isLocal),
    publicAddress(env, origin, isLocal), sesFeedback(env, origin, isLocal), accountEmail(env, isLocal),
    push(env, isLocal), switches(env),
  ] };
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


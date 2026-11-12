const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Testler gerçek .env / .userbot-config.json dosyalarını OKUMAMALI: agent-config'in
// loadAgentConfig'ini require cache üzerinden etkisizleştir.
const agentConfigPath = require.resolve('../modules/agent-config.js');
const realAgentConfig = require(agentConfigPath);
require.cache[agentConfigPath].exports = { ...realAgentConfig, loadAgentConfig: () => {} };

// Etiket kaydı gerçek data/ yerine geçici dosyaya yazılır.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-tags-'));
process.env.CREWIN_LINK_TAGS_FILE = path.join(dir, 'link-tags.jsonl');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const linkTags = require('../modules/link-tags');
// Etiket kaydı arkada sırayla yazılır: okumadan önce flush() beklenir.
const lines = async () => { await linkTags.flush(); return fs.readFileSync(process.env.CREWIN_LINK_TAGS_FILE, 'utf8').trim().split('\n').map(line => JSON.parse(line)); };

test('crewinjob.com linkleri etiketlenir; utm_source/utm_medium korunur, başka site ve abonelik linki değişmez', () => {
  const tag = linkTags.crewinTag('bot', 'telegram-bot');
  assert.match(tag, /^rz_[a-f0-9]{10}$/);
  const url = new URL(linkTags.tagUrl('https://crewinjob.com/ilanlar?rank=master&utm_source=telegram&utm_medium=bot', tag));
  assert.equal(url.searchParams.get('utm_campaign'), tag);
  assert.equal(url.searchParams.get('utm_medium'), 'bot', 'var olan medium korunur');
  assert.equal(url.searchParams.get('rank'), 'master');
  assert.equal(linkTags.tagUrl('https://example.com/a', tag), 'https://example.com/a');
  assert.equal(linkTags.tagUrl('https://crewinjob.com/?utm_campaign=kis', tag), 'https://crewinjob.com/?utm_campaign=kis', 'kampanyası olan link aynen kalır');
  assert.equal(linkTags.tagUrl('https://www.crewinjob.com/unsubscribe?token=x', tag), 'https://www.crewinjob.com/unsubscribe?token=x');
  assert.equal(linkTags.tagUrl('https://evilcrewinjob.com/', tag), 'https://evilcrewinjob.com/');
  const text = linkTags.tagText('Kayıt: https://crewinjob.com/register. Kaçışlı: <a href="https://crewinjob.com/x?a=1&amp;b=2">x</a>', tag, { source: 'telegram', medium: 'bot' });
  assert.ok(text.includes(`https://crewinjob.com/register?utm_source=telegram&utm_medium=bot&utm_campaign=${tag}.`), 'sondaki nokta linkin dışında kalır');
  assert.ok(text.includes('href="https://crewinjob.com/x?a=1&amp;b=2"'), '&amp; taşıyan link aynen kalır');
});

test('ilan linki ilan etiketini taşır; genel başlık bir kez gerçek başlıkla güncellenir, sonra değişmez', async () => {
  const url = new URL(linkTags.jobLink('https://crewinjob.com/jobs/detail/77', 77, '', 'group'));
  assert.equal(url.searchParams.get('utm_campaign'), linkTags.crewinTag('job', '77'));
  assert.equal(url.searchParams.get('utm_medium'), 'group');
  linkTags.jobLink('https://crewinjob.com/jobs/detail/77', '77', 'Master · Tanker', 'channel');
  linkTags.jobLink('https://crewinjob.com/jobs/detail/77', '77', 'Başka', 'group');
  const job = (await lines()).filter(line => line.tag === linkTags.crewinTag('job', '77'));
  assert.deepEqual(job.map(line => line.title), ['İlan #77', 'İlan: Master · Tanker']);
  assert.equal(linkTags.jobIdFromUrl('https://crewinjob.com/jobs/detail/77?utm_source=telegram'), '77');
  const fixed = new URL(linkTags.jobLink('https://crewinjob.com/', null, '', 'group'));
  assert.equal(fixed.searchParams.get('utm_campaign'), linkTags.crewinTag('bot', 'telegram-groups'), 'kimliksiz link grup etiketini alır');
});

test('kanal paylaşımı ve /jobs yanıtı etiketli ilan linki taşır', async () => {
  const poster = require('../modules/telegram-poster');
  const post = poster.formatJobPost({ jobId: 91, title: 'Chief Engineer', vesselType: 'Bulk Carrier' }, 'channel');
  const href = post.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const url = new URL(href);
  assert.equal(url.searchParams.get('utm_campaign'), linkTags.crewinTag('job', '91'));
  assert.equal(url.searchParams.get('utm_medium'), 'channel');
  assert.ok((await lines()).some(line => line.title === 'İlan: Chief Engineer · Bulk Carrier'));
  assert.ok(!/href="[^"]*&(?!amp;)/.test(post), 'HTML modunda & kaçışlanır');
  const bot = new URL(poster.formatJobPost({ jobId: 91, title: 'Chief Engineer' }).match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&'));
  assert.equal(bot.searchParams.get('utm_medium'), 'bot', '/jobs yanıtı bot olarak kalır');
});

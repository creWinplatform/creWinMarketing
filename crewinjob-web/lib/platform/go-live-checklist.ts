import 'server-only';
import fs from 'fs';
import path from 'path';
import type { LocalizedText } from './catalog';
import type { Checklist, ChecklistItem } from './server-setup-types';

// Go-live work that is not a server setting. The team ticks an item when it is done; the record keeps who and when.
// The system does not check these itself and does not say it did. Kept in a small file next to the database (no
// migration): { [id]: { by, at } }.
const l = (tr: string, en: string): LocalizedText => ({ tr, en });
export const CHECKLIST: Omit<ChecklistItem, 'done'>[] = [
  { id: 'legal-privacy', title: l('KVKK aydınlatma metni ve gizlilik politikası yayında', 'Privacy notice (KVKK) and privacy policy published'), detail: l('Sitede yayında ve kayıt, iletişim ve abonelik formlarından bağlantı veriliyor.', 'Published on the site and linked from the signup, contact and subscription forms.') },
  { id: 'legal-terms', title: l('Kullanım koşulları ve mesafeli satış sözleşmesi', 'Terms of use and distance sales agreement'), detail: l('Ödeme açılacaksa PLATFORM_BILLING_TERMS_URL bu sayfayı göstermeli.', 'If payments will be on, PLATFORM_BILLING_TERMS_URL must point to this page.') },
  { id: 'iys', title: l('İYS kaydı ve ticari ileti izinleri', 'IYS registration and commercial message consent'), detail: l('E-posta, SMS veya WhatsApp ile ticari ileti gönderilecekse İleti Yönetim Sistemi’ne kayıt ve alınan izinlerin İYS’ye işlenmesi.', 'If commercial messages go out by email, SMS or WhatsApp: registration with the Message Management System (IYS) and the consents recorded there.'), link: { href: 'https://iys.org.tr', label: l('İYS', 'IYS') } },
  { id: 'meta-review', title: l('Meta uygulama incelemesi onaylandı', 'Meta app review approved'), detail: l('Gelen kutusu ve yayın izinleri herkese açık kullanım için Meta incelemesinden geçti ve uygulama “Live” modunda.', 'The inbox and publishing permissions passed Meta review for public use and the app is in “Live” mode.'), link: { href: 'https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review', label: l('Meta App Review', 'Meta App Review') } },
  { id: 'google-verification', title: l('Google OAuth uygulaması yayında ve doğrulandı', 'Google OAuth app in production and verified'), detail: l('İzin ekranı “In production” durumunda; gerekiyorsa Google doğrulaması tamamlandı (yalnız test kullanıcılarıyla çalışırken gerekmez).', 'The consent screen is “In production”; Google verification is done if required (not needed while only test users connect).'), link: { href: 'https://support.google.com/cloud/answer/13463073', label: l('Google doğrulaması', 'Google verification') } },
  { id: 'server', title: l('Canlı sunucu, alan adı ve HTTPS', 'Live server, domain and HTTPS'), detail: l('EC2/VPS kurulu, alan adı sunucuya yönleniyor ve geçerli bir HTTPS sertifikası var.', 'The EC2/VPS is set up, the domain points to it and a valid HTTPS certificate is in place.') },
  { id: 'backups', title: l('Düzenli yedek ve geri dönüş denemesi', 'Regular backups and a restore test'), detail: l('Veritabanı düzenli yedekleniyor (npm run backup:platform), şifreleme anahtarı ayrı bir yerde saklanıyor ve bir yedekten geri dönüş en az bir kez denendi.', 'The database is backed up regularly (npm run backup:platform), the encryption key is kept somewhere else and a restore from a backup was tried at least once.') },
  { id: 'email-dns', title: l('Gönderen alan adında SPF, DKIM ve DMARC', 'SPF, DKIM and DMARC on the sender domain'), detail: l('E-postaların spam klasörüne düşmemesi için alan adının DNS kayıtları tamam.', 'The domain’s DNS records are in place so emails do not land in spam.') },
];
type Store = Record<string, { by: string; at: string }>;
const read = (file: string): Store => { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value as Store : {}; } catch { return {}; } };
export function goLiveChecklist(file: string): Checklist {
  const store = read(file);
  return { items: CHECKLIST.map(item => { const done = store[item.id]; return { ...item, done: done && typeof done.by === 'string' && typeof done.at === 'string' ? { by: done.by, at: done.at } : null }; }) };
}
export function setChecklistItem(file: string, id: unknown, done: unknown, by: string, now = new Date()): Checklist {
  if (typeof id !== 'string' || !CHECKLIST.some(item => item.id === id) || typeof done !== 'boolean') throw Object.assign(new Error('Geçersiz kontrol listesi öğesi.'), { status: 400 });
  const store = read(file);
  if (done) store[id] = { by: by.slice(0, 80), at: now.toISOString() }; else delete store[id];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2)); fs.renameSync(tmp, file);
  return goLiveChecklist(file);
}

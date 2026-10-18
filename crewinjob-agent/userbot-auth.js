'use strict';
/**
 * Tek seferlik kimlik doğrulama.
 * Çalıştır: node userbot-auth.js
 * Çıkan TG_SESSION değerini .env dosyasına ekle.
 */
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline           = require('readline');

const API_ID   = parseInt(process.env.TG_API_ID   || '0');
const API_HASH = process.env.TG_API_HASH || '';

if (!API_ID || !API_HASH) {
  console.error('❌  .env dosyasında TG_API_ID ve TG_API_HASH tanımlı olmalı');
  process.exit(1);
}

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

(async () => {
  console.log('\n🔐  Telegram Userbot — Tek Seferlik Giriş\n');

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => ask('📱  Telefon numaranı gir (+905551234567): '),
    phoneCode:   () => ask('🔑  Telegram\'dan gelen 5 haneli kodu gir: '),
    password:    () => ask('🔒  2FA şifreni gir (yoksa Enter): '),
    onError:     (err) => console.error('Hata:', err.message),
  });

  console.log('\n✅  Giriş başarılı!\n');
  const sessionStr = client.session.save();

  console.log('─'.repeat(60));
  console.log('Aşağıdaki satırı .env dosyasına ekle:\n');
  console.log(`TG_SESSION=${sessionStr}`);
  console.log('─'.repeat(60));
  console.log('\n⚠️  Bu değeri kimseyle paylaşma!\n');

  rl.close();
  await client.disconnect();
})().catch(console.error);

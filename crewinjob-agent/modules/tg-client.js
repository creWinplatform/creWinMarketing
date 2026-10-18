'use strict';
// Paylaşılan gramjs TelegramClient singleton — tüm modüller buradan alır
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { loadAgentConfig } = require('./agent-config');

// Config: process.env > .userbot-config.json > .env — bkz. agent-config.js
function loadEnv() {
  loadAgentConfig();
}

let _client     = null;
let _connecting = null;

async function getClient() {
  loadEnv();
  if (_client && _client.connected) return _client;
  if (_connecting) return await _connecting;

  const API_ID  = parseInt(process.env.TG_API_ID  || '0');
  const API_HASH =          process.env.TG_API_HASH || '';
  const SESSION  =          process.env.TG_SESSION  || '';

  if (!API_ID || !API_HASH || !SESSION) {
    throw new Error('TG_API_ID, TG_API_HASH ve TG_SESSION .env dosyasında tanımlı olmalı');
  }

  _connecting = (async () => {
    _client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
      connectionRetries: 5,
      retryDelay:        2000,
      autoReconnect:     true,
    });
    await _client.connect();
    return _client;
  })().finally(() => { _connecting = null; });

  return await _connecting;
}

// GramJS disconnect() update döngüsünü/zamanlayıcıları her zaman durdurmuyor → CLI süreci
// kapanmıyordu. destroy() varsa onu kullan (disconnect + döngüyü sonlandırır).
async function disconnect() {
  if (_connecting) { try { await _connecting; } catch {} }
  if (_client) {
    const c = _client;
    _client = null;
    try {
      if (typeof c.destroy === 'function') await c.destroy();
      else await c.disconnect();
    } catch {}
  }
}

function isConnected() {
  return !!(_client && _client.connected);
}

module.exports = { getClient, disconnect, isConnected };

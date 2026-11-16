// The licensed music library for the design studio's videos (platform_music_tracks, schema 81). Run on the server, in
// crewinjob-web, by the operator after buying a licence that also covers customers' use (an app/SaaS licence):
//   node scripts/music-library.cjs add --file <track.mp3|.m4a|.wav> --title "…" --artist "…" --mood calm|upbeat|corporate|emotional|energetic \
//        --license "<licence name and terms URL>" --source "<vendor>" [--duration 95]
//   node scripts/music-library.cjs list
//   node scripts/music-library.cjs disable <track id>        (hidden from the studio; the row stays for the record)
// Uses SQL Server when PLATFORM_DATABASE_PROVIDER=mssql (connection from appsettings.json), otherwise the SQLite file.
// Prints no connection details.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(path.join(__dirname, '..'));

const MOODS = ['calm', 'upbeat', 'corporate', 'emotional', 'energetic'];
const MAX = 15 * 1024 * 1024;
const [command, ...rest] = process.argv.slice(2);
const option = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const fail = message => { console.error(message); process.exit(1); };
function sniff(bytes) {
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  return null;
}
async function database() {
  if (process.env.PLATFORM_DATABASE_PROVIDER === 'mssql') {
    const sql = require('mssql'), { connectionString } = require('../lib/db/settings.cjs'), value = connectionString();
    if (!value) fail('PLATFORM_DATABASE_PROVIDER=mssql needs ConnectionStrings.Platform in appsettings.json.');
    const pool = await new sql.ConnectionPool(value).connect();
    const request = params => { const r = pool.request(); params.forEach((v, i) => r.input(`p${i + 1}`, Buffer.isBuffer(v) ? sql.VarBinary(sql.MAX) : typeof v === 'number' ? sql.BigInt : sql.NVarChar(sql.MAX), v)); return r; };
    const q = (text, params = []) => { let i = 0; return request(params).query(text.replace(/\?/g, () => `@p${++i}`)); };
    return { all: async (text, params) => (await q(text, params)).recordset, run: async (text, params) => (await q(text, params)).rowsAffected.reduce((a, b) => a + b, 0), close: () => pool.close() };
  }
  const Database = require('better-sqlite3'), file = process.env.PLATFORM_DATABASE_PATH || path.join(__dirname, '..', 'data', 'platform.sqlite');
  if (!fs.existsSync(file)) fail('The platform database file was not found.');
  const db = new Database(file);
  return { all: async (text, params = []) => db.prepare(text).all(...params), run: async (text, params = []) => db.prepare(text).run(...params).changes, close: async () => db.close() };
}
(async () => {
  if (!['add', 'list', 'disable'].includes(command)) fail('Usage: music-library.cjs add|list|disable (see the header of this file).');
  const db = await database();
  try {
    const table = await db.all("SELECT name FROM " + (process.env.PLATFORM_DATABASE_PROVIDER === 'mssql' ? "sys.tables WHERE name='platform_music_tracks'" : "sqlite_master WHERE type='table' AND name='platform_music_tracks'"));
    if (!table.length) fail('platform_music_tracks is missing: run the schema 81 upgrade first (npm run db:upgrade).');
    if (command === 'list') {
      for (const row of await db.all('SELECT id,title,artist,mood,duration_ms,bytes,active,source FROM platform_music_tracks ORDER BY created_at')) console.log(`${row.id}  ${Number(row.active) ? 'active  ' : 'disabled'}  ${row.mood.padEnd(9)}  ${row.title} — ${row.artist} (${Math.round(Number(row.bytes) / 1024)} KB, ${row.source})`);
      return;
    }
    if (command === 'disable') {
      const id = rest[0];
      if (!/^trk_[a-f0-9]{24}$/.test(id || '')) fail('Give a track id from the list.');
      console.log((await db.run('UPDATE platform_music_tracks SET active=0 WHERE id=?', [id])) ? `Disabled ${id}.` : 'No such track.');
      return;
    }
    const file = option('file'), title = (option('title') || '').trim(), artist = (option('artist') || '').trim(), mood = option('mood'), license = (option('license') || '').trim(), source = (option('source') || '').trim();
    if (!file || !fs.existsSync(file)) fail('--file must point to an audio file.');
    if (!title || title.length > 120 || !artist || artist.length > 120) fail('--title and --artist are required (at most 120 characters).');
    if (!MOODS.includes(mood)) fail(`--mood must be one of: ${MOODS.join(', ')}.`);
    if (license.length < 5 || license.length > 400 || !source || source.length > 80) fail('--license (licence name and terms, 5–400 characters) and --source (vendor) are required.');
    const bytes = fs.readFileSync(file), mime = sniff(bytes), duration = option('duration') ? Math.round(Number(option('duration')) * 1000) : null;
    if (!mime) fail('The file is not MP3, M4A/AAC or WAV.');
    if (bytes.length > MAX) fail('The file is larger than 15 MB.');
    if (duration !== null && !(duration > 0 && duration < 3600000)) fail('--duration is in seconds.');
    const sha = createHash('sha256').update(bytes).digest('hex');
    if ((await db.all('SELECT id FROM platform_music_tracks WHERE sha256=?', [sha])).length) fail('This file is already in the library.');
    const id = `trk_${randomBytes(12).toString('hex')}`;
    await db.run('INSERT INTO platform_music_tracks(id,title,artist,mood,duration_ms,mime,bytes,sha256,data,license,source,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)', [id, title, artist, mood, duration, mime, bytes.length, sha, bytes, license, source, new Date().toISOString()]);
    console.log(`Added ${id}: ${title} — ${artist} (${mime}, ${Math.round(bytes.length / 1024)} KB).`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exit(2); });

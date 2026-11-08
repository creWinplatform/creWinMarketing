// SQL Server connection settings. The connection string is read, in order, from PLATFORM_MSSQL_CONNECTION,
// then ConnectionStrings.Platform in appsettings.json (or the file named by PLATFORM_APPSETTINGS_PATH).
// appsettings*.json is git-ignored; the string is never logged — describe() returns it without the password.
const fs = require('node:fs');
const path = require('node:path');

function appSettingsPath() {
  return process.env.PLATFORM_APPSETTINGS_PATH || path.join(process.cwd(), 'appsettings.json');
}

function connectionString() {
  if (process.env.PLATFORM_MSSQL_CONNECTION) return normalize(process.env.PLATFORM_MSSQL_CONNECTION);
  const file = appSettingsPath();
  if (!fs.existsSync(file)) return '';
  // Visual Studio writes appsettings.json with a BOM; JSON.parse refuses it.
  const settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const value = settings?.ConnectionStrings?.Platform;
  return typeof value === 'string' ? normalize(value.trim()) : '';
}

// ADO.NET (and so ABP) accepts aliases the Node driver does not: "User", "Username" and "UID" for "User Id",
// "PWD" for "Password", "Addr" for "Server". Rename them so the same string works in both.
const ALIASES = { user: 'User Id', username: 'User Id', uid: 'User Id', pwd: 'Password', addr: 'Server', address: 'Server' };
function normalize(value) {
  return value.split(';').map(part => {
    const at = part.indexOf('=');
    if (at < 0) return part;
    const key = part.slice(0, at).trim();
    return (ALIASES[key.toLowerCase()] || key) + '=' + part.slice(at + 1);
  }).join(';');
}

// Server, port, database and user only, for logs and checks.
function describe(value = connectionString()) {
  const parts = Object.fromEntries(value.split(';').map(part => part.split('=')).filter(pair => pair.length >= 2)
    .map(([key, ...rest]) => [key.trim().toLowerCase(), rest.join('=').trim()]));
  return {
    server: parts.server || parts['data source'] || parts.address || '',
    database: parts.database || parts['initial catalog'] || '',
    user: parts['user id'] || parts.uid || parts.user || '',
    encrypt: !/^(false|no|0)$/i.test(parts.encrypt || 'true'),
    trustServerCertificate: /^(true|yes|1)$/i.test(parts.trustservercertificate || ''),
  };
}

module.exports = { appSettingsPath, connectionString, describe };

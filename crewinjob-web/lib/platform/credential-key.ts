import 'server-only';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MarketingStoreError } from './marketing-store';

export function credentialEncryptionKey(): string {
  const configured = process.env.PLATFORM_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new MarketingStoreError('Bağlantı şifreleme anahtarı geçersiz.', 503);
    return configured;
  }
  const directory = dirname(process.env.PLATFORM_DATABASE_PATH || join(process.cwd(), 'data', 'platform.sqlite'));
  const file = join(directory, 'platform-credentials.key');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, randomBytes(32).toString('hex'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  const key = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new MarketingStoreError('Bağlantı şifreleme anahtarı okunamadı.', 503);
  return key;
}

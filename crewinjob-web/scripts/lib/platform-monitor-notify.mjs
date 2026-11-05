import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Plain-language lines for the operator email. Only the alert codes and counts leave the host.
const EXPLAIN = {
  worker_stale: 'Zamanlanmış işler (worker) bir süredir çalışmıyor.',
  worker_stalled: 'Zamanlanmış işlerin son turu bitmedi; worker takılmış olabilir.',
  worker_no_recent_success: 'Zamanlanmış işlerin son başarılı turu çok eski.',
  worker_not_observed: 'Zamanlanmış işler (worker) hiç çalışmamış.',
  worker_tick_failed: 'Zamanlanmış işlerin son turu hata verdi.',
  worker_tick_partial: 'Zamanlanmış işlerin bazı adımları hata verdi.',
  worker_observation_invalid: 'Worker kaydı tutarsız; saat ayarını kontrol edin.',
  worker_not_expected_with_ready_jobs: 'Bekleyen işler var ama worker beklenmiyor olarak ayarlı.',
  queue_delayed: 'Bekleyen işler gecikti.',
  queue_expired_leases: 'Yarım kalmış işler var.',
  queue_recent_failures: 'Son 24 saatte başarısız işler var.',
  queue_unsupported_jobs: 'Bu sürümün tanımadığı işler kuyrukta.',
  queue_missing_payload: 'İçeriği kaybolmuş işler kuyrukta.',
  email_delivery_uncertain: 'Gidip gitmediği belli olmayan e-postalar var; elle kontrol gerekir.',
  social_publication_uncertain: 'Yayınlanıp yayınlanmadığı belli olmayan gönderiler var; elle kontrol gerekir.',
  mobile_delivery_uncertain: 'Gidip gitmediği belli olmayan mobil mesajlar var; elle kontrol gerekir.',
  identity_delivery_uncertain: 'Gidip gitmediği belli olmayan giriş e-postaları var.',
  billing_requires_review: 'İncelenmesi gereken ödemeler var.',
  billing_inquiry_interrupted: 'Yarım kalmış ödeme sorguları var.',
  database_unavailable: 'Veritabanı okunamıyor.',
  database_check_failed: 'Veritabanı bütünlük kontrolü başarısız.',
  database_schema_unsupported: 'Veritabanı sürümü bu kodla uyumsuz.',
  database_schema_upgrade_pending: 'Veritabanı güncellemesi bekliyor.',
  backup_missing: 'Hiç yedek yok.',
  backup_missing_or_incomplete: 'Son yedek eksik.',
  backup_verification_failed: 'Son yedek doğrulanamadı.',
  backup_stale: 'Son yedek çok eski.',
  backup_database_mismatch: 'Son yedek başka bir veritabanına ait.',
  backup_database_binding_unknown: 'Son yedeğin hangi veritabanına ait olduğu bilinmiyor.',
  backup_timestamp_invalid: 'Son yedeğin tarihi geçersiz.',
  restore_drill_stale: 'Geri yükleme provası bir haftadan uzun süredir yapılmadı.',
  restore_drill_failed: 'Son geri yükleme provası başarısız oldu.',
  disk_space_low: 'Diskte yer azaldı.',
  disk_check_unavailable: 'Disk alanı okunamadı.',
};
const EMAIL = /^[^\s@,;<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;

// Off unless the operator turns it on; reuses the SES sender of account emails.
export function monitorNotifyConfiguration(env = process.env) {
  if (env.PLATFORM_MONITOR_EMAIL_ENABLED !== '1') return null;
  const to = String(env.PLATFORM_MONITOR_EMAIL_TO || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const region = env.PLATFORM_AUTH_SES_REGION || '', from = String(env.PLATFORM_AUTH_FROM_EMAIL || '').trim().toLowerCase();
  const accessKeyId = env.PLATFORM_AUTH_SES_ACCESS_KEY_ID || '', secretAccessKey = env.PLATFORM_AUTH_SES_SECRET_ACCESS_KEY || '';
  if (!to.length || to.length > 5 || !to.every(value => EMAIL.test(value)) || !EMAIL.test(from)) return null;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^AKIA[A-Z0-9]{16}$/.test(accessKeyId) || !/^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey)) return null;
  const label = String(env.PLATFORM_MONITOR_HOST_LABEL || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
  return { to: [...new Set(to)], from, region, accessKeyId, secretAccessKey, label };
}

const signature = report => [...new Set(report.alerts.map(item => item.code))].sort().join(',');
// One email when the problem set changes, a reminder while it lasts, and one when it clears.
export function monitorNotifyDecision(report, previous, now = Date.now()) {
  const codes = signature(report), last = previous && typeof previous === 'object' ? previous : {};
  if (report.status === 'ok') return last.status && last.status !== 'ok' ? { send: true, kind: 'resolved' } : { send: false };
  const repeatMs = (report.status === 'critical' ? 6 : 24) * 3600000;
  if (last.codes !== codes || last.status !== report.status) return { send: true, kind: 'problem' };
  return now - (Date.parse(last.notifiedAt) || 0) >= repeatMs ? { send: true, kind: 'reminder' } : { send: false };
}

export function monitorMessage(report, kind, label = '') {
  const where = label ? ` · ${label}` : '';
  if (kind === 'resolved') return { subject: `Ryzevo izleme${where}: sorunlar giderildi`, text: `Ryzevo izleme${where}\n\nSon kontrolde sorun bulunmadı (${report.checkedAt}).\n\nBu e-posta yalnız durum kodlarından üretildi; içinde müşteri verisi yoktur.` };
  const critical = report.status === 'critical', lines = report.alerts.map(item => `- ${EXPLAIN[item.code] || item.code}${item.count ? ` (${item.count})` : ''} [${item.code}]`);
  return {
    subject: `Ryzevo izleme${where}: ${critical ? 'acil sorun' : 'uyarı'}${kind === 'reminder' ? ' (sürüyor)' : ''}`,
    text: [`Ryzevo izleme${where}`, '', critical ? 'Acil bakılması gereken sorunlar var:' : 'Bakılması gereken uyarılar var:', ...lines, '', `Kontrol zamanı: ${report.checkedAt}`, 'Ayrıntı için sunucuda: npm run monitor:platform', '', 'Bu e-posta yalnız durum kodlarından üretildi; içinde müşteri verisi yoktur. Hiçbir iş kendiliğinden yeniden denenmedi.'].join('\n'),
  };
}

export async function deliverMonitorEmail(mail, configuration, createClient) {
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const client = (createClient || (options => new SESv2Client(options)))({ region: configuration.region, endpoint: `https://email.${configuration.region}.amazonaws.com`, credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey }, maxAttempts: 1 });
  try {
    const result = await client.send(new SendEmailCommand({ FromEmailAddress: configuration.from, Destination: { ToAddresses: configuration.to }, ConfigurationOverrides: { Tracking: { ClickTrackingEnabled: 'DISABLED', OpenTrackingEnabled: 'DISABLED' } },
      Content: { Simple: { Subject: { Data: mail.subject, Charset: 'UTF-8' }, Body: { Text: { Data: mail.text, Charset: 'UTF-8' } } } } }), { abortSignal: AbortSignal.timeout(8000) });
    if (!result.MessageId) throw new Error('unconfirmed_delivery');
  } finally { client.destroy(); }
}

// The state file only holds the last notified status, codes and time; a failed send is retried next run.
export async function notifyMonitor({ report, statePath, env = process.env, now = Date.now(), deliver = deliverMonitorEmail }) {
  const configuration = monitorNotifyConfiguration(env);
  if (!configuration) return 'disabled';
  let previous = null;
  try { previous = JSON.parse(await readFile(statePath, 'utf8')); } catch {}
  const decision = monitorNotifyDecision(report, previous, now);
  if (!decision.send) return 'not_needed';
  try { await deliver(monitorMessage(report, decision.kind, configuration.label), configuration); } catch { return 'failed'; }
  const state = { status: report.status, codes: signature(report), notifiedAt: new Date(now).toISOString() };
  try {
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await rename(temporary, statePath);
  } catch { return 'sent_state_not_saved'; }
  return 'sent';
}

import 'server-only';

export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };
// Off unless the switch is on and a VAPID key pair (base64url, uncompressed P-256 public key and 32-byte private key)
// and a contact (mailto: or https:) are set. See docs/SAAS-WEB-PUSH.md for generating the keys.
export function webPushConfiguration(): WebPushConfig | null {
  const publicKey = process.env.PLATFORM_WEB_PUSH_PUBLIC_KEY || '', privateKey = process.env.PLATFORM_WEB_PUSH_PRIVATE_KEY || '', subject = process.env.PLATFORM_WEB_PUSH_SUBJECT || '';
  if (process.env.PLATFORM_WEB_PUSH_ENABLED !== '1') return null;
  if (Buffer.from(publicKey, 'base64url').length !== 65 || Buffer.from(privateKey, 'base64url').length !== 32 || !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

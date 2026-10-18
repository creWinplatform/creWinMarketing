import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { projectScopeKey } from './catalog';
import type { SmtpConfiguration } from './email-configuration';
import type { SocialConfiguration } from './social-configuration';

export type MetaPublishingGrant = { userAccessToken: string; appId: string };
export type XPublishingGrant = { configurationRevision: string; scopes: string[] };
export type LinkedInOrganizationGrant = { memberSub:string; configurationRevision:string; publishing:boolean };
export type StoredCredentials = { accessToken: string; refreshToken: string; googleOAuth?: boolean; expiresAt?: number; smtp?: SmtpConfiguration; social?: SocialConfiguration; metaPublishing?: MetaPublishingGrant; xPublishing?: XPublishingGrant; linkedinOrganization?:LinkedInOrganizationGrant };
export function encryptCredentials(value: object, key: string, organizationId: string, projectId: string, id: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(projectScopeKey(organizationId, projectId, id)));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: bytes.toString('base64') });
}
export function decryptCredentials<T>(value: string, key: string, organizationId: string, projectId: string, id: string): T {
  const envelope = JSON.parse(value);
  if (envelope.v !== 1) throw new Error('Invalid credential envelope.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(projectScopeKey(organizationId, projectId, id)));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

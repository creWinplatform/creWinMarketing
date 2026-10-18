import 'server-only';
export type SocialConfiguration = { platform: 'linkedin' | 'twitter' | 'facebook' | 'instagram'; accountId: string; accountType?: 'person' | 'organization'; pageId?: string; graphVersion?: string };
export const isLinkedInOrganization = (platform:string,accountId:string,integrationId:string) => platform==='linkedin'&&integrationId===`linkedin:organization:${accountId}`;
export function normalizeSocialConfiguration(raw: unknown): SocialConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Social account required.');
  const value = raw as Record<string, unknown>;
  if (typeof value.platform !== 'string' || !['linkedin', 'twitter', 'facebook', 'instagram'].includes(value.platform) || typeof value.accountId !== 'string') throw new Error('Unsupported social account.');
  const accountId = value.accountId.trim();
  if (!(value.platform !== 'linkedin' ? /^\d{1,30}$/ : /^[a-zA-Z0-9_-]{1,128}$/).test(accountId)) throw new Error('Invalid social account ID.');
  if(value.accountType!==undefined&&(value.platform!=='linkedin'||!['person','organization'].includes(String(value.accountType))))throw new Error('Invalid account type.');
  if(value.accountType==='organization'){
    if(!/^[1-9]\d{0,29}$/.test(accountId))throw new Error('Invalid organization ID.');
    return {platform:'linkedin',accountId,accountType:'organization'};
  }
  if (['facebook', 'instagram'].includes(value.platform)) {
    if (typeof value.graphVersion !== 'string' || !/^v\d{1,3}\.0$/.test(value.graphVersion)) throw new Error('Meta Graph version required.');
    if (value.platform === 'instagram' && (typeof value.pageId !== 'string' || !/^\d{1,30}$/.test(value.pageId))) throw new Error('Linked Facebook page required.');
    return { platform: value.platform as 'facebook' | 'instagram', accountId, graphVersion: value.graphVersion, ...(value.platform === 'instagram' ? { pageId: value.pageId as string } : {}) };
  }
  return { platform: value.platform as SocialConfiguration['platform'], accountId };
}

import 'server-only';
import { createHash } from 'node:crypto';
import { MarketingStoreError } from './errors';
import { ProjectAds, digestOf, adMinorUnit, type AdPlanRow } from './ad-manager';
import { GoogleAdsClient, googleAdsConfigured } from './ad-providers';
import { parseCoachJson, runCoachAi } from './coach-ai';
import type { CoachGenerator } from './coach';

// Two jobs a performance agency does by hand, done with the team's approval:
// 1) Google Search content for a created Search plan: keyword ideas (Keyword Planner), responsive search ad texts (the
//    team writes them or asks the AI), approval of the exact content, a "validate only" check at Google that creates
//    nothing, and — only with PLATFORM_GOOGLE_ADS_CONTENT_ENABLED=1 and the validated content unchanged — the real send.
// 2) A daily budget suggestion from the plan's own figures, applied only by an approver, inside the project's caps,
//    checked by the provider in validate-only mode first; real changes need PLATFORM_ADS_BUDGET_APPLY_ENABLED=1.
// Nothing here starts a plan or raises a budget on its own.
export type MatchType = 'BROAD' | 'PHRASE' | 'EXACT';
export type SearchContent = { keywords: { text: string; match: MatchType }[]; headlines: string[]; descriptions: string[]; finalUrl: string };
export type SearchContentView = SearchContent & { state: 'draft' | 'approved' | 'validated' | 'sent' | 'none'; digest: string | null; approvedAt: string | null; validatedAt: string | null; sentAt: string | null; lastError: string | null; sendEnabled: boolean; googleConfigured: boolean };
export type BudgetSuggestion = { currentMinor: number; suggestedMinor: number; change: 'increase' | 'decrease' | 'keep'; reasons: string[]; capMinor: number | null; applyEnabled: boolean };
const contentSwitch = () => process.env.PLATFORM_GOOGLE_ADS_CONTENT_ENABLED === '1';
const budgetSwitch = () => process.env.PLATFORM_ADS_BUDGET_APPLY_ENABLED === '1';
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1) : '';
const contentDigest = (content: SearchContent) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

// Google's limits: 3–15 headlines of at most 30 characters, 2–4 descriptions of at most 90, keywords of at most 80.
export function normalizeSearchContent(raw: Record<string, unknown>, planUrl: string): SearchContent {
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const keywords = list(raw.keywords).map(item => { const value = item && typeof item === 'object' ? item as Record<string, unknown> : {}; return { text: clean(value.text, 80).toLocaleLowerCase('tr'), match: (['BROAD', 'PHRASE', 'EXACT'].includes(value.match as string) ? value.match : 'PHRASE') as MatchType }; }).filter(item => item.text);
  const headlines = list(raw.headlines).map(item => clean(item, 30)).filter(Boolean), descriptions = list(raw.descriptions).map(item => clean(item, 90)).filter(Boolean);
  if (keywords.length < 1 || keywords.length > 50 || keywords.some(item => item.text.length > 80 || /[!@%^*=<>;\\]/.test(item.text))) throw new MarketingStoreError('1–50 anahtar kelime girin; en çok 80 karakter, ! @ % ^ * = < > ; işaretleri olmadan.');
  if (headlines.length < 3 || headlines.length > 15 || headlines.some(item => item.length > 30)) throw new MarketingStoreError('3–15 başlık girin; her biri en çok 30 karakter.');
  if (descriptions.length < 2 || descriptions.length > 4 || descriptions.some(item => item.length > 90)) throw new MarketingStoreError('2–4 açıklama girin; her biri en çok 90 karakter.');
  if (new Set(headlines.map(item => item.toLocaleLowerCase('tr'))).size !== headlines.length) throw new MarketingStoreError('Başlıklar birbirinden farklı olmalı.');
  const finalUrl = clean(raw.finalUrl, 1000) || planUrl;
  let url: URL, plan: URL; try { url = new URL(finalUrl); plan = new URL(planUrl); } catch { throw new MarketingStoreError('Hedef adres geçerli bir https bağlantısı olmalı.'); }
  if (url.protocol !== 'https:' || url.hostname !== plan.hostname) throw new MarketingStoreError('Hedef adres, planın sitesiyle aynı alan adında bir https bağlantısı olmalı.');
  const seen = new Set<string>();
  return { keywords: keywords.filter(item => { const key = `${item.match}:${item.text}`; if (seen.has(key)) return false; seen.add(key); return true; }), headlines, descriptions, finalUrl: url.href };
}

type ContentRow = { content_json: string; digest: string; state: SearchContentView['state']; approved_by: string | null; approved_at: string | null; validated_digest: string | null; validated_at: string | null; sent_at: string | null; last_error: string | null };
export class AdOptimizer extends ProjectAds {
  private async googlePlan(id: unknown) {
    if (this.provider !== 'google') throw new MarketingStoreError('Arama reklamı içeriği yalnız Google Ads planları için.', 409);
    const row = await this.row(id);
    if (row.objective !== 'OUTCOME_TRAFFIC') throw new MarketingStoreError('Anahtar kelime ve reklam metni yalnız Arama ağı (site trafiği) planları için.', 409);
    return row;
  }
  private async contentRow(planId: string) { return await this.db.prepare('SELECT content_json,digest,state,approved_by,approved_at,validated_digest,validated_at,sent_at,last_error FROM platform_ad_search_content WHERE plan_id=? AND organization_id=? AND project_id=?').get(planId, ...this.args()) as ContentRow | undefined; }
  private async googleClient(row: AdPlanRow) { const { connection, credentials } = await this.credentials(row.connection_id); return { client: this.client(credentials, await this.token(connection, credentials)) as GoogleAdsClient, credentials }; }

  async searchContent(raw: Record<string, unknown>): Promise<SearchContentView> {
    await this.authorize('read');
    const row = await this.googlePlan(raw.id), saved = await this.contentRow(row.id);
    const content: SearchContent = saved ? JSON.parse(saved.content_json) : { keywords: [], headlines: [], descriptions: [], finalUrl: row.link_url };
    return { ...content, state: saved?.state || 'none', digest: saved?.digest || null, approvedAt: saved?.approved_at || null, validatedAt: saved?.validated_digest === saved?.digest ? saved?.validated_at || null : null, sentAt: saved?.sent_at || null, lastError: saved?.last_error || null, sendEnabled: contentSwitch(), googleConfigured: googleAdsConfigured() };
  }
  async keywordIdeas(raw: Record<string, unknown>) {
    await this.authorize('content.write');
    const row = await this.googlePlan(raw.id), seeds = (Array.isArray(raw.seeds) ? raw.seeds : []).map(item => clean(item, 80)).filter(Boolean).slice(0, 10);
    const { client } = await this.googleClient(row), geo = await client.geoTargets(JSON.parse(row.countries_json) as string[]);
    try { return (await client.keywordIdeas(seeds, row.link_url, geo, raw.language === 'en' ? 'en' : 'tr')).sort((a, b) => b.searches - a.searches).slice(0, 40); }
    catch { throw new MarketingStoreError('Google anahtar kelime önerileri alınamadı. Geliştirici anahtarının Basic erişimi olduğundan emin olun.', 502); }
  }
  // AI suggestion for the texts (not saved): uses the AI quota; the team edits and saves what it keeps.
  async draftTexts(raw: Record<string, unknown>, generator?: CoachGenerator) {
    await this.authorize('content.write');
    if (!generator) throw new MarketingStoreError('Bu platform için AI sağlayıcısı yapılandırılmadı.', 503);
    const row = await this.googlePlan(raw.id), project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, language = project.language === 'en' ? 'English' : 'Turkish';
    const keywords = (Array.isArray(raw.keywords) ? raw.keywords : []).map(item => clean(item, 80)).filter(Boolean).slice(0, 20);
    const prompt = `Write Google responsive search ad texts in ${language} for "${project.name}" (${row.link_url}). Brand voice: ${clean(project.brandVoice, 600) || 'clear and helpful'}. Keywords: ${keywords.join(', ') || row.name}.
Return JSON only: {"headlines":[12 strings, each at most 30 characters],"descriptions":[4 strings, each at most 90 characters]}. Use only facts given here; no prices, percentages, guarantees, superlatives like "best", or claims you cannot know. Vary the angles (benefit, feature, call to action).`;
    return await runCoachAi(this.db, this.scope, generator, prompt, output => {
      const value = parseCoachJson(output), headlines = (Array.isArray(value.headlines) ? value.headlines : []).map(item => clean(item, 30)).filter(item => item && item.length <= 30).slice(0, 15), descriptions = (Array.isArray(value.descriptions) ? value.descriptions : []).map(item => clean(item, 90)).filter(item => item && item.length <= 90).slice(0, 4);
      if (headlines.length < 3 || descriptions.length < 2) throw new MarketingStoreError('AI yanıtı kullanılabilir metin içermedi. Tekrar deneyin veya metinleri kendiniz yazın.', 502);
      if (/%|\bgaranti|\ben iyi\b|\bbest\b|\bguarantee/i.test([...headlines, ...descriptions].join(' '))) throw new MarketingStoreError('AI metni içerik kurallarını geçemedi (oran, garanti veya “en iyi” iddiası). Tekrar deneyin.', 422);
      return { headlines, descriptions };
    }, value => value);
  }
  async saveSearchContent(raw: Record<string, unknown>) {
    await this.authorize('content.write');
    const row = await this.googlePlan(raw.id), content = normalizeSearchContent(raw, row.link_url), digest = contentDigest(content), now = new Date().toISOString();
    await this.db.transaction(async () => {
      const saved = await this.contentRow(row.id);
      if (saved?.state === 'sent') throw new MarketingStoreError('Bu içerik Google Ads’e gönderildi; değişiklikleri Google Ads’te yapın.', 409);
      if (raw.expectedDigest !== undefined && raw.expectedDigest !== (saved?.digest || null)) throw new MarketingStoreError('İçerik başka bir sekmede değişti. Yenileyip tekrar deneyin.', 409);
      if (!saved) await this.db.prepare("INSERT INTO platform_ad_search_content(plan_id,organization_id,project_id,content_json,digest,state,updated_by,updated_at) VALUES(?,?,?,?,?,'draft',?,?)").run(row.id, ...this.args(), JSON.stringify(content), digest, this.scope.subject, now);
      else await this.db.prepare("UPDATE platform_ad_search_content SET content_json=?,digest=?,state='draft',approved_by=NULL,approved_at=NULL,last_error=NULL,updated_by=?,updated_at=? WHERE plan_id=? AND organization_id=? AND project_id=?").run(JSON.stringify(content), digest, this.scope.subject, now, row.id, ...this.args());
      await this.audit('ads.search_content.save');
    });
    return await this.searchContent({ id: row.id });
  }
  // The approver approves the exact content (by its digest); any later edit needs a new approval.
  async approveSearchContent(raw: Record<string, unknown>) {
    await this.authorize('campaign.approve');
    const row = await this.googlePlan(raw.id), saved = await this.contentRow(row.id);
    if (!saved || saved.state === 'sent') throw new MarketingStoreError('Onaylanacak taslak yok.', 404);
    if (raw.digest !== saved.digest) throw new MarketingStoreError('İçerik siz bakarken değişti. Yenileyip tekrar onaylayın.', 409);
    await this.db.prepare("UPDATE platform_ad_search_content SET state='approved',approved_by=?,approved_at=? WHERE plan_id=? AND organization_id=? AND project_id=? AND digest=?").run(this.scope.subject, new Date().toISOString(), row.id, ...this.args(), saved.digest);
    await this.audit('ads.search_content.approve');
    return await this.searchContent({ id: row.id });
  }
  private operations(row: AdPlanRow, content: SearchContent, customerId: string) {
    const group = `customers/${customerId}/adGroups/-1`;
    return [
      { adGroupOperation: { create: { resourceName: group, campaign: row.provider_campaign_id, name: `${row.name} · ${new Date().toISOString().slice(0, 10)}`.slice(0, 255), status: 'ENABLED', type: 'SEARCH_STANDARD' } } },
      ...content.keywords.map(keyword => ({ adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: { text: keyword.text, matchType: keyword.match } } } })),
      { adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: { finalUrls: [content.finalUrl], responsiveSearchAd: { headlines: content.headlines.map(text => ({ text })), descriptions: content.descriptions.map(text => ({ text })) } } } } },
    ];
  }
  private async approvedContent(row: AdPlanRow) {
    const saved = await this.contentRow(row.id);
    if (!saved || !['approved', 'validated'].includes(saved.state) || !saved.approved_by || !await this.repo.can(saved.approved_by, ...this.args(), 'campaign.approve')) throw new MarketingStoreError('Önce içeriği onay yetkisi olan bir ekip üyesi onaylamalı.', 409);
    if (!row.provider_campaign_id) throw new MarketingStoreError('Plan önce Google Ads’te oluşturulmalı.', 409);
    return { saved, content: JSON.parse(saved.content_json) as SearchContent };
  }
  // Validate only: Google checks the ad group, keywords and ad and creates nothing. Allowed without the send switch.
  async validateSearchContent(raw: Record<string, unknown>) {
    await this.authorize('content.write');
    const row = await this.googlePlan(raw.id), { saved, content } = await this.approvedContent(row), { client, credentials } = await this.googleClient(row);
    let error: string | null = null;
    try { await client.mutate(this.operations(row, content, credentials.adAccountId), true); }
    catch (reason) { const messages = (reason as { googleErrors?: string[] }).googleErrors || []; error = messages.length ? `Google: ${messages.join(' · ')}`.slice(0, 600) : reason instanceof MarketingStoreError ? reason.message : 'Google doğrulaması yapılamadı.'; }
    const now = new Date().toISOString();
    await this.db.prepare(`UPDATE platform_ad_search_content SET ${error ? "last_error=?" : "state='validated',validated_digest=digest,validated_at=?,last_error=NULL"} WHERE plan_id=? AND organization_id=? AND project_id=? AND digest=?`).run(error || now, row.id, ...this.args(), saved.digest);
    await this.audit(error ? 'ads.search_content.validate_failed' : 'ads.search_content.validate');
    return await this.searchContent({ id: row.id });
  }
  async sendSearchContent(raw: Record<string, unknown>) {
    await this.authorize('manage');
    if (!contentSwitch()) throw new MarketingStoreError('Google Ads’e gönderim bu sunucuda kapalı. Doğrulama yapılabilir; gönderimi sunucu yöneticisi açar.', 409);
    const row = await this.googlePlan(raw.id), { saved, content } = await this.approvedContent(row);
    if (saved.state !== 'validated' || saved.validated_digest !== saved.digest) throw new MarketingStoreError('Önce Google’da doğrulayın; doğrulanan içerik değişmemiş olmalı.', 409);
    const { client, credentials } = await this.googleClient(row);
    let result: Record<string, unknown>;
    try { result = await client.mutate(this.operations(row, content, credentials.adAccountId), false); }
    catch (reason) { const messages = (reason as { googleErrors?: string[] }).googleErrors || []; await this.db.prepare('UPDATE platform_ad_search_content SET last_error=? WHERE plan_id=?').run((messages.length ? `Google: ${messages.join(' · ')}` : 'Gönderim sonucu alınamadı; Google Ads’te reklam grubunu kontrol edin.').slice(0, 600), row.id); await this.audit('ads.search_content.send_failed'); return await this.searchContent({ id: row.id }); }
    const group = ((result.mutateOperationResponses as Record<string, Record<string, unknown>>[] | undefined)?.[0]?.adGroupResult?.resourceName as string | undefined) || null;
    await this.db.prepare("UPDATE platform_ad_search_content SET state='sent',sent_at=?,provider_ad_group=?,last_error=NULL WHERE plan_id=?").run(new Date().toISOString(), group, row.id);
    await this.audit('ads.search_content.send');
    return await this.searchContent({ id: row.id });
  }

  // Budget suggestion from the plan's own figures (spend against budget so far, click-through rate). A hint, not an action.
  async budgetSuggestion(raw: Record<string, unknown>): Promise<BudgetSuggestion> {
    await this.authorize('read');
    const row = await this.row(raw.id), policy = await this.policy(), today = new Date().toISOString().slice(0, 10);
    const days = Math.max(1, Math.floor((Date.parse([today, row.end_date].sort()[0]) - Date.parse(row.start_date)) / 86400000) + 1), budgetSoFar = row.daily_budget_minor * days;
    const ctr = row.impressions && row.clicks !== null ? row.clicks / row.impressions : null, reasons: string[] = [];
    let change: BudgetSuggestion['change'] = 'keep', factor = 1;
    if (row.state !== 'active' || row.spend_minor === null || days < 3) reasons.push('Öneri için plan en az 3 gün yayında olmalı ve harcaması okunmuş olmalı.');
    else if (ctr !== null && (row.impressions || 0) >= 2000 && ctr < 0.005) { change = 'decrease'; factor = 0.8; reasons.push(`Tıklanma oranı düşük (%${(ctr * 100).toFixed(2)}). Bütçeyi azaltıp yeni görsel veya metin deneyin.`); }
    else if (row.spend_minor >= budgetSoFar * 0.9 && ctr !== null && (row.impressions || 0) >= 1000 && ctr >= 0.01) { change = 'increase'; factor = 1.2; reasons.push(`Bütçenin tamamına yakını harcanıyor ve tıklanma oranı iyi (%${(ctr * 100).toFixed(2)}).`); }
    else if (row.spend_minor < budgetSoFar * 0.5) reasons.push('Bütçenin yarısından azı harcanıyor; bütçeyi artırmak sonucu değiştirmez. Hedeflemeyi genişletmeyi değerlendirin.');
    else reasons.push('Rakamlar değişiklik gerektirmiyor.');
    const cap = policy?.daily_cap_minor ?? null, unit = adMinorUnit(row.currency);
    let suggested = Math.round((row.daily_budget_minor * factor) / unit) * unit;
    if (cap !== null && suggested > cap) { suggested = cap; reasons.push('Öneri projenin günlük bütçe tavanına göre sınırlandı.'); }
    if (suggested === row.daily_budget_minor) change = 'keep';
    return { currentMinor: row.daily_budget_minor, suggestedMinor: suggested, change, reasons, capMinor: cap, applyEnabled: budgetSwitch() };
  }
  // Applies a new daily budget: an approver, inside the caps, checked by the provider without changing anything first.
  async applyBudget(raw: Record<string, unknown>) {
    await this.authorize('manage');
    if (!await this.can('campaign.approve')) throw new MarketingStoreError('Bütçeyi yalnız onay yetkisi olan ekip üyeleri değiştirebilir.', 403);
    if (!budgetSwitch()) throw new MarketingStoreError('Bütçe değişikliği bu sunucuda kapalı; öneriyi reklam hesabından uygulayabilirsiniz.', 409);
    if (raw.acknowledged !== true) throw new MarketingStoreError('Bütçe değişikliğini onaylamak için kutuyu işaretleyin.');
    const row = await this.row(raw.id), policy = await this.policy(), next = Number(raw.dailyBudgetMinor);
    if (!Number.isSafeInteger(next) || next <= 0) throw new MarketingStoreError('Geçersiz bütçe.');
    if (policy && next > policy.daily_cap_minor) throw new MarketingStoreError('Yeni bütçe projenin günlük tavanını aşıyor.', 409);
    if (next > row.daily_budget_minor * 1.5) throw new MarketingStoreError('Bütçe tek seferde en çok %50 artırılabilir.', 409);
    if (!['active', 'paused'].includes(row.state) || !row.provider_campaign_id) throw new MarketingStoreError('Yalnız sağlayıcıda oluşturulmuş planların bütçesi değiştirilebilir.', 409);
    const { connection, credentials } = await this.credentials(row.connection_id), token = await this.token(connection, credentials);
    const send = async (validateOnly: boolean) => {
      if (this.provider === 'meta') { if (!row.provider_adset_id) throw new MarketingStoreError('Planın reklam seti bulunamadı.', 409); await this.graph('POST', row.provider_adset_id, token, { daily_budget: String(next), ...(validateOnly ? { execution_options: '["validate_only"]' } : {}) }); return; }
      if (this.provider === 'google') { if (!row.provider_adset_id) throw new MarketingStoreError('Planın Google bütçesi bulunamadı.', 409); await (this.client(credentials, token) as GoogleAdsClient).call('campaignBudgets:mutate', { operations: [{ update: { resourceName: row.provider_adset_id, amountMicros: String(Math.round((next / adMinorUnit(row.currency)) * 1_000_000)) }, updateMask: 'amount_micros' }], validateOnly }); return; }
      throw new MarketingStoreError('Bütçe değişikliği şimdilik Meta ve Google Ads planları için.', 409);
    };
    try { await send(true); } catch (error) { if (error instanceof MarketingStoreError) throw error; throw new MarketingStoreError('Sağlayıcı yeni bütçeyi doğrulamadı; değişiklik yapılmadı.', 502); }
    try { await send(false); } catch (error) { if (error instanceof MarketingStoreError) throw error; await this.audit('ads.plan.budget_failed'); throw new MarketingStoreError('Sağlayıcı bütçe değişikliğini onaylamadı. Reklam hesabından kontrol edin.', 502); }
    // The plan's approved content now carries the new budget, approved by the person who applied it.
    const digest = digestOf({ ...row, daily_budget_minor: next });
    await this.db.prepare('UPDATE platform_ad_plans SET daily_budget_minor=?,digest=?,approved_digest=?,approved_by=?,approved_at=?,revision=revision+1,updated_at=? WHERE id=?').run(next, digest, digest, this.scope.subject, new Date().toISOString(), new Date().toISOString(), row.id);
    await this.audit('ads.plan.budget');
    return await this.budgetSuggestion({ id: row.id });
  }
}

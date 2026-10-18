import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type OAuthRequest = { state_hash: string; organization_id: string; project_id: string; actor_id: string; browser_hash: string; provider: string; resource: string; account_name: string; encrypted_verifier: string; expires_at: string };
export class OAuthRequests {
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string) {}
  private authorize() { new ProjectMarketingStore(this.db, this.scope).connections(); }
  create(provider: string, resource: string, accountName: string, secret: object) {
    this.authorize();
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url'), stateHash = hash(state);
    this.db.transaction(() => {
      this.authorize();
      this.db.prepare('DELETE FROM platform_oauth_requests WHERE expires_at<?').run(new Date().toISOString());
      this.db.prepare('DELETE FROM platform_oauth_requests WHERE actor_id=? AND organization_id=? AND project_id=?').run(this.scope.subject, this.scope.organizationId, this.scope.projectId);
      this.db.prepare('INSERT INTO platform_oauth_requests VALUES(?,?,?,?,?,?,?,?,?,?)').run(stateHash, this.scope.organizationId, this.scope.projectId, this.scope.subject, hash(browser), provider, resource, accountName, encryptCredentials(secret, this.key, this.scope.organizationId, this.scope.projectId, stateHash), new Date(Date.now() + 600000).toISOString());
    })();
    return { state, browser };
  }
  get(state: string, browser: string, allowedProviders: string[]) {
    this.authorize();
    if (!/^[a-zA-Z0-9_-]{43}$/.test(state) || !/^[a-zA-Z0-9_-]{43}$/.test(browser)) throw new MarketingStoreError('Yetkilendirme isteği geçersiz.', 403);
    const row = this.db.prepare('SELECT * FROM platform_oauth_requests WHERE state_hash=?').get(hash(state)) as OAuthRequest | undefined;
      if (!row || !row.encrypted_verifier || !allowedProviders.includes(row.provider) || row.expires_at < new Date().toISOString() || row.actor_id !== this.scope.subject || row.organization_id !== this.scope.organizationId || row.project_id !== this.scope.projectId || row.browser_hash !== hash(browser)) throw new MarketingStoreError('Yetkilendirme isteği geçersiz veya süresi dolmuş.', 403);
    return row;
  }
  claim(state: string, browser: string, allowedProviders: string[]) {
    return this.db.transaction(() => {
      const row = this.get(state, browser, allowedProviders);
      this.db.prepare("UPDATE platform_oauth_requests SET encrypted_verifier='' WHERE state_hash=?").run(row.state_hash);
      return row;
    })();
  }
  replaceSecret(request: OAuthRequest, secret: object) {
    this.authorize();
    const result = this.db.prepare('UPDATE platform_oauth_requests SET encrypted_verifier=? WHERE state_hash=? AND encrypted_verifier=? AND expires_at>?').run(encryptCredentials(secret, this.key, this.scope.organizationId, this.scope.projectId, request.state_hash), request.state_hash, request.encrypted_verifier, new Date().toISOString());
    if (!result.changes) throw new MarketingStoreError('Yetkilendirme isteği değişti. Yeniden başlayın.', 409);
  }
  secret<T>(request: OAuthRequest): T {
    return decryptCredentials<T>(request.encrypted_verifier, this.key, this.scope.organizationId, this.scope.projectId, request.state_hash);
  }
  finish<T>(request: OAuthRequest, save: () => T) {
    return this.db.transaction(() => {
      this.authorize();
      if (!this.db.prepare("SELECT state_hash FROM platform_oauth_requests WHERE state_hash=? AND encrypted_verifier='' AND expires_at>?").get(request.state_hash, new Date().toISOString())) throw new MarketingStoreError('Yetkilendirme isteği iptal edildi.', 409);
      this.db.prepare('DELETE FROM platform_oauth_requests WHERE state_hash=?').run(request.state_hash);
      return save();
    })();
  }
  discard(request: OAuthRequest) { this.db.prepare('DELETE FROM platform_oauth_requests WHERE state_hash=?').run(request.state_hash); }
}

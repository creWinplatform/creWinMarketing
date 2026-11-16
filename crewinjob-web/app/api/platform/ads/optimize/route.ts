import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { AdOptimizer } from '@/lib/platform/ad-optimizer';
import { coachBody,coachGemini,coachRoute } from '../../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Google search content (keywords and responsive search ads) and daily budget suggestions for an ad plan.
// Sending content and changing budgets stay off unless the server switches them on; validation never changes anything.
export const POST=coachRoute(async(scope,request)=>{
  const raw=await coachBody(request),provider=raw.provider==='google'?'google':'meta';
  const ads=new AdOptimizer(platformDatabase(),scope,credentialEncryptionKey(),undefined,provider);
  switch(raw.action){
    case 'search-content':return ads.searchContent(raw);
    case 'keyword-ideas':return {ideas:await ads.keywordIdeas(raw)};
    case 'draft-texts':return ads.draftTexts(raw,coachGemini(2500));
    case 'save-content':return ads.saveSearchContent(raw);
    case 'approve-content':return ads.approveSearchContent(raw);
    case 'validate-content':return ads.validateSearchContent(raw);
    case 'send-content':return ads.sendSearchContent(raw);
    case 'budget':return ads.budgetSuggestion(raw);
    case 'apply-budget':return ads.applyBudget(raw);
  }
  throw new MarketingStoreError('Geçersiz reklam işlemi.');
});

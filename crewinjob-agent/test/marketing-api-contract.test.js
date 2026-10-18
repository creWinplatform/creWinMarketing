const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CREWINJOB_API_URL = 'https://api.example.test';
process.env.CREWINJOB_API_KEY = 'test-token';

const api = require('../modules/api.js');

test('marketing adapters preserve service path, auth and dispatch payload', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { id: 'result-1' } }),
    };
  };

  try {
    const dispatch = {
      campaignId: 'campaign-1',
      audienceId: 'audience-1',
      channel: 'email',
      templateId: 'template-1',
      campaignIntegrationId: 'pilot-test-email',
      maxRecipients: 5,
      idempotencyKey: 'dispatch-1',
    };
    await api.marketingCampaignPost('Dispatch', dispatch);
    await api.marketingTemplateGet('GetAll', { channel: 'email', isActive: true });
    await api.marketingIntegrationGet('GetAll', { channel: 'email', activeOnly: true });
    await api.marketingCampaignV2Get('GetAll', { skipCount: 0, maxResultCount: 20 });
    await api.marketingCampaignV2Post('CreateOrUpdate', { name: 'Multi channel', channels: [] });
    await api.growthAnalyticsPublicPost('ProcessUnsubscribe', { token: 'opaque-token', channel: 'email', reason: 'user_request' });

    assert.equal(calls.length, 6);
    assert.equal(new URL(calls[0].url).pathname, '/api/services/app/MarketingCampaign/Dispatch');
    assert.deepEqual(JSON.parse(calls[0].options.body), dispatch);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(new URL(calls[1].url).pathname, '/api/services/app/MarketingTemplate/GetAll');
    assert.equal(new URL(calls[1].url).searchParams.get('channel'), 'email');
    assert.equal(new URL(calls[2].url).pathname, '/api/services/app/MarketingIntegration/GetAll');
    assert.equal(new URL(calls[3].url).pathname, '/api/services/app/MarketingCampaignV2/GetAll');
    assert.equal(new URL(calls[4].url).pathname, '/api/services/app/MarketingCampaignV2/CreateOrUpdate');
    assert.equal(new URL(calls[5].url).pathname, '/api/services/app/GrowthAnalytics/ProcessUnsubscribe');
    assert.equal(calls[5].options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[5].options.body), { token: 'opaque-token', channel: 'email', reason: 'user_request' });
  } finally {
    global.fetch = originalFetch;
  }
});

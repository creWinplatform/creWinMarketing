const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Owner decisions (22 Oct 2026): no unsolicited DMs, group joining only after a person picks the groups,
// and every job collected from Telegram goes to the review queue. Tests use a temporary data folder.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewin-agent-decisions-'));
process.env.CREWINJOB_AGENT_DATA_DIR = dataDir;
const agentConfigPath = require.resolve('../modules/agent-config.js');
require.cache[agentConfigPath] = { id: agentConfigPath, filename: agentConfigPath, loaded: true, exports: { ...require(agentConfigPath), loadAgentConfig: () => {} } };
const discovery = require('../modules/group-discovery.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const chats = [
  { id: 101n, title: 'Seafarer Jobs', username: 'seafarerjobs', participantsCount: 2400, megagroup: true },
  { id: 102n, title: 'Tanker Crew', participantsCount: 900, className: 'Channel' },
  { id: 103n, title: 'Tiny group', participantsCount: 40, megagroup: true },
  { id: 104n, title: 'Bulk Carrier Crew', participantsCount: 5000, megagroup: true },
];

test('search results become suggestions only; nothing is joined', () => {
  const found = discovery.recordSuggestions(chats, 'seafarer jobs');
  assert.deepEqual(found.map(g => g.id), ['101', '102', '104'], 'groups under 100 members are skipped');
  assert.ok(found.every(g => g.joined === false));
  assert.equal(discovery.recordSuggestions(chats, 'again').length, 0, 'the same group is suggested once');
  assert.deepEqual(discovery.listSuggestions().map(g => g.id), ['104', '101', '102'], 'largest first');
});

test('joining needs an explicit pick of 1-10 groups and skips removed or unknown ones', async () => {
  const joined = [];
  const join = async target => { joined.push(target); return true; };
  await assert.rejects(discovery.joinSelectedGroups([], join), /en az bir grup/);
  await assert.rejects(discovery.joinSelectedGroups(Array.from({ length: 11 }, (_, i) => String(200 + i)), join), /en fazla 10/);
  assert.equal(discovery.dismissSuggestions(['102']), 1);
  const result = await discovery.joinSelectedGroups(['101', '102', '999', 'not-an-id'], join);
  assert.deepEqual(joined, ['@seafarerjobs'], 'only the picked, still-suggested group is joined');
  assert.deepEqual(result, { joined: 1, skipped: 2 });
  assert.deepEqual(discovery.listSuggestions().map(g => g.id), ['104'], 'joined and removed groups leave the list');
});

test('the userbot sends no DMs and its daily search never joins a group', () => {
  const source = read('userbot.js');
  assert.doesNotMatch(source, /sendMessage\s*\(/, 'no message is sent to people');
  assert.doesNotMatch(source, /dmText|DM_DAILY_LIMIT|isSeekingJob/);
  const search = source.slice(source.indexOf('async function searchGroupSuggestions'), source.indexOf('// ── Özellik 3'));
  assert.match(search, /recordSuggestions/);
  assert.doesNotMatch(search, /JoinChannel/, 'the search only records suggestions');
  // The only join left is for channels the operator listed in TG_CHANNELS.
  assert.equal((source.match(/JoinChannel/g) || []).length, 1);
  assert.match(source.slice(source.indexOf('async function joinTargetChannels')), /TARGET_CHANNELS/);
});

test('no welcome DMs to new group members: the module and the CLI action are gone', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'modules', 'member-onboarding.js')), false);
  assert.doesNotMatch(read('job-bot-cli.js'), /onboard_members|onboardNewMembers/);
});

test('the scheduler and pipeline.js discover groups but never join them', () => {
  for (const file of ['modules/pipeline-scheduler.js', 'pipeline.js']) {
    const source = read(file);
    assert.match(source, /discoverGroups/);
    assert.doesNotMatch(source, /joinSelectedGroups|joinDiscoveredGroups|JoinChannel|joinGroup\(/, file);
  }
});

test('every collected job goes to the review queue, whatever the saved settings say', () => {
  const { withMandatoryReview } = require('../modules/auto-poster.js');
  assert.equal(withMandatoryReview({ reviewAllItems: false, autoApproveThreshold: 70 }).reviewAllItems, true);
  assert.equal(withMandatoryReview(null).reviewAllItems, true);
  assert.equal(withMandatoryReview({ alertQueueSize: 30 }).alertQueueSize, 30, 'other settings are kept');
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

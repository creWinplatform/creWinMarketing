const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/platform/catalog.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const catalogExports = {};
vm.runInNewContext(output, { exports: catalogExports, structuredClone });
const { MODULES, legacyWorkspace, modulesForProject, projectScopeKey } = catalogExports;

test('Crewin preserves every legacy tab plus project settings', () => {
  const legacyIds = ['dashboard', 'social', 'library', 'growth', 'retention', 'seo', 'ads', 'campaigns', 'messaging', 'telegrambot', 'jobbot', 'pipeline', 'analytics', 'kpi', 'calendar', 'firma_kredi'];
  const context = legacyWorkspace();
  assert.deepEqual(Array.from(context.modules, module => module.id), [...legacyIds, 'project']);
  assert.equal(new Set(MODULES.map(module => module.id)).size, MODULES.length);
});

test('standard product cannot enable Crewin tools even when requested', () => {
  const modules = modulesForProject('standard', MODULES.map(module => module.id));
  assert.ok(modules.length > 0);
  assert.ok(modules.every(module => module.scope === 'shared'));
  assert.equal(modules.some(module => module.id === 'firma_kredi'), false);
  assert.equal(modulesForProject('standard', ['unknown']).length, 0);
});

test('workspace profile mutations do not change later requests', () => {
  const context = legacyWorkspace();
  context.project.enabledModules.length = 0;
  context.project.goals[0].stages.length = 0;
  assert.equal(legacyWorkspace().project.enabledModules.length, MODULES.length-1);
  assert.ok(legacyWorkspace().project.goals[0].stages.length > 0);
});

test('scope keys require all identifiers and do not collide at separators', () => {
  assert.throws(() => projectScopeKey('', 'project', 'cache'));
  assert.throws(() => projectScopeKey('org', ' ', 'cache'));
  assert.notEqual(projectScopeKey('a:b', 'c', 'd'), projectScopeKey('a', 'b:c', 'd'));
  assert.notEqual(projectScopeKey('org-a', 'p', 'token'), projectScopeKey('org-b', 'p', 'token'));
});

test('public context contains no integration credential configuration', () => {
  const serialized = JSON.stringify(legacyWorkspace());
  assert.doesNotMatch(serialized, /accessToken|refreshToken|password|private_key|apiKey|Abp\.TenantId/);
});

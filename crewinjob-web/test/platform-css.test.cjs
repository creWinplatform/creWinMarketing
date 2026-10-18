const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

test('maintained CSS compiler retains shared and legacy Crewin utility contracts', { timeout: 60000 }, async () => {
  const from = path.join(__dirname, '../app/globals.css');
  const css = await readFile(from, 'utf8');
  const result = await postcss([tailwind({ optimize: false })]).process(css + '\n@source inline("bg-ocean bg-navy flex-shrink-0 max-w-screen-2xl shadow-sm lg:hidden dark:bg-slate-800");', { from });
  const selectors = [];
  result.root.walkRules(rule => selectors.push(rule.selector));
  for (const name of ['.bg-ocean','.bg-navy','.flex-shrink-0','.max-w-screen-2xl','.shadow-sm','.lg\\:hidden','.dark\\:bg-slate-800']) assert.ok(selectors.some(selector => selector.includes(name)),name);
  assert.doesNotMatch(result.css, /@apply\s/);
  assert.match(result.css, /1536px/);
  assert.ok(result.css.includes('.dark'));
  assert.ok(result.css.includes('.workspace-mobile-drawer'));
  assert.ok(result.css.includes('.page-section'));
});

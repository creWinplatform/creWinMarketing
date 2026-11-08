// One-off codemod for the SQL Server move: the tests call platform functions that are async now.
//   node scripts/codemod-async-tests.cjs [test/file.test.cjs …]
// 1. Names of functions and methods that are async now but were not in HEAD (lib/ and app/).
// 2. In each test file, every call of such a name gets `await`; its function becomes async.
//    assert.throws(() => call(…)) becomes await assert.rejects(async () => call(…)).
//    Functions inside the test file that become async are added to the names, until nothing changes.
// Array callbacks that become async (items.map(async …)) are listed for a manual fix.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
// Names shared with synchronous APIs the tests also use (better-sqlite3, Map, arrays, fs, assert).
const GENERIC = new Set(['get', 'all', 'run', 'prepare', 'exec', 'map', 'filter', 'find', 'some', 'every', 'forEach', 'reduce', 'has', 'set', 'delete', 'add', 'keys', 'values', 'entries', 'push', 'join', 'close', 'toString', 'then', 'catch', 'finally', 'call', 'apply', 'bind', 'transaction', 'write', 'parse', 'stringify', 'test', 'load', 'equal', 'ok',
  // Methods of Node and web objects (hash.update(), response.json(), …).
  'update', 'digest', 'from', 'json', 'text', 'end', 'slice', 'split', 'replace', 'includes', 'sort', 'concat', 'match']);
// Short names the tests also use for their own synchronous helpers: skipped when called bare (open(…)), awaited as
// methods (service.open(…)) or once the test file's own helper of that name became async.
const LOCAL = new Set(['open', 'one', 'input', 'count', 'check', 'step', 'normalize', 'origin', 'lang', 'limit', 'describe', 'select', 'insert', 'update', 'execute', 'store', 'row', 'rows', 'result', 'results', 'state', 'scope', 'target', 'token', 'user', 'version', 'items', 'request', 'queue', 'source', 'sources', 'today', 'month', 'period', 'current', 'fresh', 'valid', 'signature', 'start', 'stop', 'remove', 'reset', 'record', 'records', 'event', 'events', 'post', 'posts', 'job', 'email', 'contact', 'contacts', 'app', 'apps', 'plan', 'project', 'context', 'derive', 'compute', 'evaluate', 'fail', 'skip', 'keep', 'mapping', 'metrics', 'proof', 'selected', 'selection', 'target', 'used', 'visible', 'weekly', 'worker', 'act', 'action', 'actions', 'allow', 'allowed', 'block', 'blocked', 'changed', 'commit', 'complete', 'create', 'currency', 'due', 'history', 'hook', 'live', 'manager', 'meta', 'pilot', 'policy', 'profile', 'queries', 'ready', 'register', 'release', 'remember', 'renew', 'reopen', 'reply', 'report', 'retry', 'review', 'revoke', 'role', 'running', 'save', 'schedule', 'send', 'settle', 'setup', 'share', 'snapshot', 'subscribe', 'subscription', 'suggest', 'summary', 'suppress', 'track', 'unsubscribe', 'verify', 'view']);
const SYNC_RECEIVER = /(^|\.)(db|handle|copy|real|raw|sqlite|statement|stmt|\w*map|\w*set|seen|cache|headers|searchParams|params|url|hash|hmac|body|response|res|Buffer|Math|Date|Array|Object|JSON|fs|path|crypto|assert|process|console|calls|sent|stubs)$/i;
// Shared test modules: never rewritten (their callers would not know).
const SHARED = new Set(['platform-loader.cjs', 'db-client.test.cjs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}
const isFn = n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
const isAsync = n => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Async) !== 0;
function fnName(n) {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent) {
    if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
    if (ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
    // f.bind = async (…) => …: a helper stored on the fixture object.
    if (ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.parent.right === n && ts.isPropertyAccessExpression(n.parent.left)) return n.parent.left.name.text;
  }
  return null;
}
function asyncNames(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Map();
  (function visit(n) { if (isFn(n)) { const name = fnName(n); if (name) names.set(name, (names.get(name) || 0) + (isAsync(n) ? 1 : 0)); } ts.forEachChild(n, visit); })(sf);
  return names;
}
// 1.
const asyncNow = new Set(), asyncGeneric = new Set();
for (const file of [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))]) {
  const now = asyncNames(fs.readFileSync(file, 'utf8'), file);
  let head = new Map();
  try { head = asyncNames(execFileSync('git', ['show', `HEAD:./${path.relative(ROOT, file).replace(/\\/g, '/')}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }), file); } catch { /* new file */ }
  for (const [name, count] of now) if (count > (head.get(name) || 0)) (GENERIC.has(name) ? asyncGeneric : asyncNow).add(name);
}
console.log(`${asyncNow.size} async name(s) from lib/ and app/`);
if (process.argv.includes('--names')) { console.log([...asyncNow].sort().join(' ')); process.exit(0); }

// 2.
const files = process.argv.slice(2).length ? process.argv.slice(2).map(f => path.resolve(f)) : fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.cjs')).map(f => path.join(ROOT, 'test', f));
// Shared fixtures first: helpers they make async are awaited in every test file.
files.sort((a, b) => Number(!/-fixture.cjs$/.test(a)) - Number(!/-fixture.cjs$/.test(b)));
const manual = [];
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  if (SHARED.has(path.basename(file))) continue;
  const names = new Set(asyncNow), localAsync = new Set();
  // Helpers this file already made async on an earlier run (async now, not in HEAD).
  {
    let head = '';
    try { head = execFileSync('git', ['show', `HEAD:./${path.relative(ROOT, file).replace(/\\/g, '/')}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { /* new file */ }
    const before = head ? asyncNames(head, file) : new Map(), after = asyncNames(text, file);
    for (const [name, count] of after) if (count > (before.get(name) || 0)) { localAsync.add(name); names.add(name); }
  }
  // Functions the test file declares itself: a bare call of one is awaited only once that function became async.
  const declaredHere = new Set();
  (function collect(n) { if (isFn(n)) { const name = fnName(n); if (name) declaredHere.add(name); } ts.forEachChild(n, collect); })(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  let total = 0;
  for (let round = 0; round < 12; round++) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edits = [];
    // Two "(await " at one position are both needed for nested calls: no de-duplication here.
    const add = (pos, end, value) => edits.push({ pos, end, value });
    const madeAsync = new Set();
    const enclosing = n => { let p = n.parent; while (p && !isFn(p)) p = p.parent; return p; };
    const makeAsync = fn => {
      if (!fn || isAsync(fn) || madeAsync.has(fn)) return;
      madeAsync.add(fn);
      const at = ts.isArrowFunction(fn) ? fn.getStart() : ts.isMethodDeclaration(fn) ? fn.name.getStart() : fn.getChildren().find(c => c.kind === ts.SyntaxKind.FunctionKeyword).getStart();
      add(at, at, 'async ');
      const name = fnName(fn); if (name) { names.add(name); localAsync.add(name); }
      const call = fn.parent;
      if (ts.isCallExpression(call) && call.arguments[0] === fn && ts.isPropertyAccessExpression(call.expression)) {
        const method = call.expression.name.text, target = call.expression.expression.getText();
        if (target === 'assert' && method === 'throws') {
          add(call.expression.getStart(), call.expression.getEnd(), 'assert.rejects');
          if (!ts.isAwaitExpression(call.parent)) add(call.getStart(), call.getStart(), 'await ');
          makeAsync(enclosing(call));
        } else if (target === 'assert' && method === 'doesNotThrow') {
          add(call.expression.getStart(), call.expression.getEnd(), 'assert.doesNotReject');
          if (!ts.isAwaitExpression(call.parent)) add(call.getStart(), call.getStart(), 'await ');
          makeAsync(enclosing(call));
        } else if (['map', 'filter', 'forEach', 'some', 'every', 'find', 'flatMap', 'reduce'].includes(method)) {
          manual.push(`${path.relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(call.getStart()).line + 1} ${method}(async …)`);
        }
      }
    };
    // Promises the test already handles on purpose: the argument of assert.rejects, and a variable awaited later
    // (const first = service.create(…); … await first).
    const awaitedLater = new Set();
    (function collect(n) { if (ts.isAwaitExpression(n) && ts.isIdentifier(n.expression)) awaitedLater.add(n.expression.text); ts.forEachChild(n, collect); })(sf);
    const handled = n => {
      const p = n.parent;
      if (ts.isCallExpression(p) && p.arguments[0] === n && ts.isPropertyAccessExpression(p.expression) && p.expression.expression.getText() === 'assert' && ['rejects', 'doesNotReject'].includes(p.expression.name.text)) return true;
      if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name) && awaitedLater.has(p.name.text)) return true;
      return false;
    };
    (function visit(n) {
      if (ts.isCallExpression(n) && !ts.isAwaitExpression(n.parent) && !handled(n)) {
        const callee = n.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
        // Not the assert helpers themselves, not `load(...)`.
        const owner = ts.isPropertyAccessExpression(callee) ? callee.expression.getText() : '';
        // A generic name (service.get(), service.save()) is awaited as a method, except on objects that are synchronous here:
        // the better-sqlite3 handle and its statements, Maps and Sets, Node and web helpers.
        const syncReceiver = ts.isPropertyAccessExpression(callee) && (SYNC_RECEIVER.test(owner) || /\.prepare\(|createHmac\(|createHash\(|^new (Map|Set|URL|Headers)\b|^\[/.test(owner));
        const generic = ts.isPropertyAccessExpression(callee) && asyncGeneric.has(name) && !syncReceiver;
        if (name && (names.has(name) || generic || localAsync.has(name)) && (!(ts.isIdentifier(callee) && (LOCAL.has(name) || declaredHere.has(name))) || localAsync.has(name)) && owner !== 'assert' && owner !== 'fs' && owner !== 'JSON' && owner !== 'Object') {
          const parent = n.parent;
          const parens = (ts.isPropertyAccessExpression(parent) && parent.expression === n) || (ts.isElementAccessExpression(parent) && parent.expression === n) || (ts.isCallExpression(parent) && parent.expression === n);
          if (parens) { add(n.getStart(), n.getStart(), '(await '); add(n.getEnd(), n.getEnd(), ')'); } else add(n.getStart(), n.getStart(), 'await ');
          makeAsync(enclosing(n));
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
    if (!edits.length) break;
    total += edits.length;
    edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.pos - a.pos || b.end - a.end || b.i - a.i).forEach(e => { text = text.slice(0, e.pos) + e.value + text.slice(e.end); });
  }
  if (/-fixture.cjs$/.test(file)) for (const name of localAsync) asyncNow.add(name);
  if (total) { fs.writeFileSync(file, text); console.log(`${path.relative(ROOT, file)}: ${total} edit(s)`); }
}
if (manual.length) console.log(`\nManual (async array callbacks):\n  ${[...new Set(manual)].join('\n  ')}`);

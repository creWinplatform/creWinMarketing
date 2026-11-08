// One-off codemod for the SQL Server move: turns the synchronous better-sqlite3 calls in lib/ and app/ into the
// async Db interface (lib/db/client.ts) and makes every caller await them.
//   node scripts/codemod-async-db.cjs            rewrite the files in place (git shows the diff)
//   node scripts/codemod-async-db.cjs --dry      report only
// Steps:
//   1. Statements: X.prepare(s).get/all/run(…) and stored statements' .get/.all/.run(…) get `await`.
//      Transactions: X.transaction(fn)() and X.transaction(fn).immediate() become `await X.transaction(async fn)`.
//   2. Every function that now contains an `await` becomes async (an explicit return type T becomes Promise<T>).
//   3. With the type checker: every call to a function made async in step 2 gets `await`, and its own function becomes
//      async, until nothing changes.
//   4. Types: Database.Database → Db.
// Places it cannot rewrite safely are listed for a manual fix (getters, constructors, type predicates, functions passed
// as values, async callbacks given to array methods).
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const SKIP = new Set(['lib/db/client.ts', 'lib/platform/database.ts']);
const rel = file => path.relative(ROOT, file).replace(/\\/g, '/');

function sourceFiles() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !SKIP.has(rel(full))) out.push(full);
    }
  };
  walk(path.join(ROOT, 'lib')); walk(path.join(ROOT, 'app'));
  return out;
}

const report = { getters: [], constructors: [], predicates: [], callbacks: [], values: [], transactionArgs: [] };
const where = node => { const sf = node.getSourceFile(); return `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`; };

// ---------- edits ----------
class Edits {
  constructor() { this.byFile = new Map(); }
  add(file, pos, end, text) {
    if (!this.byFile.has(file)) this.byFile.set(file, []);
    const list = this.byFile.get(file);
    if (!list.some(e => e.pos === pos && e.end === end && e.text === text)) list.push({ pos, end, text });
  }
  apply() {
    let changed = 0;
    for (const [file, list] of this.byFile) {
      let text = fs.readFileSync(file, 'utf8');
      // Later positions first; at the same position, keep insertion order stable.
      list.map((e, i) => ({ ...e, i })).sort((a, b) => b.pos - a.pos || b.end - a.end || b.i - a.i).forEach(e => { text = text.slice(0, e.pos) + e.text + text.slice(e.end); });
      if (!dry) fs.writeFileSync(file, text);
      changed++;
    }
    return changed;
  }
}

const isFunctionLike = node => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
const enclosingFunction = node => { let n = node.parent; while (n && !isFunctionLike(n)) n = n.parent; return n; };
const isAsync = fn => (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0;

// await before a call; parentheses when the result is used as an object or callee.
function awaitExpression(edits, node) {
  const file = node.getSourceFile().fileName, parent = node.parent;
  if (ts.isAwaitExpression(parent)) return false;
  const needsParens = (ts.isPropertyAccessExpression(parent) && parent.expression === node) || (ts.isElementAccessExpression(parent) && parent.expression === node)
    || (ts.isCallExpression(parent) && parent.expression === node) || ts.isNonNullExpression(parent) || (ts.isTaggedTemplateExpression(parent));
  if (needsParens) { edits.add(file, node.getStart(), node.getStart(), '(await '); edits.add(file, node.getEnd(), node.getEnd(), ')'); }
  else edits.add(file, node.getStart(), node.getStart(), 'await ');
  return true;
}

// Function identity that survives edits: file + enclosing class/variable names + function name.
function functionKey(fn) {
  if (!fn) return null;
  const names = [];
  for (let n = fn; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n) || ts.isGetAccessorDeclaration(n)) && n.name) names.unshift(n.name.getText());
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && n.initializer === (names.length ? n.initializer : fn)) names.unshift(n.name.text);
    else if (ts.isPropertyAssignment(n) && n.name && (n.initializer === fn)) names.unshift(n.name.getText());
  }
  // Anonymous callbacks are identified by position (stable within one pass only).
  if (!names.length || (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && !(ts.isVariableDeclaration(fn.parent) || ts.isPropertyAssignment(fn.parent))) return null;
  return `${rel(fn.getSourceFile().fileName)}#${names.join('.')}`;
}

function makeAsync(edits, fn, asyncKeys) {
  if (!fn || isAsync(fn)) return;
  const file = fn.getSourceFile().fileName;
  if (ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) { report.getters.push(where(fn)); return; }
  if (ts.isConstructorDeclaration(fn)) { report.constructors.push(where(fn)); return; }
  if (fn.type && ts.isTypePredicateNode(fn.type)) { report.predicates.push(where(fn)); return; }
  let at;
  if (ts.isMethodDeclaration(fn)) at = fn.name.getStart();
  else if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) at = fn.getChildren().find(c => c.kind === ts.SyntaxKind.FunctionKeyword).getStart();
  else at = fn.getStart();
  edits.add(file, at, at, 'async ');
  if (fn.type && !/^Promise</.test(fn.type.getText())) edits.add(file, fn.type.getStart(), fn.type.getEnd(), `Promise<${fn.type.getText()}>`);
  const key = functionKey(fn);
  if (key) asyncKeys.add(key);
  // A callback handed to another function: its caller now gets a promise.
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn)) {
    const callee = fn.parent.expression, name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
    if (name !== 'transaction') report.callbacks.push(`${where(fn)} ${name}(async …)`);
  }
}

// ---------- step 1 ----------
function statementPass(program, edits, asyncKeys) {
  for (const sf of program.getSourceFiles()) {
    if (!sourceFiles.set.has(path.resolve(sf.fileName))) continue;
    // Identifiers that hold a prepared statement: const x = <expr>.prepare(...)
    const stored = new Set();
    (function collect(n) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isPrepare(n.initializer)) stored.add(n.name.text);
      ts.forEachChild(n, collect);
    })(sf);
    (function visit(n) {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        // Transactions: X.transaction(fn)() / X.transaction(fn).immediate()
        const tx = transactionInvocation(n);
        if (tx) {
          const [work] = tx.call.arguments;
          if (n.arguments.length) report.transactionArgs.push(where(n));
          // Drop the trailing "()" or ".immediate()".
          edits.add(sf.fileName, tx.call.getEnd(), n.getEnd(), '');
          if (work && (ts.isArrowFunction(work) || ts.isFunctionExpression(work)) && !isAsync(work)) {
            const at = ts.isArrowFunction(work) ? work.getStart() : work.getChildren().find(c => c.kind === ts.SyntaxKind.FunctionKeyword).getStart();
            edits.add(sf.fileName, at, at, 'async ');
          }
          // await goes before the transaction call, parenthesised by the use of the whole invocation.
          const parent = n.parent;
          const needsParens = (ts.isPropertyAccessExpression(parent) && parent.expression === n) || (ts.isElementAccessExpression(parent) && parent.expression === n) || ts.isNonNullExpression(parent);
          if (!ts.isAwaitExpression(parent)) {
            if (needsParens) { edits.add(sf.fileName, tx.call.getStart(), tx.call.getStart(), '(await '); edits.add(sf.fileName, n.getEnd(), n.getEnd(), ')'); }
            else edits.add(sf.fileName, tx.call.getStart(), tx.call.getStart(), 'await ');
          }
          makeAsync(edits, enclosingFunction(n), asyncKeys);
        } else if (ts.isPropertyAccessExpression(callee) && ['get', 'all', 'run'].includes(callee.name.text)
          && (isPrepare(callee.expression) || (ts.isIdentifier(callee.expression) && stored.has(callee.expression.text)))) {
          if (awaitExpression(edits, n)) makeAsync(edits, enclosingFunction(n), asyncKeys);
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
}
function isPrepare(node) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'prepare';
}
function transactionInvocation(n) {
  // X.transaction(fn)()
  if (ts.isCallExpression(n.expression) && isTransaction(n.expression)) return { call: n.expression };
  // X.transaction(fn).immediate()
  if (ts.isPropertyAccessExpression(n.expression) && ['immediate', 'deferred', 'exclusive'].includes(n.expression.name.text) && ts.isCallExpression(n.expression.expression) && isTransaction(n.expression.expression)) return { call: n.expression.expression };
  return null;
}
function isTransaction(node) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'transaction' && node.arguments.length === 1;
}

// ---------- step 3 ----------
function propagationPass(program, edits, asyncKeys) {
  const checker = program.getTypeChecker();
  let added = 0;
  for (const sf of program.getSourceFiles()) {
    if (!sourceFiles.set.has(path.resolve(sf.fileName))) continue;
    (function visit(n) {
      if (ts.isCallExpression(n)) {
        const declaration = checker.getResolvedSignature(n)?.declaration;
        const key = declaration && isFunctionLike(declaration) ? functionKey(declaration) : null;
        if (key && asyncKeys.has(key) && !ts.isAwaitExpression(n.parent)) {
          if (awaitExpression(edits, n)) { added++; makeAsync(edits, enclosingFunction(n), asyncKeys); }
        }
      } else if ((ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && !ts.isCallExpression(n.parent) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
        // A function made async passed or stored as a value.
        const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n) ? n.name : n);
        const declaration = symbol?.valueDeclaration;
        const key = declaration && isFunctionLike(declaration) ? functionKey(declaration) : null;
        if (key && asyncKeys.has(key) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) && !isDeclarationName(n)) report.values.push(`${where(n)} ${n.getText()}`);
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return added;
}
// ---------- the committed (HEAD) version, to tell the codemod's async from code that was already async ----------
const { execFileSync } = require('node:child_process');
const headCache = new Map();
function headInfo(file) {
  if (headCache.has(file)) return headCache.get(file);
  let text = '';
  try { text = execFileSync('git', ['show', `HEAD:./${rel(file)}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { /* new file */ }
  const info = { asyncKeys: new Set(), callbacks: new Set() };
  if (text) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    (function visit(n) {
      if (isFunctionLike(n) && isAsync(n)) { const key = functionKey(n, true); if (key) info.asyncKeys.add(key); }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments.length && (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0])) && isAsync(n.arguments[0])) info.callbacks.add(callbackSignature(n));
      ts.forEachChild(n, visit);
    })(sf);
  }
  headCache.set(file, info);
  return info;
}
// "receiver.method(async (params)" with awaits and whitespace removed: the same callback in HEAD and now.
function callbackSignature(call) {
  const fn = call.arguments[0];
  const params = fn.parameters.map(p => p.getText()).join(',');
  return `${call.expression.expression.getText()}.${call.expression.name.text}(${params})`.replace(/\(await /g, '(').replace(/\bawait /g, '').replace(/\s+/g, '');
}
const headAsyncCallback = (file, call) => headInfo(file).callbacks.has(callbackSignature(call));

// ---------- async callbacks given to array methods ----------
// items.map(async …) → await mapSeries(items, async …), and so on: one item at a time, in order, as before.
const SERIES = { map: 'mapSeries', flatMap: 'flatMapSeries', filter: 'filterSeries', some: 'someSeries', every: 'everySeries', find: 'findSeries', forEach: 'forEachSeries' };
function callbackPass(program, edits, asyncKeys) {
  const checker = program.getTypeChecker();
  let changed = 0;
  for (const sf of program.getSourceFiles()) {
    if (!sourceFiles.set.has(path.resolve(sf.fileName))) continue;
    const used = new Set();
    (function visit(n) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && SERIES[n.expression.name.text] && n.arguments.length === 1) {
        const [fn] = n.arguments;
        if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && isAsync(fn) && !headAsyncCallback(sf.fileName, n)) {
          const receiver = n.expression.expression, type = checker.getTypeAtLocation(receiver);
          if (!(checker.isArrayType(type) || checker.isTupleType(type) || (type.isUnion() && type.types.every(t => checker.isArrayType(t) || checker.isTupleType(t))))) report.callbacks.push(`${where(n)} ${n.expression.name.text}(async …) on a non-array`);
          else {
            const helper = SERIES[n.expression.name.text];
            used.add(helper);
            // "await" first: edits at the same position keep the order they were added in.
            awaitExpression(edits, n);
            // Rewrite "receiver.map(" → "mapSeries(receiver, " keeping the callback text as it is.
            edits.add(sf.fileName, n.getStart(), receiver.getStart(), `${helper}(`);
            edits.add(sf.fileName, receiver.getEnd(), fn.getStart(), ', ');
            makeAsync(edits, enclosingFunction(n), asyncKeys);
            changed++;
          }
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
    if (used.size) {
      const relative = path.relative(path.dirname(sf.fileName), path.join(ROOT, 'lib/db/async-array')).replace(/\\/g, '/');
      const spec = relative.startsWith('.') ? relative : `./${relative}`;
      const existing = sf.statements.find(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text === spec);
      if (existing) {
        const names = existing.importClause.namedBindings.elements.map(e => e.name.text);
        const missing = [...used].filter(name => !names.includes(name));
        if (missing.length) edits.add(sf.fileName, existing.importClause.namedBindings.elements.end, existing.importClause.namedBindings.elements.end, `, ${missing.join(', ')}`);
      } else {
        const first = sf.statements.find(s => ts.isImportDeclaration(s));
        const at = first ? first.getStart() : 0;
        edits.add(sf.fileName, at, at, `import { ${[...used].sort().join(', ')} } from '${spec}';\n`);
      }
    }
  }
  return changed;
}

const isDeclarationName = n => n.parent && (ts.isFunctionDeclaration(n.parent) || ts.isMethodDeclaration(n.parent) || ts.isVariableDeclaration(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isImportSpecifier(n.parent) || ts.isExportSpecifier(n.parent) || ts.isClassDeclaration(n.parent)) && n.parent.name === n;

// ---------- driver ----------
function program() {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
  const options = { ...config.options, noEmit: true, incremental: false };
  // Parent pointers are needed to walk up from a call to its function.
  return ts.createProgram({ rootNames: config.fileNames, options, host: ts.createCompilerHost(options, true) });
}

sourceFiles.set = new Set(sourceFiles().map(f => path.resolve(f)));
// --resume continues from an earlier run's report (the files already carry its edits).
const reportFile = path.join(ROOT, '.codemod-report.json');
const resume = process.argv.includes('--resume') && fs.existsSync(reportFile);
const asyncKeys = new Set();
if (resume) {
  // Functions async now but not in HEAD are the ones this codemod made async.
  const current = program();
  for (const sf of current.getSourceFiles()) {
    if (!sourceFiles.set.has(path.resolve(sf.fileName))) continue;
    const head = headInfo(sf.fileName);
    (function visit(n) {
      if (isFunctionLike(n) && isAsync(n)) { const key = functionKey(n); if (key && !head.asyncKeys.has(key)) asyncKeys.add(key); }
      ts.forEachChild(n, visit);
    })(sf);
  }
  console.log(`resume: ${asyncKeys.size} function(s) made async so far`);
}
let edits = new Edits();
if (!resume) {
  statementPass(program(), edits, asyncKeys);
  console.log(`step 1-2: ${edits.byFile.size} file(s) rewritten, ${asyncKeys.size} named function(s) made async`);
  edits.apply();
}
if (dry) process.exit(0);
for (let round = 1; round <= 30; round++) {
  edits = new Edits();
  const before = asyncKeys.size;
  report.values.length = 0;
  report.callbacks.length = 0;
  let current = program();
  const series = callbackPass(current, edits, asyncKeys);
  if (series) { edits.apply(); edits = new Edits(); current = program(); }
  const added = propagationPass(current, edits, asyncKeys);
  edits.apply();
  console.log(`step 3, round ${round}: ${series} array callback(s) made sequential, ${added} call(s) awaited, ${asyncKeys.size - before} more function(s) made async`);
  if (!added && !series) break;
}
// ---------- step 4: types ----------
let typed = 0;
for (const file of sourceFiles.set) {
  let text = fs.readFileSync(file, 'utf8');
  if (!/Database\.Database/.test(text)) continue;
  const relative = path.relative(path.dirname(file), path.join(ROOT, 'lib/db/client')).replace(/\\/g, '/');
  const spec = relative.startsWith('.') ? relative : `./${relative}`;
  text = text.replace(/Database\.Database/g, 'Db');
  // Keep better-sqlite3 only where it is still used as a value.
  if (!/\bDatabase\b/.test(text.replace(/^import Database from 'better-sqlite3';?\r?\n/m, ''))) text = text.replace(/^import Database from 'better-sqlite3';?\r?\n/m, '');
  if (!/import type \{ Db \}/.test(text)) {
    const firstImport = text.search(/^import /m);
    const line = `import type { Db } from '${spec}';\n`;
    text = firstImport >= 0 ? text.slice(0, firstImport) + line + text.slice(firstImport) : line + text;
  }
  fs.writeFileSync(file, text);
  typed++;
}
console.log(`step 4: Database.Database → Db in ${typed} file(s)`);
for (const [kind, list] of Object.entries(report)) if (list.length) console.log(`\nManual: ${kind} (${list.length})\n  ${[...new Set(list)].join('\n  ')}`);
fs.writeFileSync(path.join(ROOT, '.codemod-report.json'), JSON.stringify({ asyncKeys: [...asyncKeys], report }, null, 1));

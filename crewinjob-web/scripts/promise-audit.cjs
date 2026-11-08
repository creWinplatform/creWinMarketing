// Lists promises used as values without `await` in lib/ and app/: the mistakes a sync → async move leaves that the
// compiler does not flag (a promise in a condition, a JSON body, a spread, a comparison, or a call left floating).
//   node scripts/promise-audit.cjs            all findings
//   node scripts/promise-audit.cjs --new      only lines that differ from HEAD (what the SQL Server move changed)
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const onlyNew = process.argv.includes('--new');
const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
const options = { ...config.options, noEmit: true, incremental: false };
const program = ts.createProgram({ rootNames: config.fileNames, options, host: ts.createCompilerHost(options, true) });
const checker = program.getTypeChecker();

const isPromise = type => {
  if (!type) return false;
  if (type.isUnion()) return type.types.some(isPromise);
  const symbol = type.getSymbol() || type.aliasSymbol;
  return Boolean(symbol && (symbol.getName() === 'Promise' || symbol.getName() === 'PromiseLike'));
};
// Places where a promise is expected and fine.
function acceptable(node) {
  const parent = node.parent;
  if (ts.isAwaitExpression(parent) || ts.isVoidExpression(parent)) return true;
  if (ts.isReturnStatement(parent)) return true;
  if (ts.isArrowFunction(parent) && parent.body === node) return true;
  if (ts.isParenthesizedExpression(parent)) return acceptable(parent);
  if (ts.isAsExpression(parent) || ts.isSatisfiesExpression?.(parent) || ts.isNonNullExpression(parent)) return acceptable(parent);
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && ['then', 'catch', 'finally'].includes(parent.name.text)) return true;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true; // checked where the variable is used
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    // Passing a promise on is fine when the callee takes one (Promise.all, a helper typed for promises).
    const signature = checker.getResolvedSignature(parent);
    const index = parent.arguments.indexOf(node);
    const param = signature?.parameters[Math.min(index, (signature?.parameters.length || 1) - 1)];
    if (!param) return false;
    const paramType = checker.getTypeOfSymbolAtLocation(param, parent);
    if (isPromise(paramType)) return true;
    // An any/unknown parameter takes a promise only in Promise helpers; elsewhere (JSON bodies, loggers) it is a mistake.
    if ((paramType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && /^Promise.(all|allSettled|race|any|resolve)$/.test(parent.expression.getText())) return true;
    if (checker.isArrayType(paramType) || paramType.getNumberIndexType?.()) { const element = paramType.getNumberIndexType(); return isPromise(element) || Boolean(element && element.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)); }
    return false;
  }
  if (ts.isArrayLiteralExpression(parent)) return acceptable(parent);
  return false;
}
// Changed lines per file versus HEAD, for --new.
const changedLines = new Map();
function changed(file, line) {
  if (!onlyNew) return true;
  if (!changedLines.has(file)) {
    const set = new Set();
    try {
      const diff = execFileSync('git', ['diff', '-U0', 'HEAD', '--', file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
      for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) { const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]); for (let i = 0; i < count; i++) set.add(start + i); }
    } catch { /* untracked */ }
    changedLines.set(file, set);
  }
  return changedLines.get(file).has(line);
}

const findings = [];
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(ROOT, sf.fileName).replace(/\\/g, '/');
  if (rel.startsWith('..') || rel.includes('node_modules') || !/^(lib|app)\//.test(rel)) continue;
  (function visit(n) {
    const declarationName = n.parent && 'name' in n.parent && n.parent.name === n;
    const typePosition = n.parent && (ts.isTypeReferenceNode(n.parent) || ts.isExpressionWithTypeArguments(n.parent) || ts.isQualifiedName(n.parent) || ts.isTypeQueryNode(n.parent));
    if (!declarationName && !typePosition && (ts.isCallExpression(n) || ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && ts.isExpression(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      let type;
      try { type = checker.getTypeAtLocation(n); } catch { type = null; }
      if (isPromise(type) && !acceptable(n) && !ts.isExpressionStatement(n.parent) === true) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (changed(sf.fileName, line)) findings.push(`${rel}:${line} ${ts.SyntaxKind[n.parent.kind]}: ${n.getText().replace(/\s+/g, ' ').slice(0, 110)}`);
      }
      // A promise-returning call as a statement on its own: nobody waits for it.
      if (ts.isCallExpression(n) && ts.isExpressionStatement(n.parent) && isPromise(type)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (changed(sf.fileName, line)) findings.push(`${rel}:${line} floating: ${n.getText().replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
}
console.log(findings.length ? findings.join('\n') : 'no promise used without await');
console.log(`\n${findings.length} finding(s)`);

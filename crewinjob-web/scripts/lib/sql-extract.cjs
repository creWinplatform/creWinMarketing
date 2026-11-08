// Finds every SQL string the code passes to `.prepare(...)` (and to the async Db methods), using the TypeScript
// parser, so the SQL Server translation can be checked against all of them.
// Strings built from constants in the same file are resolved; any other `${...}` part is reported as dynamic.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const METHODS = new Set(['prepare', 'get', 'all', 'run', 'exec']);

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function extract(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const constants = new Map();
  (function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && node.parent.flags & ts.NodeFlags.Const) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  })(source);
  const value = (node, seen = new Set()) => {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { sql: node.text, dynamic: false };
    if (ts.isParenthesizedExpression(node)) return value(node.expression, seen);
    if (ts.isTemplateExpression(node)) {
      let sql = node.head.text, dynamic = false;
      for (const span of node.templateSpans) {
        const inner = value(span.expression, seen);
        if (inner && !inner.dynamic) sql += inner.sql; else { sql += '/*${}*/'; dynamic = true; }
        sql += span.literal.text;
      }
      return { sql, dynamic };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = value(node.left, seen), right = value(node.right, seen);
      return { sql: (left ? left.sql : '/*${}*/') + (right ? right.sql : '/*${}*/'), dynamic: !left || !right || left.dynamic || right.dynamic };
    }
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) { seen.add(node.text); return value(constants.get(node.text), seen); }
    return null;
  };
  const found = [];
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && METHODS.has(node.expression.name.text) && node.arguments.length) {
      const method = node.expression.name.text;
      const resolved = value(node.arguments[0]);
      // get/all/run/exec on other objects (Maps, regexes) take no SQL; keep them only when the string looks like SQL.
      const looksSql = resolved && /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|PRAGMA|REPLACE|BEGIN)\b/i.test(resolved.sql);
      if (method === 'prepare' || looksSql) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push({ file: path.relative(process.cwd(), file).replace(/\\/g, '/'), line: line + 1, method, sql: resolved ? resolved.sql : null, dynamic: resolved ? resolved.dynamic : true });
      }
    }
    ts.forEachChild(node, visit);
  })(source);
  return found;
}

function extractAll(roots = ['lib', 'app']) {
  return roots.flatMap(root => walkFiles(path.join(process.cwd(), root))).flatMap(extract);
}

module.exports = { extract, extractAll };

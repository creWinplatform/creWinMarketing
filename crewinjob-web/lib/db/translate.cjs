// Translates the SQLite statements the platform code writes into T-SQL for SQL Server, once per distinct statement.
// The code keeps one SQL text; this layer covers the SQLite dialect it uses (counts from scripts/mssql-sql-audit.cjs):
//   ? parameters → @p1…@pN          LIMIT/OFFSET → TOP / OFFSET…FETCH     datetime('now', …) → SYSUTCDATETIME
//   INSERT OR IGNORE / ON CONFLICT DO NOTHING → insert that skips key conflicts
//   ON CONFLICT … DO UPDATE → locked update-or-insert            INSERT OR REPLACE → delete + insert
//   json_extract → JSON_VALUE   json_each → OPENJSON   json_group_array → FOR JSON   julianday / strftime
//   length/substr/ifnull/max(a,b)/min(a,b) → LEN/SUBSTRING/ISNULL/GREATEST/LEAST
//   a predicate used as a value (SUM(kind='x'), a select-list comparison) → CASE WHEN … THEN 1 ELSE 0 END
//   COLLATE NOCASE and LIKE (case-insensitive in SQLite) → a case-insensitive collation
// A statement the translator cannot handle throws, naming the construct, instead of running different SQL.
const NOCASE = 'Latin1_General_100_CI_AS_SC';
// T-SQL reserved words the schema uses as column names or aliases.
const RESERVED = new Set(['key', 'user', 'file', 'plan', 'open', 'read', 'percent', 'public', 'rule', 'schema', 'function', 'current', 'external', 'identity', 'top', 'check', 'default']);
const CLAUSE = new Set(['select', 'from', 'where', 'group', 'order', 'having', 'limit', 'offset', 'union', 'intersect', 'except', 'on', 'join', 'inner', 'left', 'right', 'cross', 'set', 'values', 'returning', 'into', 'and', 'or', 'not', 'when', 'then', 'else', 'end', 'case', 'as', 'by', 'is', 'in', 'like', 'between', 'exists', 'null', 'distinct', 'all', 'asc', 'desc', 'insert', 'update', 'delete', 'conflict', 'do', 'nothing']);

class UnsupportedSql extends Error {
  constructor(construct, sql) { super(`SQL Server translation does not support ${construct}: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`); this.name = 'UnsupportedSql'; }
}

// ---------- tokens ----------
function tokenize(sql) {
  const tokens = []; let i = 0;
  const push = (type, text) => tokens.push({ type, text });
  while (i < sql.length) {
    const c = sql[i], rest = sql.slice(i);
    let m;
    if (/\s/.test(c)) { m = /^\s+/.exec(rest); push('ws', m[0]); }
    else if (rest.startsWith('--')) { m = /^--[^\n]*/.exec(rest); push('ws', ' '); }
    else if (rest.startsWith('/*')) { const end = sql.indexOf('*/', i + 2); m = [sql.slice(i, end < 0 ? sql.length : end + 2)]; push('ws', ' '); }
    else if (c === "'") { m = /^'(?:[^']|'')*'/.exec(rest); if (!m) throw new UnsupportedSql('an unterminated string', sql); push('str', m[0]); }
    else if (c === '"') { m = /^"(?:[^"]|"")*"/.exec(rest); push('id', `[${m[0].slice(1, -1).replace(/""/g, '"')}]`); }
    else if (c === '`') { m = /^`[^`]*`/.exec(rest); push('id', `[${m[0].slice(1, -1)}]`); }
    else if (c === '[') { m = /^\[[^\]]*\]/.exec(rest); push('id', m[0]); }
    else if (c === '?') { m = /^\?\d*/.exec(rest); if (m[0].length > 1) throw new UnsupportedSql('numbered ?NNN parameters', sql); push('param', '?'); }
    else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) { m = /^(?:\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)/i.exec(rest); push('num', m[0]); }
    else if (/[A-Za-z_]/.test(c)) { m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest); push('word', m[0]); }
    else if ((m = /^(\|\||<=|>=|<>|!=|==|<<|>>)/.exec(rest))) push('op', m[0] === '==' ? '=' : m[0]);
    else { m = [c]; push(c === '(' || c === ')' || c === ',' || c === ';' || c === '.' ? c : 'op', c); }
    i += m[0].length;
  }
  return tokens;
}
const text = tokens => tokens.map(t => t.text).join('');
const isWord = (t, ...words) => t && t.type === 'word' && words.includes(t.text.toLowerCase());
const lower = t => (t && t.type === 'word' ? t.text.toLowerCase() : null);
// Index of the next non-whitespace token.
const next = (tokens, i) => { let j = i + 1; while (j < tokens.length && tokens[j].type === 'ws') j++; return j; };
const prev = (tokens, i) => { let j = i - 1; while (j >= 0 && tokens[j].type === 'ws') j--; return j; };
// The matching ')' for the '(' at i.
function close(tokens, i) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) { if (tokens[j].type === '(') depth++; else if (tokens[j].type === ')' && --depth === 0) return j; }
  throw new Error('unbalanced parentheses');
}
// Splits tokens[from..to) on top-level commas.
function splitArgs(tokens, from, to) {
  const parts = []; let depth = 0, start = from;
  for (let j = from; j < to; j++) {
    if (tokens[j].type === '(') depth++; else if (tokens[j].type === ')') depth--;
    else if (tokens[j].type === ',' && depth === 0) { parts.push(tokens.slice(start, j)); start = j + 1; }
  }
  parts.push(tokens.slice(start, to));
  return parts;
}
const trimTokens = list => { let a = 0, b = list.length; while (a < b && list[a].type === 'ws') a++; while (b > a && list[b - 1].type === 'ws') b--; return list.slice(a, b); };
const raw = s => ({ type: 'raw', text: s });

// ---------- function rewrites ----------
const MODIFIER = /^'([+-]?\d+(?:\.\d+)?) (second|minute|hour|day|month|year)s?'$/i;
function dateExpr(args, sql) {
  // SQLite datetime()/date() take a time value then modifiers such as '-7 days' or 'start of day'.
  let base = text(trimTokens(args[0]));
  let expr = /^'now'$/i.test(base) ? 'SYSUTCDATETIME()' : `CAST(REPLACE(REPLACE(${base},'T',' '),'Z','') AS DATETIME2)`;
  for (const arg of args.slice(1)) {
    const value = text(trimTokens(arg)), m = MODIFIER.exec(value);
    if (m) expr = `DATEADD(${m[2].toLowerCase()},${m[1]},${expr})`;
    else if (/^'start of day'$/i.test(value)) expr = `CAST(CAST(${expr} AS DATE) AS DATETIME2)`;
    else if (/^'start of month'$/i.test(value)) expr = `DATEFROMPARTS(YEAR(${expr}),MONTH(${expr}),1)`;
    else if (arg.some(t => t.type === 'param')) expr = `DATEADD(second,${secondsFromParam(value)},${expr})`;
    else throw new UnsupportedSql(`the date modifier ${value}`, sql);
  }
  return expr;
}
// A modifier passed as a parameter, for example '-30 days': the number of seconds it adds.
function secondsFromParam(value) {
  return `CAST(LEFT(${value},CHARINDEX(' ',${value})-1) AS FLOAT)*CASE WHEN ${value} LIKE '% day%' THEN 86400 WHEN ${value} LIKE '% hour%' THEN 3600 WHEN ${value} LIKE '% minute%' THEN 60 ELSE 1 END`;
}
const STRFTIME = { '%Y-%m-%d': 23, '%Y-%m-%dT%H:%M:%fZ': 127, '%Y-%m-%d %H:%M:%S': 120, '%Y-%m': 23 };
function rewriteFunctions(tokens, sql) {
  for (let i = 0; i < tokens.length; i++) {
    const name = lower(tokens[i]);
    if (!name) continue;
    const open = next(tokens, i);
    if (!tokens[open] || tokens[open].type !== '(') continue;
    const end = close(tokens, open);
    const args = () => splitArgs(tokens, open + 1, end).map(a => rewriteFunctions(a, sql));
    let replacement = null;
    switch (name) {
      case 'datetime': replacement = `CONVERT(NVARCHAR(19),${dateExpr(args(), sql)},120)`; break;
      case 'date': replacement = `CONVERT(NVARCHAR(10),${dateExpr(args(), sql)},23)`; break;
      case 'julianday': {
        // Only differences of two julianday() values are meaningful; days as a float since a fixed origin.
        const [value] = args();
        const v = text(trimTokens(value));
        replacement = /^'now'$/i.test(v) ? `(CAST(DATEDIFF_BIG(millisecond,'2000-01-01',SYSUTCDATETIME()) AS FLOAT)/86400000.0)` : `(CAST(DATEDIFF_BIG(millisecond,'2000-01-01',CAST(REPLACE(REPLACE(${v},'T',' '),'Z','') AS DATETIME2)) AS FLOAT)/86400000.0)`;
        break;
      }
      case 'strftime': {
        const [format, ...rest] = args(), f = text(trimTokens(format)).slice(1, -1);
        if (!(f in STRFTIME)) throw new UnsupportedSql(`strftime('${f}')`, sql);
        const width = f === '%Y-%m' ? 7 : f === '%Y-%m-%d' ? 10 : f === '%Y-%m-%d %H:%M:%S' ? 19 : 24;
        const value = dateExpr(rest.length ? rest : [[raw("'now'")]], sql);
        replacement = f === '%Y-%m-%dT%H:%M:%fZ' ? `CONVERT(NVARCHAR(23),${value},126)+'Z'` : `CONVERT(NVARCHAR(${width}),${value},${STRFTIME[f]})`;
        break;
      }
      case 'json_extract': { const [doc, path, ...more] = args(); if (more.length) throw new UnsupportedSql('json_extract with several paths', sql); replacement = `JSON_VALUE(${text(doc)},${text(path)})`; break; }
      case 'json_each': {
        const [doc, path, ...more] = args();
        if (more.length) throw new UnsupportedSql('json_each with more than a path', sql);
        replacement = `OPENJSON(${text(doc)}${path ? `,${text(path)}` : ''})`;
        // "FROM t, json_each(t.col)" reads a column of t: T-SQL needs CROSS APPLY for that.
        const before = prev(tokens, i);
        if (tokens[before]?.type === ',') tokens[before] = raw(' CROSS APPLY ');
        break;
      }
      case 'length': {
        // length(CAST(x AS BLOB)) is the UTF-8 byte count in SQLite.
        const a = text(trimTokens(args()[0])), blob = /^CAST\(([\s\S]*) AS (?:BLOB|VARBINARY\(MAX\))\)$/i.exec(a);
        replacement = blob ? `DATALENGTH(CAST(${blob[1]} COLLATE Latin1_General_100_CI_AS_SC_UTF8 AS VARCHAR(MAX)))` : `LEN(${a})`;
        break;
      }
      case 'cast': {
        const parts = trimTokens(tokens.slice(open + 1, end)), as = parts.map(lower).lastIndexOf('as');
        if (as < 0) break;
        const type = text(trimTokens(parts.slice(as + 1))).toUpperCase(), value = text(rewriteFunctions(trimTokens(parts.slice(0, as)), sql));
        const mapped = { INTEGER: 'BIGINT', INT: 'BIGINT', TEXT: 'NVARCHAR(MAX)', REAL: 'FLOAT', BLOB: 'VARBINARY(MAX)', NUMERIC: 'FLOAT' }[type];
        if (mapped) replacement = `CAST(${value} AS ${mapped})`;
        break;
      }
      case 'ifnull': replacement = `ISNULL(${args().map(text).join(',')})`; break;
      case 'substr': {
        // SUBSTRING needs integer positions; a parameter arrives as text in the audit and as a number at run time.
        const a = args().map(x => text(trimTokens(x))).map((x, k) => (k && /^@p\d+$/.test(x) ? `CAST(${x} AS INT)` : x));
        replacement = `SUBSTRING(${a[0]},${a[1]},${a[2] ?? 2147483647})`;
        break;
      }
      case 'max': case 'min': { const a = args(); if (a.length > 1) replacement = `${name === 'max' ? 'GREATEST' : 'LEAST'}(${a.map(text).join(',')})`; break; }
      case 'sum': case 'avg': case 'total': case 'count': {
        const a = args();
        if (a.length === 1 && isPredicate(a[0])) replacement = `${name === 'total' ? 'SUM' : name.toUpperCase()}(CASE WHEN ${text(a[0])} THEN 1 ELSE 0 END)`;
        else if (name === 'total') replacement = `ISNULL(SUM(${text(a[0])}),0)`;
        break;
      }
      case 'json_group_array': throw new UnsupportedSql('json_group_array outside a scalar subquery', sql);
      case 'iif': break;
      default: break;
    }
    if (replacement !== null) { tokens.splice(i, end - i + 1, raw(replacement)); }
  }
  return tokens;
}
// The tokens inside one pair of parentheses that wraps the whole expression, or the tokens themselves.
function unwrap(tokens) {
  let t = trimTokens(tokens);
  while (t.length > 1 && t[0].type === '(' && close(t, 0) === t.length - 1) t = trimTokens(t.slice(1, -1));
  return t;
}
// True when the expression is a comparison or logical predicate (a boolean, which T-SQL cannot use as a value).
// A top-level CASE or a scalar subquery is a value, whatever it contains.
function isPredicate(tokens) {
  const t = unwrap(tokens);
  let depth = 0, predicate = false;
  for (const x of t) {
    if (x.type === '(') depth++; else if (x.type === ')') depth--;
    else if (depth === 0) {
      if (isWord(x, 'case', 'select')) return false;
      if ((x.type === 'op' && ['=', '<', '>', '<=', '>=', '<>', '!='].includes(x.text)) || isWord(x, 'and', 'or', 'not', 'is', 'in', 'like', 'between', 'exists')) predicate = true;
    }
  }
  return predicate;
}

// ---------- scalar subquery with json_group_array(x) → FOR JSON ----------
function rewriteJsonGroupArray(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'json_group_array')) continue;
    // Expected form: (SELECT json_group_array(expr) FROM … ) — becomes a JSON array of the values.
    const open = next(tokens, i), end = close(tokens, open);
    const value = text(trimTokens(tokens.slice(open + 1, end)));
    const sel = prev(tokens, i);
    if (!isWord(tokens[sel], 'select')) return null;
    const outer = prev(tokens, sel);
    if (!tokens[outer] || tokens[outer].type !== '(') return null;
    const outerEnd = close(tokens, outer);
    const from = tokens.slice(end + 1, outerEnd);
    tokens.splice(outer, outerEnd - outer + 1, raw(`ISNULL((SELECT '['+STRING_AGG(CAST(j.v AS NVARCHAR(MAX)),',')+']' FROM (SELECT '"'+STRING_ESCAPE(${value},'json')+'"' AS v ${text(from)} ) AS j),'[]')`));
  }
  return tokens;
}

// ---------- LIMIT / OFFSET ----------
// Each SELECT level with LIMIT n becomes SELECT TOP(n); with OFFSET it becomes OFFSET … FETCH. DELETE/UPDATE … LIMIT n → TOP(n).
function rewriteLimit(tokens, sql) {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'limit')) continue;
    // Find the statement or subquery this LIMIT closes: walk back to the '(' that opens the level, or the start.
    let depth = 0, start = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].type === ')') depth++;
      else if (tokens[j].type === '(') { if (depth === 0) { start = j + 1; break; } depth--; }
    }
    // The LIMIT value and an optional OFFSET, up to the end of the level.
    let end = tokens.length; depth = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === '(') depth++; else if (tokens[j].type === ')') { if (depth === 0) { end = j; break; } depth--; }
      else if (tokens[j].type === ';' && depth === 0) { end = j; break; }
    }
    const clause = tokens.slice(i + 1, end);
    let offsetAt = clause.findIndex(t => isWord(t, 'offset'));
    let limitValue = text(trimTokens(offsetAt < 0 ? clause : clause.slice(0, offsetAt)));
    let offsetValue = offsetAt < 0 ? null : text(trimTokens(clause.slice(offsetAt + 1)));
    const comma = clause.findIndex(t => t.type === ',');
    if (comma >= 0 && offsetAt < 0) { offsetValue = text(trimTokens(clause.slice(0, comma))); limitValue = text(trimTokens(clause.slice(comma + 1))); }
    if (/^-1$/.test(limitValue)) limitValue = null;
    tokens.splice(i, end - i);
    // The first keyword of the level.
    let first = start; while (first < tokens.length && tokens[first].type === 'ws') first++;
    const kind = lower(tokens[first]);
    if (offsetValue === null && limitValue !== null) {
      if (kind === 'select') {
        let at = first + 1; const d = next(tokens, first);
        if (isWord(tokens[d], 'distinct', 'all')) at = d + 1;
        tokens.splice(at, 0, raw(` TOP(${limitValue})`));
      } else if (kind === 'delete' || kind === 'update') tokens.splice(first + 1, 0, raw(` TOP(${limitValue})`));
      else throw new UnsupportedSql(`LIMIT after ${kind}`, sql);
    } else {
      const level = tokens.slice(start, i);
      let hasOrder = false, d = 0;
      for (let k = 0; k < level.length; k++) { if (level[k].type === '(') d++; else if (level[k].type === ')') d--; else if (d === 0 && isWord(level[k], 'order') && isWord(level[next(level, k)], 'by')) hasOrder = true; }
      tokens.splice(i, 0, raw(`${hasOrder ? '' : ' ORDER BY (SELECT NULL)'} OFFSET ${offsetValue ?? 0} ROWS${limitValue === null ? '' : ` FETCH NEXT ${limitValue} ROWS ONLY`}`));
    }
  }
  return tokens;
}

// ---------- select-list predicates ----------
// SELECT a=b AS x, EXISTS(…) AS y → CASE WHEN … THEN 1 ELSE 0 END.
function rewriteSelectPredicates(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'select')) continue;
    let depth = 0, end = tokens.length;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === '(') depth++; else if (tokens[j].type === ')') { if (depth === 0) { end = j; break; } depth--; }
      else if (depth === 0 && isWord(tokens[j], 'from', 'where', 'group', 'order', 'union', 'having')) { end = j; break; }
    }
    const items = splitArgs(tokens, i + 1, end);
    let changed = false;
    const rebuilt = items.map(item => {
      // Split "expr [AS] alias".
      const t = trimTokens(item);
      let aliasAt = -1;
      for (let k = t.length - 1; k > 0; k--) {
        if (t[k].type === 'ws') continue;
        if ((t[k].type === 'word' || t[k].type === 'id') && !CLAUSE.has(lower(t[k]) || '') && t[k - 1] && t[k - 1].type === 'ws') aliasAt = k;
        break;
      }
      let expr = aliasAt > 0 ? t.slice(0, aliasAt) : t, alias = aliasAt > 0 ? t.slice(aliasAt) : [];
      if (alias.length && isWord(expr[prev(expr, expr.length)], 'as')) { alias = [...expr.slice(prev(expr, expr.length)), ...alias]; expr = expr.slice(0, prev(expr, expr.length)); }
      const e = trimTokens(expr);
      if (e.length && (isPredicate(e) || isWord(e[0], 'exists') || (isWord(e[0], 'not') && isWord(e[next(e, 0)], 'exists')))) { changed = true; return [raw(` CASE WHEN ${text(e)} THEN 1 ELSE 0 END `), ...alias]; }
      return item;
    });
    if (changed) {
      const out = [];
      rebuilt.forEach((item, k) => { if (k) out.push({ type: ',', text: ',' }); out.push(...item); });
      tokens.splice(i + 1, end - i - 1, ...out, { type: 'ws', text: ' ' });
    }
  }
  return tokens;
}

// "FROM (SELECT …)" needs an alias in T-SQL.
function aliasDerivedTables(tokens) {
  let n = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'from', 'join') && tokens[i].type !== ',') continue;
    const open = next(tokens, i);
    if (tokens[open]?.type !== '(' || !isWord(tokens[next(tokens, open)], 'select')) continue;
    // A comma only starts a table in a FROM list; inside a select list "(SELECT …)" is a scalar subquery.
    if (tokens[i].type === ',') {
      let depth = 0, inFrom = false;
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === ')') depth++; else if (tokens[j].type === '(') { if (depth === 0) break; depth--; }
        else if (depth === 0 && isWord(tokens[j], 'from')) { inFrom = true; break; }
        else if (depth === 0 && isWord(tokens[j], 'select', 'where', 'set', 'values')) break;
      }
      if (!inFrom) continue;
    }
    const end = close(tokens, open), after = tokens[next(tokens, end)];
    if (after && (isWord(after, 'as') || ((after.type === 'word' || after.type === 'id') && !CLAUSE.has(lower(after) || '')))) continue;
    tokens.splice(end + 1, 0, raw(` AS derived${++n}`));
  }
  return tokens;
}

// The clause that starts at `at` (after its keyword), up to the next clause keyword or ')' of this level.
function clauseEnd(tokens, at, stops) {
  let depth = 0;
  for (let j = at; j < tokens.length; j++) {
    if (tokens[j].type === '(') depth++; else if (tokens[j].type === ')') { if (depth === 0) return j; depth--; }
    else if (depth === 0 && (tokens[j].type === ';' || isWord(tokens[j], ...stops))) return j;
  }
  return tokens.length;
}
// ORDER BY a=b DESC, x IS NULL → ORDER BY CASE WHEN … THEN 1 ELSE 0 END (T-SQL sorts values, not predicates).
function rewriteOrderPredicates(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'order') || !isWord(tokens[next(tokens, i)], 'by')) continue;
    const from = next(tokens, i) + 1, end = clauseEnd(tokens, from, ['limit', 'offset', 'union']);
    const items = splitArgs(tokens, from, end).map(item => {
      const t = trimTokens(item), last = t.length - 1;
      const direction = isWord(t[last], 'asc', 'desc') ? t.slice(prev(t, last) + 1) : [];
      const expr = direction.length ? trimTokens(t.slice(0, prev(t, last) + 1)) : t;
      return isPredicate(expr) ? [raw(` CASE WHEN ${text(expr)} THEN 1 ELSE 0 END `), ...direction] : item;
    });
    const out = [];
    items.forEach((item, k) => { if (k) out.push({ type: ',', text: ',' }); out.push(...item); });
    tokens.splice(from, end - from, ...out);
  }
  return tokens;
}
// HAVING may name a select-list alias in SQLite; T-SQL needs the expression.
function rewriteHavingAliases(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'having')) continue;
    // The SELECT of this level: walk back at the same depth.
    let depth = 0, select = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].type === ')') depth++; else if (tokens[j].type === '(') { if (depth === 0) break; depth--; }
      else if (depth === 0 && isWord(tokens[j], 'select')) { select = j; break; }
    }
    if (select < 0) continue;
    const listEnd = clauseEnd(tokens, select + 1, ['from']);
    const aliases = new Map();
    for (const item of splitArgs(tokens, select + 1, listEnd)) {
      const t = trimTokens(item), last = t.length - 1;
      if (last < 2 || !(t[last].type === 'word' || t[last].type === 'id') || t[last - 1].type !== 'ws') continue;
      let exprEnd = prev(t, last);
      if (isWord(t[exprEnd], 'as')) exprEnd = prev(t, exprEnd);
      aliases.set(t[last].text.replace(/^\[|\]$/g, '').toLowerCase(), text(trimTokens(t.slice(0, exprEnd + 1))));
    }
    const end = clauseEnd(tokens, i + 1, ['order', 'limit', 'union']);
    for (let j = i + 1; j < end; j++) {
      const t = tokens[j];
      if ((t.type === 'word' || t.type === 'id') && aliases.has(t.text.replace(/^\[|\]$/g, '').toLowerCase()) && tokens[j - 1]?.type !== '.' && tokens[j + 1]?.type !== '.' && tokens[next(tokens, j)]?.type !== '(') tokens[j] = raw(`(${aliases.get(t.text.replace(/^\[|\]$/g, '').toLowerCase())})`);
    }
  }
  return tokens;
}

// ---------- WHERE <integer column> (truthiness) ----------
// SQLite accepts "WHERE active AND …" or "NOT active"; T-SQL needs a comparison. Applied to bare column operands
// of AND / OR / NOT / WHERE / ON / WHEN / HAVING.
function rewriteBareBooleans(tokens) {
  // What may follow a whole predicate ("x NOT IN …" is not one: NOT there continues the comparison).
  const boundary = t => !t || t.type === ')' || t.type === ',' || t.type === ';' || isWord(t, 'and', 'or', 'where', 'when', 'having', 'then', 'else', 'end', 'group', 'order', 'limit', 'union', 'join', 'left', 'inner');
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'where', 'and', 'or', 'not', 'on', 'having', 'when')) continue;
    // "x BETWEEN a AND b": that AND joins the range, not two predicates.
    if (isWord(tokens[i], 'and') && isWord(tokens[prev(tokens, prev(tokens, i))], 'between')) continue;
    let j = next(tokens, i);
    // CASE WHEN ? THEN …: a parameter used as a condition.
    if (tokens[j] && tokens[j].type === 'param' && boundary(tokens[next(tokens, j)])) { tokens.splice(j + 1, 0, raw('<>0')); continue; }
    // A column reference: word, or word.word
    if (!(tokens[j] && (tokens[j].type === 'word' || tokens[j].type === 'id')) || CLAUSE.has(lower(tokens[j]) || '') || isWord(tokens[j], 'exists', 'case')) continue;
    let k = j;
    if (tokens[k + 1] && tokens[k + 1].type === '.' && tokens[k + 2] && (tokens[k + 2].type === 'word' || tokens[k + 2].type === 'id')) k += 2;
    if (tokens[next(tokens, k)] && tokens[next(tokens, k)].type === '(') continue; // a function call
    const after = tokens[next(tokens, k)];
    if (boundary(after)) {
      // Only when the operand ends the predicate (followed by AND/OR/)/end), not "a = b".
      tokens.splice(k + 1, 0, raw('<>0'));
    }
  }
  return tokens;
}

// ---------- INSERT variants ----------
// Statements are rewritten into T-SQL batches; the adapter sums the affected rows of every statement.
const bare = name => name.replace(/^\[|\]$/g, ''), bracket = name => `[${bare(name)}]`;
const IGNORE_ERRORS = '2601,2627'; // duplicate key in a unique index / primary key
function insertParts(tokens, sql) {
  // INSERT [OR x] INTO table (cols) VALUES (…) | SELECT … [ON CONFLICT …]
  let i = next(tokens, -1);
  if (!isWord(tokens[i], 'insert', 'replace')) return null;
  const replace = isWord(tokens[i], 'replace');
  let j = next(tokens, i), mode = replace ? 'replace' : null;
  if (isWord(tokens[j], 'or')) { mode = lower(tokens[next(tokens, j)]); j = next(tokens, next(tokens, j)); }
  if (!isWord(tokens[j], 'into')) return null;
  const tableAt = next(tokens, j), table = tokens[tableAt].text;
  const colsOpen = next(tokens, tableAt);
  let columns, k;
  if (tokens[colsOpen].type === '(') {
    const colsClose = close(tokens, colsOpen);
    columns = splitArgs(tokens, colsOpen + 1, colsClose).map(c => bare(text(trimTokens(c))));
    k = next(tokens, colsClose);
  } else {
    // INSERT INTO t VALUES(…): SQL Server needs the column list (its synthetic rowid column comes last and is skipped).
    const info = tableInfo(table);
    if (!info) throw new UnsupportedSql(`INSERT into the unknown table ${table}`, sql);
    columns = info.columns.slice();
    k = colsOpen;
  }
  let source, values = null;
  // The source runs until ON CONFLICT (top level) or the end.
  let conflictAt = -1, depth = 0;
  for (let m = k; m < tokens.length; m++) {
    if (tokens[m].type === '(') depth++; else if (tokens[m].type === ')') depth--;
    else if (depth === 0 && isWord(tokens[m], 'on') && isWord(tokens[next(tokens, m)], 'conflict')) { conflictAt = m; break; }
  }
  const sourceTokens = tokens.slice(k, conflictAt < 0 ? tokens.length : conflictAt);
  if (isWord(tokens[k], 'values')) {
    const vOpen = next(tokens, k), vClose = close(tokens, vOpen);
    // Several rows pass through unchanged (SQL Server takes up to 1,000); with a conflict clause or OR IGNORE/REPLACE
    // they would need row-by-row handling.
    const multi = next(tokens, vClose) < (conflictAt < 0 ? tokens.length : conflictAt) && tokens[next(tokens, vClose)]?.type === ',';
    if (multi && (conflictAt >= 0 || mode)) throw new UnsupportedSql('a multi-row VALUES with a conflict clause', sql);
    if (!multi) values = splitArgs(tokens, vOpen + 1, vClose).map(v => text(trimTokens(v)));
  }
  source = text(trimTokens(sourceTokens));
  let conflict = null;
  if (conflictAt >= 0) {
    let m = next(tokens, next(tokens, conflictAt));
    let target = [];
    if (tokens[m].type === '(') { const e = close(tokens, m); target = splitArgs(tokens, m + 1, e).map(c => bare(text(trimTokens(c)))); m = next(tokens, e); }
    if (isWord(tokens[m], 'where')) throw new UnsupportedSql('ON CONFLICT with a partial-index WHERE', sql);
    if (!isWord(tokens[m], 'do')) throw new UnsupportedSql('ON CONFLICT without DO', sql);
    m = next(tokens, m);
    if (isWord(tokens[m], 'nothing')) conflict = { target, action: 'nothing' };
    else if (isWord(tokens[m], 'update')) {
      const setAt = next(tokens, m);
      let whereAt = -1; depth = 0;
      for (let n = setAt + 1; n < tokens.length; n++) { if (tokens[n].type === '(') depth++; else if (tokens[n].type === ')') depth--; else if (depth === 0 && isWord(tokens[n], 'where')) { whereAt = n; break; } }
      conflict = { target, action: 'update', set: tokens.slice(setAt + 1, whereAt < 0 ? tokens.length : whereAt), where: whereAt < 0 ? null : tokens.slice(whereAt + 1) };
    } else throw new UnsupportedSql('this ON CONFLICT action', sql);
  }
  // An IDENTITY column given NULL (SQLite: "assign the next rowid") is left out, so SQL Server assigns it.
  const identity = tableInfo(table)?.identity, at = identity ? columns.indexOf(identity) : -1;
  if (at >= 0 && values && /^NULL$/i.test(values[at])) {
    columns.splice(at, 1); values.splice(at, 1);
    source = `VALUES(${values.join(',')})`;
  }
  return { table, columns, source, values, mode, conflict, implicit: k === colsOpen || at >= 0 };
}
const tryInsert = (insert) => `BEGIN TRY ${insert}; END TRY BEGIN CATCH IF ERROR_NUMBER() NOT IN (${IGNORE_ERRORS}) THROW; END CATCH`;
function rewriteInsert(tokens, sql, finish) {
  const p = insertParts(tokens, sql);
  if (!p || p.mode === 'abort' || p.mode === 'fail' || p.mode === 'rollback') return null;
  const head = `INSERT INTO ${p.table} (${p.columns.map(bracket).join(',')}) ${p.source}`;
  if (!p.mode && !p.conflict) return p.implicit ? finish(head) : null;
  if (p.mode === 'ignore' || (p.conflict && p.conflict.action === 'nothing')) {
    // Row by row for INSERT … SELECT would be needed to skip only the conflicting rows; a single conflict skips the statement.
    return tryInsert(finish(head));
  }
  if (p.mode === 'replace') {
    if (!p.values) throw new UnsupportedSql('INSERT OR REPLACE … SELECT', sql);
    const keys = p.conflict?.target?.length ? p.conflict.target : primaryKey(p.table);
    if (!keys.length) throw new UnsupportedSql(`INSERT OR REPLACE into ${p.table}, which has no primary key`, sql);
    return finish(`DELETE FROM ${p.table} WHERE ${keys.map(k => `${bracket(k)}=${p.values[p.columns.indexOf(k)]}`).join(' AND ')}; ${head}`);
  }
  if (p.conflict && p.conflict.action === 'update') {
    if (!p.values) throw new UnsupportedSql('INSERT … SELECT … ON CONFLICT DO UPDATE', sql);
    if (!p.conflict.target.length) throw new UnsupportedSql('ON CONFLICT DO UPDATE without a target', sql);
    const valueOf = column => { const at = p.columns.indexOf(column); if (at < 0) throw new UnsupportedSql(`excluded.${column} (not inserted)`, sql); return `(${p.values[at]})`; };
    // excluded.col → the inserted value; bare columns refer to the existing row.
    const replaceExcluded = list => {
      const out = [];
      for (let n = 0; n < list.length; n++) {
        if (isWord(list[n], 'excluded') && list[n + 1]?.type === '.' && list[n + 2]) { out.push(raw(valueOf(list[n + 2].text.replace(/^\[|\]$/g, '')))); n += 2; }
        // Inside a rewritten function call (for example GREATEST(next_offset,excluded.next_offset)).
        else if (list[n].type === 'raw') out.push(raw(list[n].text.replace(/\bexcluded\.\[?(\w+)\]?/gi, (_, column) => valueOf(column))));
        else out.push(list[n]);
      }
      return text(out);
    };
    const keyMatch = p.conflict.target.map(k => `${bracket(k)}=${valueOf(k)}`).join(' AND ');
    const set = replaceExcluded(p.conflict.set), extra = p.conflict.where ? ` AND (${replaceExcluded(p.conflict.where)})` : '';
    return finish(`IF EXISTS (SELECT 1 FROM ${p.table} WITH (UPDLOCK, HOLDLOCK) WHERE ${keyMatch}) UPDATE ${p.table} SET ${set} WHERE ${keyMatch}${extra}; ELSE ${head}`);
  }
  return null;
}

// Columns (in SQLite order), the IDENTITY column and the primary key per table, read once from the generated schema.
let schema = null;
function tableInfo(table) {
  if (!schema) {
    schema = new Map();
    // Next bundles this file into .next/server/chunks, where __dirname no longer holds the schema; fall back to the
    // source tree. A Windows checkout may have CRLF line ends, which the table regex below does not expect.
    const fs = require('node:fs'), path = require('node:path');
    const file = [path.join(__dirname, 'mssql-schema.sql'), path.join(process.cwd(), 'lib', 'db', 'mssql-schema.sql')].find(f => fs.existsSync(f));
    if (!file) throw new Error('lib/db/mssql-schema.sql not found (run the server from crewinjob-web).');
    const ddl = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    for (const m of ddl.matchAll(/CREATE TABLE \[(\w+)\] \(\n([\s\S]*?)\n\);/g)) {
      const lines = m[2].split('\n'), columns = [], info = { columns, identity: null, key: [], syntheticRowid: false };
      for (const line of lines) {
        const column = /^\s+\[(\w+)\] /.exec(line);
        if (column) {
          if (column[1] === 'rowid' && /IDENTITY/.test(line)) { info.syntheticRowid = true; continue; }
          columns.push(column[1]);
          if (/IDENTITY/.test(line)) info.identity = column[1];
        }
        const pk = /PRIMARY KEY NONCLUSTERED \(([^)]*)\)/.exec(line);
        if (pk) info.key = pk[1].split(',').map(c => c.trim().replace(/^\[|\]$/g, ''));
      }
      schema.set(m[1], info);
    }
  }
  return schema.get(table.replace(/^\[|\]$/g, '')) || null;
}
const primaryKey = table => tableInfo(table)?.key || [];

// ---------- entry ----------
const cache = new Map();
// Returns { sql, count }: the T-SQL text with @p1…@pN in the order of the original ? parameters.
function translate(sql) {
  const key = sql;
  if (cache.has(key)) return cache.get(key);
  // "Does this table exist?" checks read SQLite's catalog; SQL Server's is sys.tables.
  sql = sql.replace(/\bFROM\s+sqlite_(?:schema|master)\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=/gi, 'FROM sys.tables WHERE name=');
  if (/\bsqlite_(schema|master|sequence)\b/i.test(sql)) throw new UnsupportedSql('a query of the SQLite catalog', sql);
  let tokens = tokenize(sql);
  // 1. Parameters keep their order: number them before anything moves.
  let n = 0;
  tokens = tokens.map(t => (t.type === 'param' ? { type: 'param', text: `@p${++n}` } : t));
  // 2. Words: reserved names bracketed, COLLATE NOCASE, LIKE case-insensitive.
  tokens = tokens.map((t, i) => {
    if (t.type !== 'word') return t;
    const w = t.text.toLowerCase();
    if (w === 'nocase' && isWord(tokens[prev(tokens, i)], 'collate')) return raw(NOCASE);
    if (RESERVED.has(w)) {
      const before = tokens[prev(tokens, i)], after = tokens[next(tokens, i)];
      // Keep keywords in DDL ("PRIMARY KEY", "DEFAULT …") and "TOP".
      if (isWord(before, 'primary', 'foreign') || (w === 'default' && !(before && before.type === '.')) || w === 'top' || w === 'check' || w === 'identity') return t;
      if (after && after.type === '(' && w !== 'key') return t;
      return { type: 'id', text: `[${t.text}]` };
    }
    return t;
  });
  for (let i = 0; i < tokens.length; i++) {
    if (isWord(tokens[i], 'glob')) {
      // GLOB is a case-sensitive LIKE with * and ?; the BIN2 columns keep the case sensitivity.
      const j = next(tokens, i);
      if (tokens[j]?.type !== 'str') throw new UnsupportedSql('GLOB with a non-literal pattern', sql);
      tokens[i] = { type: 'word', text: 'LIKE' };
      tokens[j] = { type: 'str', text: tokens[j].text.replace(/[_%]/g, '[$&]').replace(/\*/g, '%').replace(/\?/g, '_') };
      tokens.splice(j + 1, 0, raw(' COLLATE Latin1_General_100_BIN2'));
      continue;
    }
    if (isWord(tokens[i], 'like')) {
      // LIKE <operand> → LIKE <operand> COLLATE CI (SQLite's LIKE ignores ASCII case).
      let j = next(tokens, i);
      if (tokens[j] && tokens[j].type === '(') j = close(tokens, j);
      if (tokens[j] && !isWord(tokens[next(tokens, j)], 'collate', 'escape')) tokens.splice(j + 1, 0, raw(` COLLATE ${NOCASE}`));
    }
  }
  // 3. Functions and value predicates.
  if (tokens.some(t => isWord(t, 'json_group_array'))) { const r = rewriteJsonGroupArray(tokens); if (!r) throw new UnsupportedSql('json_group_array outside a scalar subquery', sql); tokens = r; }
  tokens = rewriteFunctions(tokens, sql);
  tokens = rewriteSelectPredicates(tokens);
  tokens = rewriteOrderPredicates(tokens);
  tokens = rewriteHavingAliases(tokens);
  tokens = rewriteBareBooleans(tokens);
  tokens = aliasDerivedTables(tokens);
  // 4. LIMIT / OFFSET.
  tokens = rewriteLimit(tokens, sql);
  // 5. String concatenation.
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'op' && tokens[i].text === '||') tokens[i] = raw('+');
  // 6. INSERT OR … / ON CONFLICT.
  const out = rewriteInsert(tokens, sql, s => s);
  const result = { sql: (out || text(tokens)).trim().replace(/;\s*$/, ''), count: n };
  cache.set(key, result);
  return result;
}

module.exports = { translate, tokenize, UnsupportedSql };

// Row helpers shared by the SQL Server copy (scripts/mssql-copy.cjs) and the SQL Server backup and drill
// (scripts/lib/mssql-backup.mjs): typed parameters by target column type, and one canonical hash of a table's values
// that is the same whether the rows come from SQLite or SQL Server.
const crypto = require('node:crypto');
const sql = require('mssql');

const q = name => `[${String(name).replace(/]/g, ']]')}]`;

// Value as SQL Server parameter, by the target column type.
function bind(request, name, type, value) {
  if (value === null || value === undefined) {
    request.input(name, type === 'varbinary' ? sql.VarBinary(sql.MAX) : type === 'bigint' ? sql.BigInt : type === 'float' ? sql.Float : sql.NVarChar(sql.MAX), null);
  } else if (type === 'bigint') {
    request.input(name, sql.BigInt, typeof value === 'bigint' ? value.toString() : value);
  } else if (type === 'float') {
    request.input(name, sql.Float, Number(value));
  } else if (type === 'varbinary') {
    request.input(name, sql.VarBinary(sql.MAX), Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  } else {
    request.input(name, sql.NVarChar(sql.MAX), Buffer.isBuffer(value) ? value.toString() : String(value));
  }
}

// One canonical text per value, the same for both databases.
function canonical(value, type) {
  if (value === null || value === undefined) return 'N';
  if (Buffer.isBuffer(value)) return 'B' + value.toString('hex');
  if (type === 'float') return 'F' + String(Number(value));
  if (type === 'bigint') return 'I' + String(value);
  return 'S' + String(value);
}
function tableHash(rows, columns, types) {
  const lines = rows.map(row => JSON.stringify(columns.map(c => canonical(row[c], types[c])))).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

// A table's columns on SQL Server, in order: name, type and whether it is the IDENTITY column.
async function targetColumns(request, table) {
  const result = await request.input('t', sql.NVarChar(256), table).query(
    'SELECT c.name, TYPE_NAME(c.user_type_id) type, c.is_identity FROM sys.columns c WHERE c.object_id=OBJECT_ID(@t) ORDER BY c.column_id');
  return result.recordset;
}

module.exports = { q, bind, canonical, tableHash, targetColumns };

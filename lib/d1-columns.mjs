// Shared by the worker and the migration/import scripts: one D1 table per data source,
// one column per Airtable field (named exactly as in Airtable), so the D1 console reads like the base.
export const SYSTEM = ['id', 'created_time', 'updated_time'];

export function sqlType(field) {
  if (['NUMBER', 'CURRENCY', 'PERCENT', 'ROLLUP'].includes(field.type)) return 'REAL';
  if (field.type === 'FORMULA') return field.rawOptions?.result?.type === 'number' ? 'REAL' : 'TEXT';
  if (field.type === 'CHECKBOX') return 'INTEGER';
  return 'TEXT'; // text, select, dates (ISO strings), linked records (JSON array of record ids)
}

export const quote = name => '"' + String(name).replaceAll('"', '""') + '"';

// Airtable value -> D1 cell.
export function toCell(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'CHECKBOX') return value ? 1 : 0;
  if (field.type === 'LINKED_RECORD') return JSON.stringify(value);
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}

// D1 cell -> Airtable value.
export function fromCell(field, cell) {
  if (cell === null || cell === undefined) return undefined;
  if (field.type === 'CHECKBOX') return !!cell;
  if (field.type === 'LINKED_RECORD') { try { return JSON.parse(cell); } catch { return []; } }
  return cell;
}

export function createSql(config) {
  const out = [];
  for (const [key, s] of Object.entries(config.sources)) {
    const cols = s.fields.map(f => `  ${quote(f.name)} ${sqlType(f)}`);
    out.push(`-- ${s.table} (Airtable ${s.tableId})\nCREATE TABLE IF NOT EXISTS ${quote(key)} (\n  "id" TEXT PRIMARY KEY,\n  "created_time" TEXT NOT NULL,\n  "updated_time" TEXT NOT NULL,\n${cols.join(',\n')}\n);`);
  }
  out.push(`-- Every create, update and delete, with the before and after values.
CREATE TABLE IF NOT EXISTS "audit_log" (
  "seq" INTEGER PRIMARY KEY AUTOINCREMENT,
  "at" TEXT NOT NULL,
  "actor" TEXT,
  "table_key" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" TEXT,
  "after" TEXT
);
CREATE INDEX IF NOT EXISTS "audit_log_record" ON "audit_log" ("table_key", "record_id");`);
  return out.join('\n\n') + '\n';
}

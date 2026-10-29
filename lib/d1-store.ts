import {env} from 'cloudflare:workers';
import {SYSTEM, fromCell, quote, toCell} from './d1-columns.mjs';

// Answers the subset of the Airtable REST API the data route uses (list, get, create, update, delete),
// backed by the BH_DATA D1 database, so the route's validation and conflict checks stay unchanged.
type Source = {tableId: string; table: string; fields: any[]};

function db(): D1Database {
  const d = (env as any).BH_DATA as D1Database | undefined;
  if (!d) throw new Error('503:The BH database is not connected.');
  return d;
}

// Airtable formulas the dashboard depends on; recomputed on every write.
function computed(table: string, f: Record<string, any>): Record<string, any> {
  if (table !== 'Pay Log') return {};
  const hours = Number(f['Hours Worked'] ?? 0), rate = Number(f['Hourly Rate Snapshot'] ?? 0);
  const base = hours * rate;
  return {'Base Pay': base, 'Total Pay': base + Number(f['Bonus'] ?? 0) - Number(f['Deductions'] ?? 0), 'Pay Period': f['Work Date'] ? String(f['Work Date']).slice(0, 7) : null};
}

const newId = () => 'rec' + Array.from(crypto.getRandomValues(new Uint8Array(14)), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');

function toRecord(s: Source, row: any, only?: Set<string>) {
  const fields: Record<string, any> = {};
  for (const f of s.fields) {
    if (only && !only.has(f.name)) continue;
    const v = fromCell(f, row[f.name]);
    if (v !== undefined) fields[f.name] = v;
  }
  return {id: row.id, createdTime: row.created_time, fields};
}

export async function d1Request(sources: Record<string, Source>, path: string, init: RequestInit, actor: string | null): Promise<any> {
  const [route, qs = ''] = path.split('?');
  const [tableId, recordId] = route.split('/');
  const entry = Object.entries(sources).find(([, s]) => s.tableId === tableId);
  if (!entry) throw new Error('404:Unknown data source.');
  const [key, s] = entry, t = quote(key), method = init.method || 'GET';
  const field = (name: string) => s.fields.find(f => f.name === name);
  const get = async (id: string) => {
    const row = await db().prepare(`SELECT * FROM ${t} WHERE id = ?`).bind(id).first();
    if (!row) throw new Error('404:That record no longer exists. Refresh and try again.');
    return row;
  };

  if (method === 'GET' && recordId) return toRecord(s, await get(recordId));
  if (method === 'GET') {
    const q = new URLSearchParams(qs), only = q.getAll('fields[]');
    const size = Math.min(100, Math.max(1, Number(q.get('pageSize') || 100))), offset = Math.max(0, Number(q.get('offset') || 0));
    const sortField = q.get('sort[0][field]'), dir = q.get('sort[0][direction]') === 'desc' ? 'DESC' : 'ASC';
    const order = sortField && field(sortField) ? `${quote(sortField)} ${dir}, created_time` : 'created_time, id';
    const {results} = await db().prepare(`SELECT * FROM ${t} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(size + 1, offset).all();
    const records = results.slice(0, size).map(r => toRecord(s, r, only.length ? new Set(only) : undefined));
    return results.length > size ? {records, offset: String(offset + size)} : {records};
  }

  const now = new Date().toISOString();
  const audit = (id: string, action: string, before: any, after: any) => db().prepare('INSERT INTO "audit_log" (at, actor, table_key, record_id, action, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now, actor, key, id, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);

  if (method === 'DELETE') {
    const before = toRecord(s, await get(recordId));
    await db().batch([db().prepare(`DELETE FROM ${t} WHERE id = ?`).bind(recordId), audit(recordId, 'delete', before.fields, null)]);
    return {id: recordId, deleted: true};
  }

  const body = JSON.parse(String(init.body || '{}'));
  const input: Record<string, any> = body.fields || {};
  for (const name of Object.keys(input)) if (!field(name)) throw new Error('400:Unknown field.');
  const before = method === 'PATCH' ? toRecord(s, await get(recordId)) : null;
  const merged = {...before?.fields, ...input};
  const fields = {...input, ...computed(s.table, merged)};
  const id = recordId || newId();
  const names = Object.keys(fields).filter(n => field(n) && !SYSTEM.includes(n));
  const cells = names.map(n => toCell(field(n), fields[n]));
  const stmt = method === 'POST'
    ? db().prepare(`INSERT INTO ${t} (id, created_time, updated_time${names.map(n => ', ' + quote(n)).join('')}) VALUES (?, ?, ?${names.map(() => ', ?').join('')})`).bind(id, now, now, ...cells)
    : db().prepare(`UPDATE ${t} SET updated_time = ?${names.map(n => ', ' + quote(n) + ' = ?').join('')} WHERE id = ?`).bind(now, ...cells, id);
  await db().batch([stmt, audit(id, method === 'POST' ? 'create' : 'update', before?.fields ?? null, {...merged, ...fields})]);
  return toRecord(s, await get(id));
}

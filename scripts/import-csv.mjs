import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {sqlType} from '../lib/d1-columns.mjs';

const config = JSON.parse(fs.readFileSync('lib/data-config.json'));
const sources = Object.entries(config.sources);
const ids = new Set();
function newId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id;
  do { id = 'rec' + Array.from(randomBytes(14), n => alphabet[n % 62]).join(''); } while (ids.has(id));
  ids.add(id);
  return id;
}
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw Error('Unterminated quoted CSV field');
  if (row.length || cell) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length) throw Error('Invalid CSV headers');
  return {headers, rows: rows.map((r, i) => { if (r.length !== headers.length) throw Error(`Bad CSV row ${i + 2}`); return Object.fromEntries(headers.map((h, j) => [h, r[j]])); })};
}
const data = {}, dump = {}, createdTime = new Date().toISOString();
for (const [key, s] of sources) {
  const csv = parseCsv(fs.readFileSync(`backups/csv/${s.table}-Grid view.csv`, 'utf8'));
  const expected = s.fields.map(f => f.name);
  const missing = expected.filter(n => !csv.headers.includes(n));
  const extra = csv.headers.filter(n => !expected.includes(n));
  if (missing.length || extra.length) throw Error(`${s.table}: missing ${missing}; unknown ${extra}`);
  data[key] = csv.rows;
  dump[key] = csv.rows.map(() => ({id: newId(), createdTime, fields: {}}));
}
const unresolved = [];
for (const [key, s] of sources) for (let i = 0; i < data[key].length; i++) {
  for (const f of s.fields) {
    const value = data[key][i][f.name];
    if (!value) continue;
    if (f.type === 'LINKED_RECORD') {
      if (key === 'models' || (key === 'staff' && f.name !== 'Model')) continue;
      const target = sources.find(([, t]) => t.tableId === f.rawOptions?.linkedTableId);
      if (!target) throw Error(`Unknown linked table: ${s.table}.${f.name}`);
      const [tk, ts] = target;
      const matches = value.split(',').map(n => n.trim()).map(name => {
        const found = data[tk].flatMap((r, j) => r[ts.primaryField] === name ? [dump[tk][j].id] : []);
        if (found.length !== 1) unresolved.push(`${s.table} row ${i + 2} ${f.name}: ${JSON.stringify(name)} (${found.length} matches)`);
        return found[0];
      });
      dump[key][i].fields[f.name] = matches;
    } else if (f.type === 'CHECKBOX') {
      if (value !== 'checked') throw Error(`Unexpected checkbox ${s.table}.${f.name}: ${value}`);
      dump[key][i].fields[f.name] = true;
    } else if (f.type === 'DATETIME') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw Error(`Invalid date ${s.table}.${f.name}: ${value}`);
      dump[key][i].fields[f.name] = value;
    } else if (sqlType(f) === 'REAL') {
      const number = Number(value.replace(/[$,\s%]/g, ''));
      if (!Number.isFinite(number)) throw Error(`Invalid number ${s.table}.${f.name}: ${value}`);
      dump[key][i].fields[f.name] = f.type === 'PERCENT' && value.includes('%') ? number / 100 : number;
    } else dump[key][i].fields[f.name] = value;
  }
}
if (unresolved.length) { console.error(unresolved.join('\n')); process.exit(1); }
fs.writeFileSync('backups/airtable-csv.json', JSON.stringify(dump));
console.log('Saved backups/airtable-csv.json');

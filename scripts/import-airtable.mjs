// One-time move of every BH Airtable record into the BH_DATA D1 database.
//   node --env-file=.env.local scripts/import-airtable.mjs export   -> backups/airtable-<time>.json + .sql
//   npx wrangler d1 execute bh-data --remote --file backups/airtable-<time>.sql
//   node scripts/import-airtable.mjs verify backups/airtable-<time>.json
//   node scripts/import-airtable.mjs sql backups/airtable-<time>.json     (rebuild SQL from a backup)
// Record ids are kept, so linked records stay linked. Re-running replaces rows; nothing in Airtable changes.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {quote, toCell} from '../lib/d1-columns.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../lib/data-config.json', import.meta.url)));
const [step, file] = process.argv.slice(2);
const pause = ms => new Promise(r => setTimeout(r, ms));

async function fetchTable(tableId) {
  const records = [];
  let offset = '';
  do {
    const url = `https://api.airtable.com/v0/${config.baseId}/${tableId}?pageSize=100${offset ? '&offset=' + offset : ''}`;
    const r = await fetch(url, {headers: {Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN}});
    if (r.status === 429) { await pause(30000); continue; }
    if (!r.ok) throw new Error(`Airtable ${tableId} failed: ${r.status} ${await r.text()}`);
    const page = await r.json();
    records.push(...page.records);
    offset = page.offset || '';
    await pause(250);
  } while (offset);
  return records;
}

const literal = v => v === null ? 'NULL' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL') : `'${String(v).replaceAll("'", "''")}'`;

function toSql(dump) {
  const lines = [];
  for (const [key, s] of Object.entries(config.sources)) {
    for (const rec of dump[key]) {
      const known = s.fields.filter(f => Object.hasOwn(rec.fields, f.name));
      const cols = ['id', 'created_time', 'updated_time', ...known.map(f => f.name)].map(quote).join(', ');
      const vals = [rec.id, rec.createdTime, rec.createdTime, ...known.map(f => toCell(f, rec.fields[f.name]))].map(literal).join(', ');
      lines.push(`INSERT OR REPLACE INTO ${quote(key)} (${cols}) VALUES (${vals});`);
    }
  }
  return lines.join('\n') + '\n';
}

// Row counts plus a numeric total per table, compared between the Airtable dump and D1.
function fingerprint(dump) {
  const out = {};
  for (const [key, s] of Object.entries(config.sources)) {
    const nums = s.fields.filter(f => ['NUMBER', 'CURRENCY', 'PERCENT'].includes(f.type)).map(f => f.name);
    out[key] = {rows: dump[key].length, sums: Object.fromEntries(nums.map(n => [n, Math.round(dump[key].reduce((a, r) => a + (Number(r.fields[n]) || 0), 0) * 100) / 100]))};
  }
  return out;
}

if (step === 'export') {
  if (!process.env.AIRTABLE_TOKEN) throw new Error('Set AIRTABLE_TOKEN in .env.local first.');
  const dump = {};
  for (const [key, s] of Object.entries(config.sources)) {
    dump[key] = await fetchTable(s.tableId);
    console.log(`${s.table}: ${dump[key].length} records`);
  }
  const unknown = Object.entries(config.sources).flatMap(([key, s]) => dump[key].flatMap(r => Object.keys(r.fields).filter(n => !s.fields.some(f => f.name === n)).map(n => `${s.table}.${n}`)));
  if (unknown.length) console.warn('Fields in Airtable with no D1 column (kept in the JSON backup only):', [...new Set(unknown)].join(', '));
  fs.mkdirSync('backups', {recursive: true});
  const base = `backups/airtable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(base + '.json', JSON.stringify(dump));
  fs.writeFileSync(base + '.sql', toSql(dump));
  console.log(`Saved ${base}.json (full backup) and ${base}.sql`);
} else if (step === 'sql') {
  // Rebuild the SQL from a saved backup, e.g. to restore it.
  fs.writeFileSync(file.replace(/\.json$/, '.sql'), toSql(JSON.parse(fs.readFileSync(file))));
  console.log('Wrote ' + file.replace(/\.json$/, '.sql'));
} else if (step === 'verify') {
  const want = fingerprint(JSON.parse(fs.readFileSync(file)));
  let ok = true;
  for (const [key, w] of Object.entries(want)) {
    const sums = Object.keys(w.sums).map(n => `ROUND(COALESCE(SUM(${quote(n)}), 0), 2) AS ${quote(n)}`);
    const sql = `SELECT COUNT(*) AS rows${sums.map(s => ', ' + s).join('')} FROM ${quote(key)}`;
    const got = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'bh-data', '--remote', '--json', '--command', sql], {encoding: 'utf8'}))[0].results[0];
    const bad = [['rows', w.rows, got.rows], ...Object.entries(w.sums).map(([n, v]) => [n, v, got[n]])].filter(([, a, b]) => Math.abs(a - b) > 0.01);
    console.log(`${bad.length ? 'MISMATCH' : 'ok      '} ${key}: ${got.rows}/${w.rows} rows${bad.length ? ' ' + JSON.stringify(bad) : ''}`);
    if (bad.length) ok = false;
  }
  if (!ok) process.exitCode = 1;
  else console.log('Every table matches Airtable.');
} else {
  console.log('Usage: import-airtable.mjs export | sql <backup.json> | verify <backup.json>');
}

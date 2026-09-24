const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');

const source = fs.readFileSync(__dirname + '/../lib/finance.ts', 'utf8');
const code = source.slice(source.indexOf('const inRange'))
  .replace('export function modelPnL', 'function modelPnL');
const ctx = vm.createContext({
  label: v => typeof v === 'object' ? v?.label ?? '' : String(v ?? ''),
  linkIds: v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x?.id ?? x)),
  num: v => Number(v) || 0,
});
vm.runInContext(stripTypeScriptTypes(code), ctx);
const model = {id: 'm1', fields: {model: 'April', dealType: 'Managed', modelCut: 25}};
const base = {staff: [], paylog: [], map: [{fields: {model: [{id: 'm1'}], accountId: 1, include: true}}], creators: [{id: '1', net: 100}], start: '2026-09-24', end: '2026-09-24', revenueKnown: true};
const expenses = [{fields: {date: '2026-09-24', amount: 40, status: 'Paid', model: []}}];
let result = ctx.modelPnL(model, {...base, expenses});
assert.equal(result.expenses, 0, 'unassigned expense must not be duplicated across models');
assert.equal(result.profit, 75);
result = ctx.modelPnL({...model, fields: {...model.fields, dealType: ''}}, {...base, expenses: []});
assert.equal(result.income, null, 'unknown deal cannot become Managed revenue');
assert.equal(result.profit, null);
console.log('PASS: unassigned expenses excluded; unknown deal blocks profit');

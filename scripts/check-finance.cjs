const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');

const source = fs.readFileSync(__dirname + '/../lib/finance.ts', 'utf8');
const code = source.slice(source.indexOf('const inRange'))
  .replaceAll('export function ', 'function ');
const ctx = vm.createContext({
  label: v => typeof v === 'object' ? v?.label ?? '' : String(v ?? ''),
  linkIds: v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x?.id ?? x)),
  num: v => Number(v) || 0,
});
vm.runInContext(stripTypeScriptTypes(code), ctx);
const model = {id: 'm1', fields: {model: 'April', dealType: 'Managed', modelCut: 25}};
const base = {staff: [], paylog: [], map: [{fields: {model: [{id: 'm1'}], accountId: 1, include: true}}], creators: [{id: '1', name: 'April', net: 100}], accountRevenue: 100, start: '2026-09-24', end: '2026-09-24', revenueKnown: true};
const expenses = [{fields: {date: '2026-09-24', amount: 40, status: 'Paid', model: []}}];
let result = ctx.modelPnL(model, {...base, expenses});
assert.equal(result.expenses, 0, 'unassigned expense must not be duplicated across models');
assert.equal(result.profit, 75);
result = ctx.modelPnL({...model, fields: {...model.fields, dealType: ''}}, {...base, expenses: []});
assert.equal(result.income, null, 'unknown deal cannot become Managed revenue');
assert.equal(result.profit, null);
console.log('PASS: unassigned expenses excluded; unknown deal blocks profit');

const staff = [{id: 's1', fields: {name: 'Ana', model: [{id: 'm1'}, {id: 'm2'}]}}, {id: 's2', fields: {name: 'Bo', model: [{id: 'm2'}]}}];
const wages = new Map([['s1', {hours: 20, pay: 100, unpaid: 40}], ['s2', {hours: 5, pay: 50, unpaid: 50}]]);
const paylog = [{fields: {workDate: '2026-09-24', staff: ['s1'], hours: 99, totalPay: 999}}];
const split = [{fields: {date: '2026-09-24', amount: 30, status: 'Paid', model: [{id: 'm1'}, {id: 'm2'}], category: 'Ads'}}];
result = ctx.modelPnL(model, {...base, staff, paylog, wages, expenses: split});
assert.equal(result.wages, 50, 'pay-run wages split evenly across a VA\'s models; Pay Log ignored');
assert.equal(result.unpaidWages, 20);
assert.equal(result.byStaff.length, 1, 'staff on other models excluded');
assert.equal(result.expenses, 15, 'multi-model expense split amount/N');
assert.equal(result.profit, 100 - 25 - 50 - 15);
assert.equal(ctx.modelPnL(model, {...base, staff, paylog, expenses: []}).wages, 999 / 2, 'no wages map falls back to Pay Log');
console.log('PASS: pay-run wages and multi-model expense split');

const dapRow = {fields: {model: ['m1'], slug: 'Dap'}};
assert.equal(ctx.dapRevenueFor('m1', [], ['m1'], true, {}), 0, 'no DAP account means zero');
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], true, {dap: {net: null}}), null, 'failed DAP account remains unknown');
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], true, {dap: {net: 42}}), 42);
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], false, {}), null, 'unavailable directory remains unknown');
assert.equal(ctx.dapRevenueFor('m1', [{fields:{model:['m1','m2'], slug:'dap'}}], ['m1','m2'], true, {dap:{net:42}}), null, 'shared account is not double counted');

assert.equal(ctx.completeDapMonth(['1', '2'], [{account_id:1},{account_id:2}]), true);
assert.equal(ctx.completeDapMonth(['1', '2'], [{account_id:1}]), false, 'partial historical totals must stay unknown');
assert.equal(ctx.completeDapMonth([], undefined), false, 'missing month is not zero');

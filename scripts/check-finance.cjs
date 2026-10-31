const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');

const source = fs.readFileSync(__dirname + '/../lib/finance.ts', 'utf8');
const code = source.slice(source.indexOf('const inRange'))
  .replaceAll('export function ', 'function ').replaceAll('export const ', 'var ');
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
// A synced model with no deal and no counted account (dapRevenueFor gives 0) must not blank the totals.
result = ctx.modelPnL({id: 'm1', fields: {model: 'Synced'}}, {...base, accountRevenue: 0, expenses, sharedAcross: ['m1', 'm2']});
assert.equal(result.income, 0, 'no revenue is $0 income under any deal');
assert.equal(result.payout, 0);
assert.equal(result.profit, -20, 'still carries its share of costs');
assert.equal(ctx.dapRevenueFor('m1', [], ['m1'], true, {}), 0, 'every account off = $0 revenue');
result = ctx.modelPnL(model, {...base, expenses, sharedAcross: ['m1', 'm2']});
assert.equal(result.expenses, 20, 'shared expense split evenly across live models');
assert.equal(ctx.modelPnL({id: 'm3', fields: model.fields}, {...base, expenses, sharedAcross: ['m1', 'm2']}).expenses, 0, 'ended model gets no share');
console.log('PASS: shared expenses split across live models only when asked; unknown deal blocks profit');

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
// Staff with no live model (none, or only an ended one) split across the live models, so model wages add up to the pay run.
const loose = [{id: 's3', fields: {name: 'Ivy', model: []}}, {id: 's4', fields: {name: 'Tom', model: [{id: 'm9'}]}}];
const looseW = new Map([['s3', {hours: 10, pay: 40, unpaid: 0}], ['s4', {hours: 10, pay: 20, unpaid: 0}]]);
assert.equal(ctx.modelPnL(model, {...base, staff: loose, wages: looseW, expenses: [], sharedAcross: ['m1', 'm2']}).wages, 30);
assert.equal(ctx.modelPnL(model, {...base, staff: loose, wages: looseW, expenses: []}).wages, 0, 'no sharedAcross: unassigned wages stay out');
console.log('PASS: pay-run wages and multi-model expense split');

const dapRow = {fields: {model: ['m1'], slug: 'Dap'}};
assert.equal(ctx.dapRevenueFor('m1', [], ['m1'], true, {}), 0, 'no DAP account means zero');
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], true, {dap: {net: null}}), null, 'failed DAP account remains unknown');
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], true, {dap: {net: 42}}), 42);
assert.equal(ctx.dapRevenueFor('m1', [dapRow], ['m1'], false, {}), null, 'unavailable directory remains unknown');
assert.equal(ctx.dapRevenueFor('m1', [{fields:{model:['m1','m2'], slug:'dap'}}], ['m1','m2'], true, {dap:{net:42}}), null, 'shared account is not double counted');

// Sync adds only accounts with no row; an unlinked row (deleted) keeps its account out for good.
const accounts = [{id: 1, slug: 'aria_dap', of_username: 'aria'}, {id: 2, slug: 'bella_dap', of_username: 'bella'}, {id: 3, slug: 'gone', of_username: 'gone'}, {id: 4, slug: 'fresh', of_username: 'fresh'}];
const rows = [{id: 'r1', fields: {accountId: 1, slug: 'aria_dap', model: ['m1']}}, {id: 'r2', fields: {accountId: 99, slug: 'BELLA_DAP', model: ['m2']}}, {id: 'r3', fields: {accountId: 3, slug: 'gone', model: [], include: false}}];
assert.deepEqual(ctx.newAccounts(accounts, rows).map(a => a.slug), ['fresh'], 'deleted and slug-matched accounts are not new');
const linked = ctx.accountRows(accounts, rows);
assert.deepEqual(linked.map(r => r.id), ['r1', 'r2'], 'deleted rows and unsynced accounts are not listed');
assert.equal(linked[1].fields.accountId, 2, 'Creatorstaq id wins over a hand-typed one');

// Monthly history: counted rows carry Creatorstaq's numeric id; entries match by id (number or string) or slug,
// net as `net` or `net_amount` decimal strings; current/partial and malformed months are dropped.
const counted = [{id: 'r1', fields: {accountId: 329, slug: 'aria_dap', model: ['m1']}}, {id: 'r2', fields: {accountId: 341, slug: 'bella_dap', model: ['m2']}}];
const buckets = [
  {month: '2026-09', accounts: [{account_id: 329, net: '1000.50'}, {account_id: '341', net_amount: '200.25'}, {account_id: 288, net: '999.00'}]},
  {month: '2026-08-01', accounts: [{slug: 'ARIA_DAP', net: '900.00'}]},
  {month: '2026-10', accounts: [{account_id: 329, net: '50.00'}]},
  {month: '2026-07', accounts: null},
];
let h = ctx.monthlyHistory(buckets, counted, '2026-10');
assert.deepEqual(h.chart.map(r => [r.month, r.total]), [['2026-07', 0], ['2026-08', 900], ['2026-09', 1200.75]], 'finished months only, sorted, uncounted accounts ignored');
assert.equal(h.chart[2].by.m2, 200.25);
assert.equal(h.why, null);
assert.deepEqual(h.missing, []);
assert.equal(ctx.monthlyHistory([], counted, '2026-10').why, 'Creatorstaq returned no finished months');
assert.equal(ctx.monthlyHistory(buckets, [], '2026-10').why, 'No counted accounts');
h = ctx.monthlyHistory([{month: '2026-09', accounts: [{account_id: 288, net: '5.00'}]}], counted, '2026-10');
assert.equal(h.why, 'No history for counted accounts (aria_dap, bella_dap)', 'new accounts with no history say so');
assert.deepEqual(ctx.monthlyHistory(buckets.slice(1, 2), counted, '2026-10').missing, ['bella_dap'], 'partly new accounts listed, history still shown');
console.log('PASS: monthly history matches counted accounts and explains blanks');

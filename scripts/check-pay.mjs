// Pay run rules: node scripts/check-pay.mjs
import assert from 'node:assert/strict';
import {periodOf, calcPay, wagesFor, offForDays, daysPerWeek, inPeriod} from '../lib/pay.ts';

const p = periodOf('2026-10-29');
assert.equal(p.key, '2026-10-16'); assert.equal(p.end, '2026-10-31'); assert.equal(p.payDate, '2026-11-01'); assert.equal(p.label, 'Oct 16 – 31');
assert.equal(periodOf('2026-02-03').end, '2026-02-15'); assert.equal(periodOf('2028-02-20').end, '2028-02-29');
assert.deepEqual(offForDays(6), [0]); assert.deepEqual(offForDays(5), [0, 6]); assert.deepEqual(offForDays(7), []); assert.equal(daysPerWeek(null), 6);

const today = '2026-10-29'; // Thursday
const ana = {id: 'ana', name: 'Ana', rate: 3, std: 8, off: [0]};
const hours = new Map([['ana', new Map([
  ['2026-10-16', 8], ['2026-10-17', 10],   // 2h over: held
  ['2026-10-19', 0],                        // missed
  ['2026-10-20', 6],                        // short (excused below)
  ['2026-10-25', 3],                        // Sunday: day off, all held
])]]);
const data = {hours, status: new Map(), va: new Map([['2026-10-16|ana', {checked: true, sent: false, held: null, excused: ['2026-10-20'], snap: null}]]),
  adjustments: new Map([['2026-10-16|ana', [{type: 'Bonus', value: 10, hours: null}, {type: 'Deduction', value: -5, hours: null}, {type: 'Extra hours', value: null, hours: 2}]]])};
let c = calcPay(data, p, ana, today);
assert.equal(c.payable, 8 + 8 + 0 + 6); assert.equal(c.held, 2 + 3);
assert.deepEqual(c.flags.filter(f => f.kind !== 'gap').map(f => [f.d, f.kind, f.excused]), [['2026-10-19', 'missed', false], ['2026-10-20', 'short', true]]);
assert.equal(c.flags.filter(f => f.kind === 'gap').length, 7);  // blank past scheduled days need a fix too
assert.equal(c.adjSum, 10 - 5 + 6); assert.equal(c.total, 22 * 3 + 11);
assert.equal(c.open, 1 + 1 + 7);                              // the unexcused miss + the undecided held hours + 7 gaps
assert.ok(c.unloggedToday); assert.equal(c.future, 8 + 8 + 8); // today, Fri 30, Sat 31
assert.deepEqual(c.emptyPast, ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28']); // scheduled, past, not logged

// Excusing a gap clears it as a fix and from the fill list; it pays 0.
data.va.get('2026-10-16|ana').excused.push('2026-10-21');
c = calcPay(data, p, ana, today);
assert.equal(c.open, 1 + 1 + 6); assert.ok(!c.emptyPast.includes('2026-10-21'));
// A tick stays only while Staff still has the values it was given at; no snapshot = legacy tick, kept.
assert.equal(c.checked, true);
data.va.get('2026-10-16|ana').snap = {rate: 3, std: 8, off: [0]};
assert.equal(calcPay(data, p, ana, today).checked, true);
assert.equal(calcPay(data, p, {...ana, rate: null}, today).checked, false, 'rate cleared after the tick');
assert.equal(calcPay(data, p, {...ana, std: 6}, today).checked, false);

// Pay as extra: held hours paid; approved snapshot freezes the rate even if the live rate changes.
data.va.get('2026-10-16|ana').held = 'pay';
data.va.get('2026-10-16|ana').snap = {rate: 2, std: 8, off: [0]};
assert.equal(calcPay(data, p, ana, today).rate, 3, 'snapshot ignored while open');
data.status.set('2026-10-16', 'approved');
c = calcPay(data, p, ana, today);
assert.equal(c.rate, 2); assert.equal(c.extra, 5 * 2); assert.equal(c.total, 22 * 2 + 10 * 1 + 10 - 5 + 4);

// No rate is something to fix.
assert.equal(calcPay({hours: new Map(), status: new Map(), va: new Map(), adjustments: new Map()}, p, {...ana, rate: null}, today).noRate, true);

// Wages for a range: daily payable inside it, extras only when the period ends inside it; unpaid until sent/paid.
const w = wagesFor(data, [ana], '2026-10-16', '2026-10-20', today).get('ana');
assert.equal(w.pay, 22 * 2); assert.equal(w.unpaid, 44);
const all = wagesFor(data, [ana], '2026-10-01', '2026-10-31', today).get('ana');
assert.equal(all.pay, c.total);
data.status.set('2026-10-16', 'paid');
assert.equal(wagesFor(data, [ana], '2026-10-01', '2026-10-31', today).get('ana').unpaid, 0);

// Timesheet membership.
const empty = {hours: new Map(), status: new Map(), va: new Map(), adjustments: new Map()};
assert.ok(inPeriod(empty, p, {id: 'x', status: 'Active', payType: 'Hourly', end: null}));
assert.ok(!inPeriod(empty, p, {id: 'x', status: 'Setup', payType: 'Hourly', end: null}));
assert.ok(!inPeriod(empty, p, {id: 'x', status: 'Inactive', payType: 'Hourly', end: '2026-10-01'}));
assert.ok(inPeriod(empty, p, {id: 'x', status: 'Inactive', payType: 'Hourly', end: '2026-10-20'}));
console.log('Pay checks passed: periods, cap and held hours, flags and excuses, adjustments, snapshots, wages by range.');

// Semi-monthly pay run rules (ported from the redesign prototype's bh-store.js: calcPay, wagesFor).
// Pure functions over plain data so Pay & Hours, P&L and Overview compute the same numbers.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Same as lib/bh addDays; repeated so this file has no imports and the check script can load it.
const addDays = (day: string, n: number) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();
const md = (day: string) => MON[Number(day.slice(5, 7)) - 1] + " " + Number(day.slice(8, 10));

export type Period = {key: string; start: string; end: string; payDate: string; label: string; short: string; endLabel: string; payLabel: string};
export type PeriodStatus = "open" | "approved" | "paid";

// Periods run 1st–15th and 16th–month end, paid the next day. The key is the start date.
export function periodOf(day: string): Period {
  const first = Number(day.slice(8, 10)) <= 15, start = day.slice(0, 8) + (first ? "01" : "16");
  const end = first ? day.slice(0, 8) + "15" : addDays(addDays(day.slice(0, 8) + "01", 32).slice(0, 8) + "01", -1);
  const payDate = addDays(end, 1), sameMonth = start.slice(5, 7) === end.slice(5, 7);
  return {key: start, start, end, payDate, label: `${md(start)} – ${sameMonth ? Number(end.slice(8)) : md(end)}`, short: `${md(start)}–${Number(end.slice(8))}`, endLabel: md(end), payLabel: md(payDate)};
}
export const nextPeriod = (p: Period) => periodOf(addDays(p.end, 1));
export const prevPeriod = (p: Period) => periodOf(addDays(p.start, -1));
export function daysOf(p: Period) { const out: string[] = []; for (let d = p.start; d <= p.end; d = addDays(d, 1)) out.push(d); return out; }
export function periodsBetween(start: string, end: string) { const out: Period[] = []; for (let p = periodOf(start); p.start <= end; p = nextPeriod(p)) out.push(p); return out; }

export type VA = {id: string; name: string; rate: number | null; std: number | null; off: number[] | null};
export type Adjustment = {id?: string; type: "Bonus" | "Deduction" | "Extra hours" | "Correction"; value: number | null; hours: number | null; note?: string; forPeriod?: string | null};
export type VAPeriod = {id?: string; checked: boolean; sent: boolean; held: "pay" | "no" | null; excused: string[]; snap: {rate: number | null; std: number | null; off: number[] | null} | null};
// Everything the rules need, keyed by period start and staff record id.
export type PayData = {
  hours: Map<string, Map<string, number | null>>;        // staff -> day -> hours (null = row without hours)
  status: Map<string, PeriodStatus>;                      // period -> status; missing = open
  va: Map<string, VAPeriod>;                              // `${period}|${staff}` -> flags and snapshot
  adjustments: Map<string, Adjustment[]>;                 // `${period}|${staff}` -> adjustments
};
export const vaKey = (period: string, staff: string) => period + "|" + staff;
export const statusOf = (data: PayData, p: Period): PeriodStatus => data.status.get(p.key) ?? "open";
export const vaOf = (data: PayData, p: Period, staff: string): VAPeriod => data.va.get(vaKey(p.key, staff)) ?? {checked: false, sent: false, held: null, excused: [], snap: null};
export const DEFAULT_OFF = [0];

export type Flag = {d: string; kind: "missed" | "short" | "gap"; h: number; std: number; excused: boolean};
export type PayCalc = ReturnType<typeof calcPay>;

// One VA's pay for one period. Logged hours are capped at the scheduled day; anything over is held
// until a manager pays it as extra or not. Short, missed and unlogged past days need a fix or an excuse.
// A tick only counts while the Staff page still has the rate, standard day and days off it was given at.
export function calcPay(data: PayData, p: Period, v0: VA, today: string) {
  const f = vaOf(data, p, v0.id), snap = statusOf(data, p) !== "open" ? f.snap : null;
  const rate = (snap ? snap.rate : v0.rate) ?? 0, std0 = (snap ? snap.std : v0.std) ?? 0, off = (snap ? snap.off : v0.off) ?? DEFAULT_OFF;
  const H = data.hours.get(v0.id), ex = new Set(f.excused);
  let payable = 0, held = 0, sched = 0, schedToDate = 0, future = 0, unloggedToday = false;
  const emptyPast: string[] = [], flags: Flag[] = [], days: {d: string; payable: number; logged: number}[] = [];
  for (const d of daysOf(p)) {
    const isSched = !off.includes(dow(d)), std = isSched ? std0 : 0, h = H?.get(d);
    sched += std;
    if (d <= today) schedToDate += std;
    if (d > today) { future += std; continue; }
    if (h == null) {
      if (isSched && d === today) { unloggedToday = true; future += std; }
      else if (isSched) { flags.push({d, kind: "gap", h: 0, std, excused: ex.has(d)}); if (!ex.has(d)) emptyPast.push(d); }
      continue;
    }
    const pd = Math.min(h, std);
    payable += pd; held += Math.max(0, h - std);
    days.push({d, payable: pd, logged: h});
    if (d < today && isSched && h === 0) flags.push({d, kind: "missed", h, std, excused: ex.has(d)});
    else if (d < today && isSched && h > 0 && h < std) flags.push({d, kind: "short", h, std, excused: ex.has(d)});
  }
  const dec = f.held, heldPaid = held > 0 && dec === "pay" ? held : 0;
  const adjs = data.adjustments.get(vaKey(p.key, v0.id)) ?? [];
  const adjSum = adjs.reduce((s, a) => s + (a.type === "Extra hours" ? (a.hours ?? 0) * rate : a.value ?? 0), 0);
  const base = payable * rate, extra = heldPaid * rate, total = base + extra + adjSum;
  const noRate = !rate, now = {rate: v0.rate, std: v0.std, off: v0.off ?? DEFAULT_OFF};
  const stale = statusOf(data, p) === "open" && !!f.snap && JSON.stringify([f.snap.rate, f.snap.std, f.snap.off ?? DEFAULT_OFF]) !== JSON.stringify([now.rate, now.std, now.off]);
  const open = flags.filter(x => !x.excused).length + (held > 0 && !dec ? 1 : 0) + (noRate ? 1 : 0);
  return {checked: f.checked && !stale, now, rate, std: std0, off, payable, held, dec, heldPaid, sched, schedToDate, future, unloggedToday, emptyPast, flags, adjs, adjSum, base, extra, total, open, days, noRate, projected: total + future * rate};
}

// Who belongs on a period's timesheet: anyone with hours, adjustments or a saved row in it; otherwise
// hourly staff who were active then (Setup only once they log hours, Inactive until their end date).
export type StaffLike = {id: string; status: string; payType: string; end: string | null; start?: string | null};
export function inPeriod(data: PayData, p: Period, s: StaffLike) {
  const H = data.hours.get(s.id);
  if (H && [...H.keys()].some(d => d >= p.start && d <= p.end)) return true;
  if (data.va.has(vaKey(p.key, s.id)) || data.adjustments.has(vaKey(p.key, s.id))) return true;
  if (statusOf(data, p) !== "open") return false;
  if (s.payType && s.payType !== "Hourly") return false;
  if (s.start && s.start > p.end) return false;
  if (s.status === "Active") return true;
  return s.status === "Inactive" && !!s.end && s.end >= p.start;
}

// Wages per VA for [start, end]: each day's payable × rate for days in range, plus the period's held
// extra and adjustments when the period ends in range. Unpaid = periods not paid and VA not sent.
export function wagesFor(data: PayData, vas: VA[], start: string, end: string, today: string) {
  const out = new Map<string, {id: string; name: string; hours: number; pay: number; unpaid: number}>();
  if (start > end) return out;
  const touched = new Set(data.hours.keys());
  for (const k of [...data.va.keys(), ...data.adjustments.keys()]) touched.add(k.split("|")[1]);
  for (const p of periodsBetween(start, end)) {
    const paid = statusOf(data, p) === "paid";
    for (const v of vas) {
      if (!touched.has(v.id)) continue;
      const c = calcPay(data, p, v, today);
      let pay = 0, hours = 0;
      for (const day of c.days) if (day.d >= start && day.d <= end) { pay += day.payable * c.rate; hours += day.payable; }
      if (p.end >= start && p.end <= end) { pay += c.extra + c.adjSum; hours += c.heldPaid; }
      if (!pay && !hours) continue;
      const r = out.get(v.id) ?? {id: v.id, name: v.name, hours: 0, pay: 0, unpaid: 0};
      r.hours += hours; r.pay += pay;
      if (!paid && !vaOf(data, p, v.id).sent) r.unpaid += pay;
      out.set(v.id, r);
    }
  }
  return out;
}

// Days per week (1–7) <-> days off, dropping Sun, Sat, Fri, Thu… in that order.
const DROP = [0, 6, 5, 4, 3, 2, 1];
export const offForDays = (n: number) => DROP.slice(0, 7 - Math.max(1, Math.min(7, Math.round(n)))).sort();
export const daysPerWeek = (off: number[] | null) => 7 - (off ?? DEFAULT_OFF).length;
export function parseOff(v: unknown): number[] | null {
  if (v == null || v === "") return null;
  try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : null; } catch { return null; }
}
export const parseDays = (v: unknown): string[] => { try { const a = JSON.parse(String(v ?? "[]")); return Array.isArray(a) ? a.filter(x => typeof x === "string") : []; } catch { return []; } };

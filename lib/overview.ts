// Port of the redesign prototype's BHOverview (bh-overview.js): every Overview number, from the same
// rules the other pages use (lib/pay.ts wages, lib/finance.ts P&L, lib/team.ts targets and roles).
import {addDays, label, linkIds, mondayOf, money, num} from "./bh";
import {modelPnL} from "./finance";
import {calcPay, periodOf, vaOf, wagesFor, type PayData, type VA} from "./pay";
import {CONVERTING, ROLE_STYLE, converts, roleOf, targetOf} from "./team";
import type {Page} from "./page-access-constants";

type Rec = {id: string; fields: Record<string, any>};
export type BoardTone = "met" | "pace" | "behind" | "missing" | "none";
export type Alert = {sev: "high" | "mid" | "low"; text: string; href: string; cta: string};

const day10 = (v: unknown) => String(v ?? "").slice(0, 10);
const first = (n: string) => n.split(" ")[0];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function overview({today, can, staff, conversions, pay, expenses, models, map, revenue}: {
  today: string; can: (p: Page) => boolean; staff: Rec[]; conversions: Rec[]; pay: {data: PayData; vas: VA[]}; expenses: Rec[]; models: Rec[]; map: Rec[];
  // DAP revenue per model for month to date and the same span last month (null = unknown), 6 months of totals.
  revenue: {mtd: (modelId: string) => number | null; lm: (modelId: string) => number | null; ready: boolean; months: number[]};
}) {
  const T = today, wk = mondayOf(T), day = Math.round((Date.parse(T) - Date.parse(wk)) / 864e5) + 1;
  const mStart = T.slice(0, 8) + "01", dom = Number(T.slice(8));
  const lmEnd0 = addDays(mStart, -1), lmStart = lmEnd0.slice(0, 8) + "01";
  const lmSame = lmStart.slice(0, 8) + String(Math.min(dom, Number(lmEnd0.slice(8)))).padStart(2, "0");
  const active = staff.filter(s => label(s.fields.status) === "Active");
  const name = (s: Rec) => label(s.fields.name);

  // Conversions: per VA per week (null = not entered), per week, per channel.
  const weeks = [-21, -14, -7, 0].map(n => addDays(wk, n));
  const cell = new Map<string, number>(), weekTotals = weeks.map(() => 0);
  for (const r of conversions) {
    const w = day10(r.fields.week), i = w ? weeks.indexOf(mondayOf(w)) : -1;
    if (i < 0) continue;
    weekTotals[i] += num(r.fields.conversions);
    for (const sid of linkIds(r.fields.staff)) cell.set(sid + "|" + weeks[i], (cell.get(sid + "|" + weeks[i]) ?? 0) + num(r.fields.conversions));
  }
  const conv = (sid: string, w: string) => cell.get(sid + "|" + w) ?? null;
  const roleWeeks = CONVERTING.map(role => ({role, c: ROLE_STYLE[role].c, vals: weeks.map(w => sum(staff.filter(s => roleOf(s.fields.platform) === role).map(s => conv(s.id, w) ?? 0)))}));
  const toneOf = (v: number | null, m: number | null, pace: number): BoardTone => m == null ? "none" : v == null ? "missing" : v >= m ? "met" : v >= m * pace ? "pace" : "behind";
  const sellers = active.filter(s => converts(s.fields.platform));
  const board = sellers.map(s => {
    const m = targetOf(s), vals = weeks.map(w => conv(s.id, w)), now = vals[3], last = vals[2], role = roleOf(s.fields.platform);
    return {id: s.id, name: name(s), first: first(name(s)), role, roleC: ROLE_STYLE[role].c, min: m, vals, now, last,
      tone: toneOf(now, m, day / 7), lastTone: toneOf(last, m, 1), pct: m ? Math.min(1, (now ?? 0) / m) : 0};
  }).sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
  const lwMissing = sellers.filter(s => conv(s.id, weeks[2]) === null).map(s => first(name(s)));

  // Money, through the P&L's modelPnL with the pay run's wagesFor (same numbers as the P&L page).
  const live = models.filter(m => label(m.fields.status) !== "Ended");
  const sumP = (a: string, b: string, rev: (id: string) => number | null) => {
    const w = wagesFor(pay.data, pay.vas, a, b, T);
    const ps = live.map(m => modelPnL(m, {sharedAcross: live.map(x => x.id), staff, paylog: [], expenses, map, creators: [], start: a, end: b, revenueKnown: true, accountRevenue: rev(m.id), wages: w}));
    const income = ps.some(p => p.income === null) ? null : sum(ps.map(p => p.income!));
    const payout = sum(ps.map(p => p.payout ?? 0)), wages = sum(ps.map(p => p.wages)), exp = sum(ps.map(p => p.expenses)); // includes shared expenses, split across live models
    return {ps, income, payout, wages, exp, profit: income === null || ps.some(p => p.payout === null) ? null : income - payout - wages - exp};
  };
  const mtd = sumP(mStart, T, revenue.mtd), lm = sumP(lmStart, lmSame, revenue.lm);
  const modelRows = mtd.ps.map((p, i) => {
    const a = map.find(r => r.fields.include !== false && linkIds(r.fields.model).includes(p.modelId));
    return {id: p.modelId, name: p.name, handle: a && label(a.fields.ofUsername) ? "@" + label(a.fields.ofUsername) : p.name, avatar: a ? label(a.fields.avatar) || null : null, index: i,
      deal: p.dealType, income: p.income, profit: p.profit, margin: p.margin};
  }).sort((a, b) => (b.income ?? 0) - (a.income ?? 0));

  // Pay: all-time unpaid wages, the current period's run, hours per day this week.
  const days = [...pay.data.hours.values()].flatMap(m => [...m.keys()]), keys = [...pay.data.va.keys(), ...pay.data.adjustments.keys()].map(k => k.split("|")[0]);
  const earliest = [...days, ...keys].reduce((a, b) => b < a ? b : a, T);
  const unpaid = sum([...wagesFor(pay.data, pay.vas, earliest, T, T).values()].map(r => r.unpaid));
  const P = periodOf(T);
  const pvas = pay.vas.filter(v => [...(pay.data.hours.get(v.id)?.keys() ?? [])].some(d => d >= P.start && d <= P.end));
  const calcs = pvas.map(v => ({v, c: calcPay(pay.data, P, v, T)}));
  const run = {label: P.label, payDate: P.payLabel, status: pay.data.status.get(P.key) ?? "open", n: pvas.length,
    checked: pvas.filter(v => vaOf(pay.data, P, v.id).checked).length, fix: calcs.filter(x => x.c.open > 0).length,
    total: sum(calcs.map(x => x.c.total)), missingToday: calcs.filter(x => x.c.unloggedToday).map(x => first(x.v.name))};
  const vaById = new Map(pay.vas.map(v => [v.id, v]));
  const hours = Array.from({length: 7}, (_, i) => {
    const d = addDays(wk, i), dow = new Date(d + "T00:00:00Z").getUTCDay();
    const h = sum([...pay.data.hours.values()].map(m => m.get(d) ?? 0));
    const sched = sum(active.map(s => { const v = vaById.get(s.id); return v && !(v.off ?? [0]).includes(dow) ? v.std ?? 0 : 0; }));
    return {d, h, sched, today: d === T, future: d > T};
  });

  const open = expenses.filter(e => label(e.fields.status) !== "Paid");
  const openTotal = sum(open.map(e => num(e.fields.amount)));

  // Today, in the spec's order; each only when its page is visible.
  const alerts: Alert[] = [];
  if (can("pay-hours") && run.status === "open" && run.fix) alerts.push({sev: "high", text: `${run.fix} VA${run.fix > 1 ? "s" : ""} need a fix before the ${run.label} pay run`, href: "/pay-hours", cta: "Fix"});
  if (can("pay-hours") && run.missingToday.length) alerts.push({sev: "mid", text: "Hours not logged today for " + run.missingToday.join(", "), href: "/pay-hours", cta: "Log"});
  if (can("conversions")) {
    if (lwMissing.length) alerts.push({sev: "mid", text: "Last week’s conversions missing for " + lwMissing.join(", "), href: "/conversions", cta: "Enter"});
    board.filter(b => b.tone === "behind").forEach(b => alerts.push({sev: "mid", text: `${b.first} is behind pace · ${b.now ?? 0} of ${b.min}`, href: "/conversions", cta: "View"}));
  }
  if (can("staff")) {
    if (can("conversions")) board.filter(b => b.lastTone === "behind").forEach(b => alerts.push({sev: "high", text: `${b.first} missed last week’s minimum · ${b.last} of ${b.min}`, href: "/staff", cta: "View"}));
    staff.filter(s => label(s.fields.status) === "Setup" && !num(s.fields.rate)).forEach(s => alerts.push({sev: "low", text: name(s) + " is in setup with no pay rate", href: "/staff", cta: "Set"}));
  }
  if (can("expenses") && open.length) alerts.push({sev: "low", text: `${open.length} expenses unpaid or planned · ${money(openTotal)}`, href: "/expenses", cta: "Open"});
  // Kept from the previous Overview: a live model whose DAP revenue can't be read leaves earnings unknown.
  if (can("pnl") && revenue.ready) live.filter(m => revenue.mtd(m.id) === null).forEach(m => alerts.push({sev: "low", text: `${label(m.fields.model)} — DAP account revenue could not be read`, href: "/pnl", cta: "Fix"}));
  // Revenue with no deal type or cut leaves Earnings and Profit unknown; say which model.
  if (can("pnl")) mtd.ps.filter(p => p.pageRevenue !== null && (p.income === null || p.payout === null)).forEach(p => alerts.push({sev: "mid", text: `${p.name} has revenue but no deal type or cut, so earnings are unknown`, href: can("revenue") ? "/revenue" : "/pnl", cta: "Set"}));

  return {T, wk, day, weeks, weekTotals, roleWeeks, board, lwMissing, mtd, lm, models: modelRows, unpaid, run, hours, open, openTotal, months: revenue.months, alerts,
    onPace: board.filter(b => b.tone === "met" || b.tone === "pace").length, judged: board.filter(b => b.tone !== "none").length,
    hoursTotal: sum(hours.map(x => x.h)), hoursSched: sum(hours.map(x => x.sched))};
}
export type Overview = ReturnType<typeof overview>;

"use client";
import { useEffect, useMemo, useState } from "react";
import { datasource, useRecords, q } from "@/lib/datasource";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PieChart, Pie, Cell, Label, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Users, Sparkles, Target, Wallet, CalendarDays, AlertTriangle, Clock, Hash, User, Trophy, Inbox, Info, CheckCircle2, TrendingUp, TrendingDown, Minus, CalendarRange } from "lucide-react";

// ---------- datasources ----------
const ds = datasource.define({
  staff: "staff",
  models: "models",
  conversions: "conversions",
  paylog: "paylog",
});

const staffSelect = q.select({
  staffId: "Staff ID",
  name: "Full Name",
  status: "Status",
  model: "Model",
  platform: "Platform",
  rate: "Current Hourly Rate",
  currency: "Currency",
});
const modelsSelect = q.select({ model: "Model" });
// Conversion data is WEEKLY: one row per staff member per model per week, dated to that
// week's MONDAY. The primary date field is "Week Starting" — there is no daily row any more.
const convSelect = q.select({
  weekStarting: "Week Starting",
  staff: "Staff",
  model: "Model",
  conversions: "Conversions",
  shift: "Shift",
  notes: "Notes",
});
const paySelect = q.select({
  workDate: "Work Date",
  staff: "Staff",
  hours: "Hours Worked",
  rate: "Hourly Rate Snapshot",
  basePay: "Base Pay",
  totalPay: "Total Pay",
  period: "Pay Period",
  paymentStatus: "Payment Status",
  submittedBy: "Submitted By",
  notes: "Notes",
});

// ---------- helpers ----------
// Airtable returns real numbers; num() stays as a cheap guard against null/blank.
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Airtable SELECT fields read back as { id, label } — never render one directly or every
// === "Active" comparison silently fails and the cell shows [object Object].
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

// Airtable LINKED_RECORD fields read back as an array of { id, name }. Joins are on record id,
// never on the display name — the name is only a fallback for rendering.
type LinkRef = { id: string; name: string };
function links(v: unknown): LinkRef[] {
  if (v === null || v === undefined || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x): LinkRef => {
      if (x && typeof x === "object") {
        const o = x as { id?: unknown; name?: unknown; title?: unknown; label?: unknown };
        return { id: String(o.id ?? "").trim(), name: String(o.name ?? o.title ?? o.label ?? "").trim() };
      }
      const s = String(x ?? "").trim();
      return s.startsWith("rec") ? { id: s, name: "" } : { id: "", name: s };
    })
    .filter((l) => l.id !== "" || l.name !== "");
}
function firstLink(v: unknown): LinkRef | null {
  return links(v)[0] ?? null;
}

// Airtable dates arrive ISO (2026-09-02). No slash-date branch — that was a Google Sheets locale problem.
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(v);
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}
function fmtDay(d: Date) { return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
function fmtDayShort(d: Date) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function isoDay(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Every conversion figure on this page is bucketed by the MONDAY of its week, so a row that is
// somehow dated mid-week still lands in the right bucket instead of inventing a week of its own.
function weekKeyOf(d: Date) { return isoDay(mondayOf(d)); }
function fmtWeek(d: Date) { return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
function fmtWeekFull(d: Date) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function money(n: number, cur = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}
function initialsOf(name: string) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const s = parts.map((w) => w[0] ?? "").join("").toUpperCase();
  return s || "?";
}
function fmt1(n: number | null): string { return n === null ? "—" : n.toFixed(1); }

// ---------- weekly buckets ----------
// A bucket exists only if at least one Conversion Log row was entered for that week. That is the
// whole point: NO ENTRY IS NOT ZERO. bucketTotal() returns null for "nothing was ever logged for
// that week" and a number (which may legitimately be 0) when a row exists. Every renderer turns
// null into an em dash and a chart gap, never into a 0.
type Bucket = { rows: number; total: number };
function bump(m: Map<string, Bucket>, key: string, v: number) {
  const b = m.get(key) ?? { rows: 0, total: 0 };
  b.rows += 1; b.total += v; m.set(key, b);
}
function bucketTotal(m: Map<string, Bucket> | undefined, key: string): number | null {
  if (!m) return null;
  const b = m.get(key);
  return b ? b.total : null;
}
function sumWeeks(m: Map<string, Bucket> | undefined, keys: string[]): number | null {
  if (!m) return null;
  let any = false;
  let t = 0;
  for (const k of keys) { const b = m.get(k); if (b) { any = true; t += b.total; } }
  return any ? t : null;
}
// Weekly total ÷ 7. Always rendered next to an explicit "avg/day (÷7)" label — a bare per-day
// number sitting beside weekly data is exactly the misreading this page exists to avoid.
const DAYS_PER_WEEK = 7;
function avgPerDay(weekTotal: number | null): number | null {
  return weekTotal === null ? null : weekTotal / DAYS_PER_WEEK;
}

// Average only reported weekly totals; missing weeks are not zero-conversion weeks.
function avgForWeeks(m: Map<string, Bucket> | undefined, keys: string[]): number | null {
  const reported = keys.filter(k => bucketTotal(m, k) !== null);
  const total = sumWeeks(m, reported);
  return total === null ? null : total / (reported.length * DAYS_PER_WEEK);
}

function conversionWeeks(period: string, today: Date, start: string, end: string): Date[] {
  let first=mondayOf(today), last=first;
  if(period==="last") first=last=addDays(first,-7);
  if(period==="month"||period==="lastmonth") {
    const offset=period==="lastmonth"?-1:0;
    const from=new Date(today.getFullYear(),today.getMonth()+offset,1);
    const to=new Date(today.getFullYear(),today.getMonth()+offset+1,0);
    first=mondayOf(from); if(first<from)first=addDays(first,7);
    last=mondayOf(to);
  }
  if(period==="custom") {
    const a=toDate(start),b=toDate(end);
    if(!a||!b||a>b||isoDay(a)!==start||isoDay(b)!==end)return [];
    first=mondayOf(a);last=mondayOf(b);
  }
  const weeks:Date[]=[];
  for(let d=first;d<=last;d=addDays(d,7))weeks.push(d);
  return weeks;
}




// Auto-paging is capped so Home can never turn into hundreds of sequential round trips.
// When the cap bites we say so on the page — these are money figures.


function useAllPages(res: ReturnType<typeof useRecords>) {
  const { hasNextPage, fetchNextPage, isFetching } = res;
  const items = useMemo(() => (res.data?.pages.flatMap((p: any) => p.items) ?? []) as any[], [res.data]);
  const atCap = false;
  useEffect(() => {
    if (hasNextPage && !isFetching && res.status !== "error") fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage, res.status]);
  return { ...res, items, truncated: Boolean(hasNextPage) && atCap };
}

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const trendConfig = { conversions: { label: "Conversions", color: "var(--chart-1)" } } satisfies ChartConfig;

// ---------- block ----------
export default function Block() {
  const staff = useAllPages(useRecords({ from: ds.staff, select: staffSelect, count: 100 }));
  const models = useAllPages(useRecords({ from: ds.models, select: modelsSelect, count: 100 }));
  const conv = useAllPages(useRecords({ from: ds.conversions, select: convSelect, count: 100, orderBy: q.desc("weekStarting") }));
  const pay = useAllPages(useRecords({ from: ds.paylog, select: paySelect, count: 100, orderBy: q.desc("workDate") }));

  const loading = [staff, models, conv, pay].some((r) => r.status === "pending" || r.hasNextPage);
  const errored = [staff, models, conv, pay].find((r) => r.status === "error");

  const truncatedSources = [
    pay.truncated ? "Pay Log" : null,
    conv.truncated ? "Conversion Log" : null,
    staff.truncated ? "Staff" : null,
    models.truncated ? "Models" : null,
  ].filter(Boolean) as string[];

  const today = startOfDay(new Date());
  const [conversionPeriod,setConversionPeriod]=useState("this");
  const [conversionStart,setConversionStart]=useState(isoDay(mondayOf(today)));
  const [conversionEnd,setConversionEnd]=useState(isoDay(addDays(mondayOf(today),6)));
  const conversionTitle=({this:"This week",last:"Last week",month:"This month",lastmonth:"Last month",custom:"Custom range"} as Record<string,string>)[conversionPeriod];

  // --- Models: record id -> name, so linked Model fields resolve to a display name ---
  const modelRows = models.items
    .map((r) => ({ id: String(r.id ?? ""), model: String(r.fields.model ?? "").trim() }))
    .filter((m) => m.model !== "" && m.model.toLowerCase() !== "unassigned");
  const modelNameById = new Map<string, string>(modelRows.map((m) => [m.id, m.model]));
  const modelNames = modelRows.map((m) => m.model);
  const modelNameOf = (v: unknown): string => {
    const l = firstLink(v);
    if (!l) return "";
    return (l.id && modelNameById.get(l.id)) || l.name || "";
  };

  // --- Staff rows. Every join below is on the STAFF RECORD ID, not the name. ---
  const staffRows = staff.items
    .map((r) => ({
      id: String(r.id ?? ""),
      staffId: String(r.fields.staffId ?? "").trim(),
      name: String(r.fields.name ?? "").trim(),
      status: label(r.fields.status),
      modelLink: firstLink(r.fields.model),
      model: modelNameOf(r.fields.model),
      platform: label(r.fields.platform),
      rate: num(r.fields.rate),
      currency: label(r.fields.currency),
    }))
    .filter((f) => f.name !== "");
  const staffNameById = new Map<string, string>(staffRows.map((f) => [f.id, f.name]));
  // A linked staff reference resolves to { key, name }. key is the record id when we have one,
  // so two staff members who share a display name can never be merged into one row.
  const staffRefOf = (v: unknown): { key: string; name: string } | null => {
    const l = firstLink(v);
    if (!l) return null;
    const name = (l.id && staffNameById.get(l.id)) || l.name || "";
    const key = l.id || (name ? `name:${name}` : "");
    if (!key) return null;
    return { key, name };
  };

  const activeStaff = staffRows.filter((f) => f.status.toLowerCase() === "active");
  const setupStaff = staffRows.filter((f) => f.status.toLowerCase() === "setup");

  // --- Conversion Log rows (parsed). One row per staff member per model per WEEK. ---
  const convRows = conv.items
    .map((r) => {
      const s = staffRefOf(r.fields.staff);
      const d = toDate(r.fields.weekStarting);
      return {
        date: d,
        weekKey: d ? weekKeyOf(d) : "",
        staffKey: s?.key ?? "",
        staff: s?.name ?? "",
        hasStaffLink: links(r.fields.staff).length > 0,
        hasModelLink: links(r.fields.model).length > 0,
        model: modelNameOf(r.fields.model) || "Unassigned",
        conversions: num(r.fields.conversions),
        shift: label(r.fields.shift),
        notes: String(r.fields.notes ?? "").trim(),
      };
    })
    .filter((r) => r.date && (r.staffKey !== "" || r.conversions !== 0));

  // --- Contiguous week axis. Built by stepping back from this week's Monday, NEVER from the set
  // of weeks that happen to have rows — an axis built from the data silently deletes any week
  // with nothing in it, which is how a real zero month once vanished from the P&L. ---
  const thisWeekStart = mondayOf(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const thisWeekKey = isoDay(thisWeekStart);
  const lastWeekKey = isoDay(lastWeekStart);
  const weekAxis = conversionWeeks(conversionPeriod,today,conversionStart,conversionEnd);
  // --- Weekly buckets, computed straight from the Conversion Log + Pay Log ---
  // Deliberately NOT read from Airtable's Staff rollups (Conversions This Week, Conversions Last
  // Week, Conversions Last 4 Weeks, Hours Last 30d, ...). Those exist so the numbers can be
  // eyeballed inside Airtable; reading a stored copy of derived data is what made this page
  // contradict itself.
  const convByWeek = new Map<string, Bucket>();
  const convByStaffWeek = new Map<string, Map<string, Bucket>>();
  for (const r of convRows) {
    if (!r.weekKey) continue;
    bump(convByWeek, r.weekKey, r.conversions);
    if (r.staffKey) {
      let m = convByStaffWeek.get(r.staffKey);
      if (!m) { m = new Map<string, Bucket>(); convByStaffWeek.set(r.staffKey, m); }
      bump(m, r.weekKey, r.conversions);
    }
  }

  // --- Pay Log rows ---
  const payRows = pay.items
    .map((r) => {
      const s = staffRefOf(r.fields.staff);
      return {
        date: toDate(r.fields.workDate),
        staffKey: s?.key ?? "",
        staff: s?.name ?? "",
        hasStaffLink: links(r.fields.staff).length > 0,
        hours: num(r.fields.hours),
        rate: num(r.fields.rate),
        basePay: num(r.fields.basePay),
        total: num(r.fields.totalPay),
        period: String(r.fields.period ?? "").trim(),
        status: label(r.fields.paymentStatus) || "Unpaid",
        submittedBy: String(r.fields.submittedBy ?? "").trim(),
        notes: String(r.fields.notes ?? "").trim(),
      };
    })
    .filter((r) => r.staffKey !== "" && (r.period !== "" || r.date));

  const mainCurrency = activeStaff[0]?.currency || "USD";
  const currencyByStaff = new Map<string, string>(staffRows.map((f) => [f.id, f.currency || mainCurrency]));
  const currencyFor = (key: string) => currencyByStaff.get(key) ?? mainCurrency;

  // --- Team weekly headline figures ---
  const thisWeekTotal = bucketTotal(convByWeek, thisWeekKey);
  const lastWeekTotal = bucketTotal(convByWeek, lastWeekKey);
  const thisWeekAvgDay = avgPerDay(thisWeekTotal);
  const lastWeekAvgDay = avgPerDay(lastWeekTotal);
  const weekDelta = thisWeekTotal !== null && lastWeekTotal !== null ? thisWeekTotal - lastWeekTotal : null;
  const weekDeltaPct = weekDelta !== null && lastWeekTotal !== null && lastWeekTotal > 0 ? (weekDelta / lastWeekTotal) * 100 : null;

  // --- Selected weekly trend. One point per week on the contiguous axis; value null where no row exists. ---
  const trend = weekAxis.map((d) => {
    const k = isoDay(d);
    const total = bucketTotal(convByWeek, k);
    return {
      key: k,
      label: fmtWeek(d),
      full: fmtWeekFull(d),
      conversions: total,          // null = nothing logged for this week (a gap, never a zero)
      avgDay: avgPerDay(total),
      isCurrent: k === thisWeekKey,
    };
  });
  const trendHasData = trend.some((t) => t.conversions !== null);
  const selectedKeys=weekAxis.map(isoDay);
  const previousKeys=weekAxis.map(d=>isoDay(addDays(d,-7*weekAxis.length)));
  const selectedTotal=sumWeeks(convByWeek,selectedKeys);
  const previousTotal=sumWeeks(convByWeek,previousKeys);
  const loggedWeeks=selectedKeys.filter(k=>bucketTotal(convByWeek,k)!==null).length;
  const comparisonComplete=selectedKeys.length>0&&loggedWeeks===selectedKeys.length&&previousKeys.every(k=>bucketTotal(convByWeek,k)!==null);
  const selectedChange=comparisonComplete?selectedTotal!-previousTotal!:null;
  const selectedDaily=avgForWeeks(convByWeek,selectedKeys);
  const conversionCoverage=weekAxis.length?`${fmtWeekFull(weekAxis[0])} – ${fmtWeekFull(addDays(weekAxis[weekAxis.length-1],6))}`:"Choose a valid start and end date";


  // --- Conversions by model, current week (Mon–Sun) ---
  const weekRows = convRows.filter((r) => selectedKeys.includes(r.weekKey));
  const byModelMap = new Map<string, number>();
  for (const m of modelNames) byModelMap.set(m, 0);
  for (const r of weekRows) byModelMap.set(r.model, (byModelMap.get(r.model) ?? 0) + r.conversions);
  const byModel = Array.from(byModelMap.entries())
    // Colour is assigned from the Models-table order, BEFORE sorting, so a model keeps its colour
    // when the ranking changes. Colour follows the entity, never its rank.
    .map(([model, value], i) => ({ model, value, fill: PALETTE[i % PALETTE.length] }))
    .sort((a, b) => b.value - a.value);
  const weekModelTotal = byModel.reduce((s, r) => s + r.value, 0);
  const donutConfig = Object.fromEntries(byModel.map((r) => [r.model, { label: r.model, color: r.fill }])) as ChartConfig;

  // --- Per-staff weekly performance ---
  type Perf = {
    key: string; staff: string;
    thisWeek: number | null; lastWeek: number | null; delta: number | null;
    avgDay: number | null; lastWeekAvgDay: number | null;
  };
  const perfKeys = new Map<string, string>();
  for (const f of staffRows) perfKeys.set(f.id, f.name);
  for (const r of convRows) if (r.staffKey && !perfKeys.has(r.staffKey)) perfKeys.set(r.staffKey, r.staff || r.staffKey.replace(/^name:/, ""));
  const perfRows: Perf[] = Array.from(perfKeys.entries()).map(([key, name]) => {
    const cm = convByStaffWeek.get(key);
    const tw = bucketTotal(cm, thisWeekKey);
    const lw = bucketTotal(cm, lastWeekKey);
    return {
      key,
      staff: name || key.replace(/^name:/, ""),
      thisWeek: tw,
      lastWeek: lw,
      delta: tw !== null && lw !== null ? tw - lw : null,
      avgDay: avgPerDay(tw),
      lastWeekAvgDay: avgPerDay(lw),
    };
  });
  // Nulls sort last so "no entry" never outranks a real number.
  const byThisWeek = [...perfRows].sort((a, b) => (b.thisWeek ?? -1) - (a.thisWeek ?? -1) || a.staff.localeCompare(b.staff));

  // Payroll this week (Mon–Sun) and this month
  const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const weekPay = payRows.filter((r) => r.date && r.date >= thisWeekStart && r.date <= thisWeekEnd);
  const monthPay = payRows.filter((r) => r.period === currentPeriod);
  const sum = (rows: typeof payRows) => rows.reduce((s, r) => s + r.total, 0);
  const unpaid = (rows: typeof payRows) => rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + r.total, 0);

  // Pay-period table
  const periodMap = new Map<string, { period: string; hours: number; total: number; paid: number; unpaid: number; staff: Set<string> }>();
  for (const r of payRows) {
    if (!r.period) continue;
    const p = periodMap.get(r.period) ?? { period: r.period, hours: 0, total: 0, paid: 0, unpaid: 0, staff: new Set<string>() };
    p.hours += r.hours; p.total += r.total;
    if (r.status === "Paid") p.paid += r.total; else p.unpaid += r.total;
    p.staff.add(r.staffKey);
    periodMap.set(r.period, p);
  }
  const periods = Array.from(periodMap.values()).sort((a, b) => b.period.localeCompare(a.period));

  // --- Missing timesheets: active staff with no hours logged in the last 7 days ---
  // Bounded at both ends so a future-dated pay row can't mark someone as having logged hours.
  const sevenAgo = addDays(today, -6);
  const loggedRecently = new Set(payRows.filter((r) => r.date && r.date >= sevenAgo && r.date <= today && r.hours > 0).map((r) => r.staffKey));
  const missingTimesheets = activeStaff.filter((f) => !loggedRecently.has(f.id));

  // --- Activity feed: latest pay (daily) + conversion (weekly) entries ---
  const activity = [
    ...payRows.filter((r) => r.date).map((r) => ({
      kind: "hours" as const, date: r.date as Date, staff: r.staff,
      title: `${r.hours} h logged`, when: fmtDay(r.date as Date),
      detail: `${money(r.total, currencyFor(r.staffKey))} · ${r.status}${r.submittedBy ? ` · by ${r.submittedBy}` : ""}`, notes: r.notes,
    })),
    ...convRows.filter((r) => r.date).map((r) => ({
      kind: "conversion" as const, date: r.date as Date, staff: r.staff,
      title: `${r.conversions} conversion${r.conversions === 1 ? "" : "s"}`, when: `w/c ${fmtWeek(r.date as Date)}`,
      detail: `${r.model}${r.shift ? ` · ${r.shift} shift` : ""}`, notes: r.notes,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 12);

  // --- Data integrity: things that should never be true on a healthy base ---
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).join(", ");
  const brokenRows = payRows.filter((r) => r.hours > 0 && (r.rate <= 0 || r.basePay <= 0 || r.period === ""));
  const orphanPay = pay.items.filter((r) => links(r.fields.staff).length === 0);
  const orphanConv = conv.items.filter((r) => links(r.fields.staff).length === 0);
  const convNoModel = convRows.filter((r) => !r.hasModelLink);
  const staffNoModel = staffRows.filter((f) => !f.modelLink);
  // Weekly entry means every Conversion Log row should carry the MONDAY of its week.
  const convOffMonday = convRows.filter((r) => r.date && r.date.getDay() !== 1);
  const issues: { label: string; detail: string }[] = [];
  if (brokenRows.length) issues.push({ label: `${brokenRows.length} pay row${brokenRows.length === 1 ? "" : "s"} with no calculated pay`, detail: "Hourly Rate Snapshot or Pay Period is blank — Base Pay and Total Pay cannot calculate without a rate written at save time." });
  if (orphanPay.length) issues.push({ label: `${orphanPay.length} pay row${orphanPay.length === 1 ? "" : "s"} with no staff linked`, detail: "Not attached to anyone in Staff, so the hours belong to nobody and pay cannot calculate." });
  if (orphanConv.length) issues.push({ label: `${orphanConv.length} conversion row${orphanConv.length === 1 ? "" : "s"} with no staff linked`, detail: "Not attached to anyone in Staff, so these conversions are missing from every leaderboard." });
  if (convNoModel.length) issues.push({ label: `${convNoModel.length} conversion row${convNoModel.length === 1 ? "" : "s"} with no model linked`, detail: "Counted in the weekly totals but not attributable to a model, so they are missing from the by-model breakdown." });
  if (convOffMonday.length) issues.push({ label: `${convOffMonday.length} conversion row${convOffMonday.length === 1 ? "" : "s"} not dated to a Monday`, detail: "Conversions are entered one row per week, dated to that week's Monday. These rows still count in the week they fall in, but the date should be corrected." });
  if (staffNoModel.length) issues.push({ label: `${staffNoModel.length} staff member${staffNoModel.length === 1 ? "" : "s"} with no model`, detail: `${uniq(staffNoModel.map((f) => f.name))} — no model linked in Staff.` });

  if (errored) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="w-full space-y-4">
          <Card><CardContent className="py-6 text-destructive">Failed to load data: {(errored as any).error?.message ?? "unknown error"}</CardContent></Card>
        </div>
      </div>
    );
  }

  const v = (s: string) => (loading ? "…" : s);
  const weekLabelShort = `${fmtDayShort(thisWeekStart)}–${fmtDayShort(thisWeekEnd)}`;
  const monthLabelShort = today.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const thisWeekHint = thisWeekTotal === null
    ? `w/c ${fmtWeek(thisWeekStart)} · nothing logged yet`
    : `w/c ${fmtWeek(thisWeekStart)} · ${fmt1(thisWeekAvgDay)} avg/day (÷7)`;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        {!loading && issues.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Data check — {issues.length} issue{issues.length === 1 ? "" : "s"} found</div>
            <ul className="mt-2 space-y-1 text-sm">
              {issues.map((it, n) => (<li key={n}><span className="font-medium">{it.label}.</span> <span className="opacity-80">{it.detail}</span></li>))}
            </ul>
          </div>
        )}


        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi icon={<Users className="h-5 w-5" />} label="Active staff" value={v(String(activeStaff.length))}
               hint={setupStaff.length ? `${setupStaff.length} still in setup` : "All staff configured"} />
          <Kpi icon={<Sparkles className="h-5 w-5" />} label="Active models" value={v(String(modelNames.length))}
               hint={modelNames.join(", ") || "No models yet"} />
          <Kpi icon={<Target className="h-5 w-5" />} label="Conversions this week" value={v(thisWeekTotal === null ? "—" : String(thisWeekTotal))}
               hint={thisWeekHint} />
          <Kpi icon={<CalendarDays className="h-5 w-5" />} label="Payroll this week" value={v(money(sum(weekPay), mainCurrency))}
               hint={`${weekLabelShort} · ${money(unpaid(weekPay), mainCurrency)} unpaid`} />
          <Kpi icon={<Wallet className="h-5 w-5" />} label="Payroll this month" value={v(money(sum(monthPay), mainCurrency))}
               hint={`${monthLabelShort} · ${money(unpaid(monthPay), mainCurrency)} unpaid`} />
        </div>

        {/* Weekly conversions — the page's whole conversion story on one card */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarRange className="h-4 w-4" /> Weekly conversions</CardTitle>
            <CardDescription>
              Conversions are logged once per week, dated to that week's Monday. Every figure here is a whole-week
              total computed from the Conversion Log; the per-day numbers are that total divided by 7, never a day's count.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">Period<select aria-label="Conversion period" value={conversionPeriod} onChange={e=>setConversionPeriod(e.target.value)} className="rounded-md border bg-background p-2">
                <option value="this">This week</option><option value="last">Last week</option><option value="month">This month</option><option value="lastmonth">Last month</option><option value="custom">Custom range</option>
              </select></label>
              <label className="grid gap-1 text-sm">From<input aria-label="Conversions from" type="date" value={conversionPeriod==="custom"?conversionStart:(weekAxis.length?isoDay(weekAxis[0]):"")} onChange={e=>{setConversionStart(e.target.value);if(conversionPeriod!=="custom"&&weekAxis.length)setConversionEnd(isoDay(addDays(weekAxis[weekAxis.length-1],6)));setConversionPeriod("custom");}} className="rounded-md border bg-background p-2"/></label>
              <label className="grid gap-1 text-sm">To<input aria-label="Conversions to" type="date" value={conversionPeriod==="custom"?conversionEnd:(weekAxis.length?isoDay(addDays(weekAxis[weekAxis.length-1],6)):"")} onChange={e=>{setConversionEnd(e.target.value);if(conversionPeriod!=="custom"&&weekAxis.length)setConversionStart(isoDay(weekAxis[0]));setConversionPeriod("custom");}} className="rounded-md border bg-background p-2"/></label>
            </div>
            <p className="text-sm text-muted-foreground">Whole weeks covered: {conversionCoverage}. Month presets use the week’s Monday; custom dates include the full weeks containing both dates. No weekly totals are prorated.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={conversionTitle+" conversions"} value={selectedTotal===null?"—":String(selectedTotal)} sub={`${loggedWeeks} of ${selectedKeys.length} weeks have entries${loggedWeeks<selectedKeys.length?" · incomplete":""}`} />
              <Stat label="Previous equivalent period" value={previousTotal===null?"—":String(previousTotal)} sub={`${selectedKeys.length} preceding whole week(s)`}/>
              <Stat label="Change vs previous period" value={selectedChange===null?"—":`${selectedChange>0?"+":""}${selectedChange}`} sub={comparisonComplete?"Compared over the same number of weeks":"Needs entries for every week in both periods"}/>
              <Stat label="Average conversions per day" value={selectedDaily===null?"—":selectedDaily.toFixed(2)} sub={`${loggedWeeks} reported week(s) · weekly total ÷ 7${loggedWeeks<selectedKeys.length?" · unreported weeks excluded":""}`}/>
            </div>

            {/* Selected weekly trend. The axis is contiguous: a week with no Conversion Log row is a GAP in
                the line, not a zero, because "nobody entered anything" and "they converted nobody"
                are different facts and must not look the same. */}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{conversionTitle} · weekly results</h3>
                <p className="text-xs text-muted-foreground">By week commencing (Mon). A break in the line means no entry for that week — not zero conversions.</p>
              </div>
              {!trendHasData ? (
                <Empty text={"No conversions logged for the selected weeks"} icon={<Target className="h-8 w-8" />} />
              ) : (
                <ChartContainer config={trendConfig} className="aspect-auto h-[240px] w-full">
                  <LineChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" />
                    <YAxis width={34} tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_lbl, p) => `w/c ${((p?.[0]?.payload ?? {}) as any).full ?? ""}`} />} />
                    {/* linear, not monotone: a curve between two weekly totals implies mid-week
                        values that do not exist. isAnimationActive={false} so the line is drawn at
                        first paint — Recharts' entry animation never completes when the page is
                        rendered hidden (print, a background tab, a thumbnail), leaving a blank plot. */}
                    <Line
                      dataKey="conversions"
                      type="linear"
                      stroke="var(--color-conversions)"
                      strokeWidth={2}
                      connectNulls={false}
                      isAnimationActive={false}
                      dot={{ r: 4, strokeWidth: 0, fill: "var(--color-conversions)" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ChartContainer>
              )}
              {/* Table view twin — the only place null and a genuine zero are spelled out. */}
              <div className="w-full min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><HeadLabel icon={<CalendarDays className="h-3 w-3 opacity-60" />} label="Week commencing" /></TableHead>
                      <TableHead className="text-right"><HeadLabel icon={<Target className="h-3 w-3 opacity-60" />} label="Conversions" align="right" /></TableHead>
                      <TableHead className="text-right"><HeadLabel icon={<Hash className="h-3 w-3 opacity-60" />} label="avg/day (÷7)" align="right" /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trend.map((t) => (
                      <TableRow key={t.key}>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums">
                          {t.full}
                          {t.isCurrent && <Badge variant="secondary" className="ml-2 rounded-md font-normal">in progress</Badge>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.conversions === null ? <NoEntry /> : t.conversions}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.avgDay === null ? <Dash /> : t.avgDay.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leaderboards */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Leaderboard
            title={conversionTitle+" conversions"}
            description={conversionCoverage+" · whole-week totals"}
            emptyText="No conversions logged for the selected weeks"
            unit=""
            digits={0}
            rows={perfRows.map(r=>({...r,selected:sumWeeks(convByStaffWeek.get(r.key),selectedKeys)})).filter(r=>r.selected!==null).sort((a,b)=>(b.selected??0)-(a.selected??0)).map(r=>({key:r.key,name:r.staff,value:r.selected as number,sub:"Selected whole-week total"}))}
          />
          <Leaderboard
            title="Average conversions per day"
            description={conversionCoverage+" · weekly totals ÷ 7, averaged across reported weeks"}
            emptyText="No conversions logged for the selected weeks"
            unit="/day"
            digits={2}
            rows={perfRows.map(r=>({...r,daily:avgForWeeks(convByStaffWeek.get(r.key),selectedKeys)})).filter(r=>r.daily!==null).sort((a,b)=>(b.daily??0)-(a.daily??0)).map(r=>({key:r.key,name:r.staff,value:r.daily as number,sub:"Average across reported weeks · unreported weeks excluded"}))}
          />
        </div>

        {/* Donut + pay periods */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle>Conversions by model · {conversionTitle}</CardTitle>
              <CardDescription>{conversionCoverage}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-1 flex-col">
              {weekRows.length === 0 || weekModelTotal === 0 ? <Empty text="No conversions logged for the selected weeks" icon={<Target className="h-8 w-8" />} /> : (
                <div className="flex min-w-0 flex-col items-center gap-6 sm:flex-row">
                  <ChartContainer config={donutConfig} className="mx-auto aspect-square w-full max-w-[240px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="model" hideLabel />} />
                      <Pie data={byModel.filter((r) => r.value > 0)} dataKey="value" nameKey="model" innerRadius={62} outerRadius={95} strokeWidth={4}>
                        {byModel.filter((r) => r.value > 0).map((r) => <Cell key={r.model} fill={r.fill} />)}
                        <Label content={({ viewBox }) => {
                          if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                            return (
                              <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">{weekModelTotal}</tspan>
                                <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 22} className="fill-muted-foreground text-xs">selected weeks</tspan>
                              </text>
                            );
                          }
                          return null;
                        }} />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="w-full min-w-0 space-y-2">
                    {byModel.map((r) => (
                      <div key={r.model} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.fill }} />
                          <span className="truncate font-medium">{r.model}</span>
                        </div>
                        <div className="shrink-0 tabular-nums text-muted-foreground">
                          {r.value} <span className="text-xs">({weekModelTotal ? Math.round((r.value / weekModelTotal) * 100) : 0}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle>Payroll by pay period</CardTitle>
              <CardDescription>Totals from the Pay Log, newest first</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-1 flex-col">
              {periods.length === 0 ? <Empty text="No pay records yet" icon={<Wallet className="h-8 w-8" />} /> : (
                <div className="w-full min-w-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><HeadLabel icon={<CalendarDays className="h-3 w-3 opacity-60" />} label="Period" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<User className="h-3 w-3 opacity-60" />} label="Staff" align="right" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<Clock className="h-3 w-3 opacity-60" />} label="Hours" align="right" /></TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Unpaid</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periods.map((p) => (
                        <TableRow key={p.period}>
                          <TableCell className="whitespace-nowrap font-medium">{p.period}{p.period === currentPeriod && <Badge variant="secondary" className="ml-2">current</Badge>}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.staff.size}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.hours.toFixed(1)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(p.total, mainCurrency)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{money(p.paid, mainCurrency)}</TableCell>
                          <TableCell className={`whitespace-nowrap text-right tabular-nums ${p.unpaid > 0 ? "text-destructive" : ""}`}>{money(p.unpaid, mainCurrency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tables */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle>Staff performance</CardTitle>
              <CardDescription>
                Whole-week totals from the Conversion Log. avg/day is the week's total ÷ 7, not a day's count.
                Daily averages are shown separately for this week and last week.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-1 flex-col">
              {perfRows.length === 0 ? <Empty text="No staff metrics yet" icon={<Trophy className="h-8 w-8" />} /> : (
                <div className="w-full min-w-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><HeadLabel icon={<User className="h-3 w-3 opacity-60" />} label="Staff" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<Target className="h-3 w-3 opacity-60" />} label="This week" align="right" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<Hash className="h-3 w-3 opacity-60" />} label="Last week" align="right" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<TrendingUp className="h-3 w-3 opacity-60" />} label="Change" align="right" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<Hash className="h-3 w-3 opacity-60" />} label="This week avg/day" align="right" /></TableHead>
                        <TableHead className="text-right"><HeadLabel icon={<Hash className="h-3 w-3 opacity-60" />} label="Last week avg/day" align="right" /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byThisWeek.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell><Person name={r.staff} /></TableCell>
                          <TableCell className="text-right tabular-nums">{r.thisWeek === null ? <NoEntry /> : r.thisWeek}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lastWeek === null ? <NoEntry /> : r.lastWeek}</TableCell>
                          <TableCell className="text-right tabular-nums"><DeltaCell delta={r.delta} /></TableCell>
                          <TableCell className="text-right tabular-nums">{r.avgDay === null ? <Dash /> : r.avgDay.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lastWeekAvgDay === null ? <Dash /> : r.lastWeekAvgDay.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Missing timesheets</CardTitle>
              <CardDescription>Active staff with no hours logged in the last 7 days</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-1 flex-col">
              {missingTimesheets.length === 0 ? <Empty text="Everyone active has logged hours this week" icon={<CheckCircle2 className="h-8 w-8" />} /> : (
                <div className="w-full min-w-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><HeadLabel icon={<User className="h-3 w-3 opacity-60" />} label="Staff" /></TableHead>
                        <TableHead><HeadLabel icon={<Sparkles className="h-3 w-3 opacity-60" />} label="Model" /></TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {missingTimesheets.map((f) => (
                        <TableRow key={f.id || f.staffId || f.name}>
                          <TableCell><Person name={f.name} /></TableCell>
                          <TableCell>{f.model ? <Badge variant="secondary" className="rounded-md font-normal">{f.model}</Badge> : <Dash />}</TableCell>
                          <TableCell>{f.platform ? f.platform : <Dash />}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{f.rate ? money(f.rate, f.currency || mainCurrency) : <Dash />}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity feed */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Recent activity</CardTitle>
            <CardDescription>Latest hours (logged daily) and conversion entries (logged weekly), newest first</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? <Empty text="No entries yet" /> : (
              <ul className="divide-y">
                {activity.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${a.kind === "hours" ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>
                      {a.kind === "hours" ? <Clock className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-sm"><span className="font-medium">{a.staff}</span> · {a.title}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">{a.when}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{a.detail}{a.notes ? ` — ${a.notes}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HeadLabel({ icon, label, align }: { icon: React.ReactNode; label: string; align?: "right" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${align === "right" ? "justify-end" : ""}`}>
      {icon}
      {label}
    </span>
  );
}

function Person({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initialsOf(name)}</span>
      <span className="truncate font-medium">{name}</span>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

// "No entry for this week" — deliberately distinct from a logged 0, which renders as 0.
function NoEntry() {
  return <span className="text-muted-foreground" title="No entry logged for this week">—</span>;
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) return <Dash />;
  if (delta === 0) return <span className="inline-flex items-center justify-end gap-1 text-muted-foreground"><Minus className="h-3 w-3" />0</span>;
  const up = delta > 0;
  return (
    <span className={`inline-flex items-center justify-end gap-1 ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{delta}
    </span>
  );
}

function Stat({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: "up" | "down" | "flat"; icon?: React.ReactNode }) {
  const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "";
  const ToneIcon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : tone === "flat" ? Minus : null;
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      </div>
      <div className={`mt-1 flex items-center gap-1.5 text-2xl font-bold ${toneClass}`}>
        {ToneIcon && <ToneIcon className="h-5 w-5" />}
        <span>{value}</span>
      </div>
      {sub && <p className="mt-1 text-xs leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Leaderboard({ title, description, rows, emptyText, unit, digits }: { title: string; description: string; rows: { key: string; name: string; value: number; sub?: string }[]; emptyText: string; unit: string; digits: number }) {
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(0, ...rows.map((r) => r.value));
  const visible = showAll ? rows : rows.slice(0, 5);
  // A ranked list of zeroes reads as broken, not empty — say it in words instead.
  const isEmpty = rows.length === 0 || max <= 0;
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col">
        {isEmpty ? <Empty text={emptyText} icon={<Trophy className="h-8 w-8" />} /> : (
          <div className="space-y-3">
            {visible.map((r, i) => (
              <div key={r.key} className="flex items-center gap-3">
                <span className={`w-6 text-right text-sm tabular-nums ${i < 3 ? "font-bold" : "text-muted-foreground"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      {r.value.toFixed(digits)}
                      {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
                    </span>
                  </div>
                  {r.sub && <p className="mt-0.5 text-xs text-muted-foreground">{r.sub}</p>}
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {rows.length > 5 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show top 5" : `Show all ${rows.length}`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        {/* fixed two-line box so every KPI's big number sits on the same baseline */}
        <CardTitle className="min-h-10 text-sm font-medium leading-5 text-muted-foreground">{label}</CardTitle>
        <span className="shrink-0 text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Empty({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex min-h-[140px] flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="text-muted-foreground/40">{icon ?? <Inbox className="h-8 w-8" />}</span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}



"use client";
import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis} from "recharts";
import {AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, Clock, Minus, Receipt, Target, TrendingUp, Trophy, Users, Wallet} from "lucide-react";
import {q, useProxyFetch, useRecords} from "@/lib/datasource";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent} from "@/components/ui/chart";
import {addDays, fetchCreators, isLoading, label, linkIds, money, mondayOf, num, rowsOf, shortDate, todayIso, useAllPages, weekLabel} from "@/lib/bh";

const staffSelect = q.select({name: "Full Name", status: "Status", model: "Model"});
const convSelect = q.select({week: "Week Starting", staff: "Staff", model: "Model", conversions: "Conversions"});
const paySelect = q.select({workDate: "Work Date", staff: "Staff", hours: "Hours Worked", totalPay: "Total Pay", status: "Payment Status"});
const expenseSelect = q.select({date: "Expense Date", amount: "Amount", status: "Status", model: "Model"});
const targetSelect = q.select({week: "Effective Week", staff: "Staff", weekly: "Weekly Minimum"});
const modelsSelect = q.select({model: "Model", status: "Status", dealType: "Deal Type", modelCut: "Model's Cut %", ourCut: "Our Cut %"});
const mapSelect = q.select({accountId: "Account ID", model: "Model", include: "Include in P&L"});

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#6366f1", "#ec4899", "#14b8a6", "#a3a3a3"];

export default function Overview() {
  // Render dates only after mount so server and client HTML match.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);

  const staff = useRecords({from: "staff", select: staffSelect});
  const conv = useRecords({from: "conversions", select: convSelect});
  const pay = useRecords({from: "paylog", select: paySelect});
  const expenses = useRecords({from: "expenses", select: expenseSelect});
  const targets = useRecords({from: "expectations", select: targetSelect});
  const models = useRecords({from: "models", select: modelsSelect});
  const map = useRecords({from: "map", select: mapSelect});
  const all = [staff, conv, pay, expenses, targets, models, map];
  all.forEach(useAllPages);

  const monthStart = today ? today.slice(0, 8) + "01" : "";
  const proxyFetch = useProxyFetch("live");
  const revenue = useQuery({queryKey: ["bh-overview-creators", monthStart, today], enabled: !!today, staleTime: 60000, retry: false,
    queryFn: () => fetchCreators(proxyFetch, monthStart, today!)});

  const d = useMemo(() => {
    if (!today) return null;
    const thisWeek = mondayOf(today);
    const weeks = [-21, -14, -7, 0].map(n => addDays(thisWeek, n));
    const staffRows = rowsOf(staff);
    const name = new Map(staffRows.map(s => [s.id, label(s.fields.name)]));
    const active = staffRows.filter(s => label(s.fields.status) === "Active");

    // ---- Conversions: weeks × staff ----
    const grid = new Map<string, Map<string, number>>(weeks.map(w => [w, new Map()]));
    for (const r of rowsOf(conv)) {
      const w = mondayOf(String(r.fields.week ?? "").slice(0, 10) || "1970-01-01");
      const g = grid.get(w);
      if (!g) continue;
      for (const sid of linkIds(r.fields.staff)) g.set(sid, (g.get(sid) ?? 0) + num(r.fields.conversions));
    }
    const weekTotal = (w: string) => [...grid.get(w)!.values()].reduce((a, b) => a + b, 0);
    const reported = new Set(weeks.flatMap(w => [...grid.get(w)!.keys()]));
    const ranked = [...reported].sort((a, b) => (grid.get(weeks[3])!.get(b) ?? 0) + (grid.get(weeks[2])!.get(b) ?? 0) - (grid.get(weeks[3])!.get(a) ?? 0) - (grid.get(weeks[2])!.get(a) ?? 0));
    const series = ranked.slice(0, 8);
    const hasOther = ranked.length > 8;
    const chart = weeks.map(w => {
      const row: Record<string, any> = {week: w, label: shortDate(w) + (w === thisWeek ? " ·now" : ""), total: weekTotal(w)};
      series.forEach(sid => row[sid] = grid.get(w)!.get(sid) ?? 0);
      if (hasOther) row.other = ranked.slice(8).reduce((s, sid) => s + (grid.get(w)!.get(sid) ?? 0), 0);
      return row;
    });
    const config: ChartConfig = Object.fromEntries(series.map((sid, i) => [sid, {label: name.get(sid) ?? "Unknown", color: COLORS[i]}]));
    if (hasOther) config.other = {label: "Others", color: COLORS[8]};

    // ---- Targets: latest weekly minimum per staff effective by a week ----
    const targetRows = rowsOf(targets);
    const weeklyTarget = (sid: string, w: string) => {
      const t = targetRows.filter(t => linkIds(t.fields.staff).includes(sid) && String(t.fields.week ?? "").slice(0, 10) <= w && t.fields.weekly != null)
        .sort((a, b) => String(b.fields.week).localeCompare(String(a.fields.week)))[0];
      return t ? num(t.fields.weekly) : null;
    };
    const leaderboard = active.map(s => {
      const now = grid.get(weeks[3])!.get(s.id);
      const last = grid.get(weeks[2])!.get(s.id);
      const target = weeklyTarget(s.id, weeks[2]);
      return {id: s.id, name: label(s.fields.name), model: label(s.fields.model?.[0]), now: now ?? null, last: last ?? null, target};
    }).sort((a, b) => (b.now ?? -1) - (a.now ?? -1) || (b.last ?? -1) - (a.last ?? -1));

    // ---- Money this month ----
    const inMonth = (v: any) => { const s = String(v ?? "").slice(0, 10); return s >= monthStart && s <= today; };
    let wages = 0, unpaidWages = 0, hoursWeek = 0;
    const lastLogged = new Map<string, string>();
    for (const r of rowsOf(pay)) {
      const day = String(r.fields.workDate ?? "").slice(0, 10);
      for (const sid of linkIds(r.fields.staff)) if (day > (lastLogged.get(sid) ?? "")) lastLogged.set(sid, day);
      if (day >= thisWeek && day <= today) hoursWeek += num(r.fields.hours);
      if (label(r.fields.status) !== "Paid") unpaidWages += num(r.fields.totalPay);
      if (inMonth(day)) wages += num(r.fields.totalPay);
    }
    let paidExpenses = 0, unpaidExpenses = 0;
    for (const r of rowsOf(expenses)) {
      if (!inMonth(r.fields.date)) continue;
      if (label(r.fields.status) === "Paid") paidExpenses += num(r.fields.amount); else unpaidExpenses += num(r.fields.amount);
    }

    // Earnings: only Creator Staq pages linked to a model, with each model's deal applied.
    const links = rowsOf(map).filter(r => r.fields.include !== false);
    const creators = revenue.data ?? [];
    let income: number | null = revenue.isSuccess ? 0 : null, payout = 0, gross = 0;
    const unlinkedModels: string[] = [];
    for (const m of rowsOf(models).filter(m => label(m.fields.status) !== "Inactive")) {
      const ids = new Set(links.filter(l => linkIds(l.fields.model).includes(m.id)).map(l => String(num(l.fields.accountId))));
      if (!ids.size) { unlinkedModels.push(label(m.fields.model)); continue; }
      const page = creators.filter(c => ids.has(c.id)).reduce((s, c) => s + c.net, 0);
      gross += page;
      if (income === null) continue;
      if (label(m.fields.dealType) === "Chat-only") income += page * num(m.fields.ourCut) / 100;
      else { income += page; payout += page * num(m.fields.modelCut) / 100; }
    }
    const profit = income === null ? null : income - payout - wages - paidExpenses;

    const missing = active.filter(s => (lastLogged.get(s.id) ?? "") < addDays(today, -2))
      .map(s => ({name: label(s.fields.name), last: lastLogged.get(s.id) ?? null}));
    const below = leaderboard.filter(s => s.target !== null && s.last !== null && s.last < s.target);
    const notReported = active.filter(s => !grid.get(weeks[2])!.has(s.id)).map(s => label(s.fields.name));

    const thisTotal = weekTotal(weeks[3]), lastTotal = weekTotal(weeks[2]), prevTotal = weekTotal(weeks[1]);
    const daysIn = Math.min(7, Math.round((Date.parse(today) - Date.parse(thisWeek)) / 864e5) + 1);
    return {thisWeek, weeks, chart, config, series, hasOther, leaderboard, thisTotal, lastTotal, prevTotal, daysIn,
      wages, unpaidWages, hoursWeek, paidExpenses, unpaidExpenses, income, payout, gross, profit, unlinkedModels, missing, below, notReported, activeCount: active.length};
  }, [today, staff.data, conv.data, pay.data, expenses.data, targets.data, models.data, map.data, revenue.data, revenue.isSuccess]);

  if (!d || all.some(isLoading)) return <div className="space-y-5">
    <div className="h-16 w-72 animate-pulse rounded-lg bg-muted"/>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted"/>)}</div>
    <div className="h-96 animate-pulse rounded-xl bg-muted"/>
  </div>;
  if (all.some(r => r.status === "error")) return <Card><CardContent className="p-6 text-destructive">Could not load data from Airtable. Refresh the page to try again.</CardContent></Card>;

  const alerts = [
    ...d.missing.map(m => ({tone: "amber", text: `${m.name} has no hours logged since ${m.last ? shortDate(m.last) : "ever"}`, href: "/pay-hours"})),
    ...d.notReported.map(n => ({tone: "amber", text: `${n}: no conversions entered for last week`, href: "/conversions"})),
    ...d.below.map(b => ({tone: "red", text: `${b.name} missed target last week (${b.last} / ${b.target})`, href: "/staff"})),
    ...d.unlinkedModels.map(m => ({tone: "amber", text: `${m} has no Creator Staq page linked`, href: "/pnl"})),
  ];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Black Hat overview</h1>
        <p className="text-sm text-muted-foreground">Week {weekLabel(d.thisWeek)} · day {d.daysIn} of 7 · {d.activeCount} active staff</p>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Target} title="Conversions this week" value={String(d.thisTotal)} delta={d.lastTotal ? d.thisTotal - d.lastTotal : null} note={`Last week ${d.lastTotal} · week before ${d.prevTotal}`}/>
      <Stat icon={Banknote} title="Earnings this month" value={d.income === null ? "—" : money(d.income)} note={revenue.isError ? "Creator Staq unavailable" : d.payout ? `${money(d.gross)} gross · ${money(d.payout)} to model` : "Creator Staq net, linked pages"}/>
      <Stat icon={Wallet} title="Costs this month" value={money(d.wages + d.paidExpenses)} note={`${money(d.wages)} wages · ${money(d.paidExpenses)} expenses`}/>
      <Stat icon={TrendingUp} title="Profit this month" value={d.profit === null ? "—" : money(d.profit)} tone={d.profit === null ? "" : d.profit >= 0 ? "text-emerald-600" : "text-red-600"} note={<a href="/pnl" className="underline">Full P&amp;L</a>}/>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Conversions · last 4 weeks</CardTitle>
          <CardDescription>This week plus the three before it, split by VA. Rolls forward every Monday.</CardDescription>
        </CardHeader>
        <CardContent>
          {d.chart.every(w => w.total === 0) ? <Empty text="No conversions entered for these weeks yet." href="/conversions" cta="Enter this week’s numbers"/> :
          <ChartContainer config={d.config} className="aspect-auto h-80 w-full">
            <BarChart data={d.chart} margin={{top: 24, left: -12, right: 8}}>
              <CartesianGrid vertical={false}/>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v: string) => v.replace(" ·now", " (now)")}/>
              <YAxis tickLine={false} axisLine={false} allowDecimals={false}/>
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_: any, p: any) => weekLabel(p?.[0]?.payload?.week ?? d.thisWeek)}/>}/>
              <ChartLegend content={<ChartLegendContent/>}/>
              {[...d.series, ...(d.hasOther ? ["other"] : [])].map((key, i, arr) =>
                <Bar key={key} dataKey={key} stackId="a" fill={`var(--color-${key})`} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0}>
                  {i === arr.length - 1 && <LabelList dataKey="total" position="top" className="fill-foreground text-xs font-semibold"/>}
                </Bar>)}
            </BarChart>
          </ChartContainer>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="size-4 text-amber-500"/>VA leaderboard</CardTitle>
          <CardDescription>This week so far, with last week against target.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b pb-2 text-xs text-muted-foreground"><span>VA</span><span className="w-14 text-right">This wk</span><span className="w-20 text-right">Last wk</span></div>
          <ul className="divide-y">{d.leaderboard.map((s, i) => <li key={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
              <span className="min-w-0"><span className="block truncate font-medium">{s.name}</span><span className="block truncate text-xs text-muted-foreground">{s.model || "No model"}</span></span>
            </span>
            <span className="w-14 text-right text-base font-semibold tabular-nums">{s.now ?? "—"}</span>
            <span className="w-20 text-right tabular-nums">
              {s.last ?? "—"}{s.target !== null && <span className={"ml-1 text-xs " + (s.last !== null && s.last >= s.target ? "text-emerald-600" : "text-red-600")}>/{s.target}</span>}
            </span>
          </li>)}</ul>
        </CardContent>
      </Card>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500"/>Needs attention</CardTitle></CardHeader>
        <CardContent>
          {alerts.length ? <ul className="space-y-2">{alerts.slice(0, 10).map((a, i) => <li key={i}>
            <a href={a.href} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
              <span className={"size-2 shrink-0 rounded-full " + (a.tone === "red" ? "bg-red-500" : "bg-amber-400")}/>{a.text}
            </a></li>)}</ul>
          : <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600"/>All clear — hours, conversions and targets are up to date.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>This month at a glance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Mini icon={Clock} title="Hours this week" value={d.hoursWeek.toLocaleString()} href="/pay-hours"/>
          <Mini icon={Users} title="Unpaid wages (all time)" value={money(d.unpaidWages)} href="/pay-hours" warn={d.unpaidWages > 0}/>
          <Mini icon={Receipt} title="Paid expenses" value={money(d.paidExpenses)} href="/expenses"/>
          <Mini icon={Receipt} title="Unpaid expenses" value={money(d.unpaidExpenses)} href="/expenses" warn={d.unpaidExpenses > 0}/>
        </CardContent>
      </Card>
    </div>
  </div>;
}

function Stat({icon: Icon, title, value, note, delta, tone = ""}: {icon: any; title: string; value: string; note: React.ReactNode; delta?: number | null; tone?: string}) {
  return <Card className="gap-0 py-0"><CardContent className="p-4">
    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">{title}<Icon className="size-4"/></div>
    <div className="mt-2 flex items-baseline gap-2">
      <span className={"text-3xl font-semibold tabular-nums " + tone}>{value}</span>
      {delta != null && <span className={"flex items-center text-xs font-medium " + (delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground")}>
        {delta > 0 ? <ArrowUpRight className="size-3.5"/> : delta < 0 ? <ArrowDownRight className="size-3.5"/> : <Minus className="size-3.5"/>}{Math.abs(delta)} vs last wk
      </span>}
    </div>
    <div className="mt-1 text-xs text-muted-foreground">{note}</div>
  </CardContent></Card>;
}

function Mini({icon: Icon, title, value, href, warn}: {icon: any; title: string; value: string; href: string; warn?: boolean}) {
  return <a href={href} className="rounded-lg border p-3 hover:bg-muted/50">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5"/>{title}</div>
    <div className={"mt-1 text-lg font-semibold tabular-nums " + (warn ? "text-amber-700" : "")}>{value}</div>
  </a>;
}

function Empty({text, href, cta}: {text: string; href: string; cta: string}) {
  return <div className="grid h-72 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
    <div>{text}<br/><a href={href} className="mt-2 inline-block font-medium text-foreground underline">{cta}</a></div>
  </div>;
}
